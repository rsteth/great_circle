import type { OsmData, Settings } from './types';
import { validateSettings } from './solve';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const CLIENT_USER_AGENT = 'GreatCircle/0.1 (+https://github.com/rsteth/great_circle; local personal route planner)';
const REQUEST_COOLDOWN_MS = 30000;
let cached: { key: string; at: number; data: OsmData } | undefined;
let nextRequestAt = 0;
export function queryFor(settings: Settings): string {
  validateSettings(settings);
  const { center, radiusM } = settings;
  return `[out:json][timeout:25][maxsize:33554432];\nway(around:${radiusM + 50},${center.lat.toFixed(6)},${center.lon.toFixed(6)})["highway"~"^(cycleway|residential|living_street|unclassified|service|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|track|path|footway|pedestrian)$"]->.roads;\nrel(bw.roads)["type"="restriction"]->.turns;\n(.roads;node(w.roads);.turns;);out body;`;
}
export async function loadNetwork(settings: Settings, signal: AbortSignal, client?: { userAgent: string }): Promise<{ data: OsmData; cached: boolean }> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const query = queryFor(settings);
  if (cached?.key === query && Date.now() - cached.at < 15 * 60 * 1000) return { data: cached.data, cached: true };
  if (Date.now() < nextRequestAt) throw new Error(`Please wait ${Math.ceil((nextRequestAt - Date.now()) / 1000)} seconds before another map request. The public map service is shared.`);
  nextRequestAt = Date.now() + REQUEST_COOLDOWN_MS;
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
  const bytes = new Uint8Array(size);
  let index = 0;
  for (const chunk of chunks) { bytes.set(chunk, index); index += chunk.length; }
  let data: OsmData;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('The map service returned invalid data. Wait a little and try again.'); }
  if (!Array.isArray(data.elements) || data.remark) throw new Error('The map service returned incomplete data. Try a smaller area later.');
  cached = { key: query, at: Date.now(), data };
  return { data, cached: false };
}
