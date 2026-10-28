import { distance } from './geo';
import type { NetworkTiming, OsmData, Point, Settings } from './types';
import { validateSettings } from './solve';
import { MAX_SHARED_QUERY_RADIUS_M } from './limits';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const CLIENT_USER_AGENT = 'GreatCircle/0.1 (+https://github.com/rsteth/great_circle; local personal route planner)';
const REQUEST_COOLDOWN_MS = 30000;
type CachedArea = { key: string; at: number; data: OsmData; center: Point; radius: number; bytes: number; datasetId: string };
const areas: CachedArea[] = [];
const MAX_CACHED_BYTES = 24 * 1024 * 1024;
let datasetSequence = 0;
let nextRequestAt = 0;
export function queryFor(settings: Settings): string {
  validateSettings(settings);
  const { center, radiusM } = settings;
  if (radiusM > MAX_SHARED_QUERY_RADIUS_M) throw new Error('This circle is too large for the shared map service. Reduce radius to 4.5 km or less to generate a route. You can still size and inspect circles up to 100 km.');
  return `[out:json][timeout:25][maxsize:33554432];\nway(around:${radiusM + 50},${center.lat.toFixed(6)},${center.lon.toFixed(6)})["highway"~"^(cycleway|residential|living_street|unclassified|service|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|track|path|footway|pedestrian)$"]->.roads;\nrel(bw.roads)["type"="restriction"]->.turns;\n(.roads;node(w.roads);.turns;);out body;`;
}
export async function loadNetwork(settings: Settings, signal: AbortSignal, client?: { userAgent: string }): Promise<{ data: OsmData; cached: boolean; datasetId: string; timing: NetworkTiming }> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const query = queryFor(settings);
  // Query centers are rounded by Overpass QL. Containment uses those exact
  // centers and a one-meter conservative guard; keep every returned way/node/
  // restriction intact. Graph construction clips to the *requested* boundary.
  const center = { lat: Number(settings.center.lat.toFixed(6)), lon: Number(settings.center.lon.toFixed(6)) };
  const radius = settings.radiusM + 50;
  for (let i = areas.length - 1; i >= 0; i--) if (Date.now() - areas[i].at >= 15 * 60 * 1000) areas.splice(i, 1);
  const hit = areas.findIndex(area => area.key === query || distance(area.center, center) + radius + 1 <= area.radius);
  if (hit !== -1) {
    const [area] = areas.splice(hit, 1); areas.push(area);
    return { data: area.data, cached: true, datasetId: area.datasetId, timing: { fetchMs: 0, parseMs: 0, bytes: 0, cacheHit: true } };
  }
  if (Date.now() < nextRequestAt) throw new Error(`Please wait ${Math.ceil((nextRequestAt - Date.now()) / 1000)} seconds before another map request. The public map service is shared.`);
  nextRequestAt = Date.now() + REQUEST_COOLDOWN_MS;
  const fetchStarted = performance.now();
  const timeout = AbortSignal.timeout(45000);
  let response: Response;
  try {
    response = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: query }),
      // CLI supplies a truthful app identity. Browsers use their normal Referer;
      // never imitate a browser UA or forge a different site's Referer.
      headers: client ? { 'User-Agent': client.userAgent } : undefined, signal: AbortSignal.any([signal, timeout]) });
  } catch (error) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timeout.aborted) throw new Error('The map service took too long. Wait a little and try a smaller area.');
    throw new Error(`Could not reach OpenStreetMap’s Overpass service. Check your connection and try later.${error instanceof Error && error.name === 'TypeError' ? ' The service may also be temporarily unavailable.' : ''}`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    const retryAfter = response.headers.get('retry-after');
    const retryMs = retryAfter === null ? 0 : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
    nextRequestAt = Date.now() + Math.max(REQUEST_COOLDOWN_MS, retryMs);
    if (response.status === 406) throw new Error('The map service declined the request (HTTP 406). Wait at least 30 seconds before trying again. Public service access may be restricted.');
    throw new Error(response.status === 429 || response.status === 504 ? 'The map service is busy or rate-limited. Wait a minute, then try a smaller area.' : `Map download failed (HTTP ${response.status}). Wait at least 30 seconds before trying again.`);
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 32 * 1024 * 1024) { await response.body?.cancel(); throw new Error('Map download is too large. Choose a smaller area.'); }
  // Stream with a hard cap, including chunked responses without Content-Length.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The map service returned an empty response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('Map download is too large. Choose a smaller area.'); }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timeout.aborted) throw new Error('The map download timed out. Try a smaller area.');
    throw error;
  }
  const fetched = performance.now();
  const bytes = new Uint8Array(size);
  let index = 0;
  for (const chunk of chunks) { bytes.set(chunk, index); index += chunk.length; }
  let data: OsmData;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('The map service returned invalid data. Wait a little and try again.'); }
  if (!Array.isArray(data.elements) || data.remark) throw new Error('The map service returned incomplete data. Try a smaller area later.');
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const datasetId = `osm-${++datasetSequence}`;
  if (size <= MAX_CACHED_BYTES) {
    areas.push({ key: query, at: Date.now(), data, center, radius, bytes: size, datasetId });
    while (areas.length > 3 || areas.reduce((sum, area) => sum + area.bytes, 0) > MAX_CACHED_BYTES) areas.shift();
  }
  return { data, cached: false, datasetId, timing: { fetchMs: fetched - fetchStarted, parseMs: performance.now() - fetched, bytes: size, cacheHit: false } };
}
