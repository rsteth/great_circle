import { covers, coverageCost, initialCoverage, validateCoverage, type Coverage } from './coverage';
import type { NetworkTiming, OsmData, Settings } from './types';
import { assertCompleteOsm } from './validateData';
import { validateSettings } from './solve';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const CLIENT_USER_AGENT = 'GreatCircle/0.1 (+https://github.com/rsteth/great_circle; local personal route planner)';
const REQUEST_COOLDOWN_MS = 30000;
const RESPONSE_CAP = 32 * 1024 * 1024;
const HIGHWAYS = '^(cycleway|residential|living_street|unclassified|service|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|track|path|footway|pedestrian)$';
export type MapFailureDetail = { status: number; retryAfterSeconds: number; requestMs: number; queryBytes: number; queryVertices: number; queryAreaM2: number };
export class MapServiceError extends Error {
  constructor(readonly detail: MapFailureDetail) {
    const { status, retryAfterSeconds: seconds } = detail;
    const message = status === 406 || status === 403
      ? `The map service declined the request (HTTP ${status}). Public service access may be restricted. No automatic retry was made.`
      : status === 502
        ? `The public map request failed (HTTP 502: Bad Gateway). Keep this tab open. Wait at least ${seconds} seconds, then select Generate loop to try again. This is a download error, not a no-loop result.`
        : [429, 504].includes(status)
          ? `The map service is busy or rate-limited (HTTP ${status}). Wait at least ${seconds} seconds before trying again.`
          : `Map download failed (HTTP ${status}). Wait at least ${seconds} seconds before trying again.`;
    super(message); this.name = 'MapServiceError';
  }
}
export type FetchBudget = { remainingBytes: number; remainingElements: number; remainingRequests: number; deadline: number };
export const newFetchBudget = (): FetchBudget => ({ remainingBytes: RESPONSE_CAP, remainingElements: 200000, remainingRequests: 2, deadline: performance.now() + 90000 });
export type NetworkResult = { data: OsmData; cached: boolean; datasetId: string; sourceCoverage: Coverage; coverage: Coverage; timing: NetworkTiming };
type CachedArea = { key: string; at: number; data: OsmData; coverage: Coverage; bytes: number; datasetId: string };
const areas: CachedArea[] = [];
const MAX_CACHED_BYTES = 24 * 1024 * 1024;
let datasetSequence = 0, nextRequestAt = 0;
export function queryFor(settings: Settings, coverage: Coverage = initialCoverage(settings)): string {
  validateSettings(settings); validateCoverage(coverage);
  const way = (around: string) => `way(around:${around})["highway"~"${HIGHWAYS}"]`;
  const position = (point: { lat: number; lon: number }) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;
  const selected = coverage.kind === 'disk' ? `${way(`${coverage.radiusM},${position(coverage.center)}`)}->.roads;` : `(\n${way(`${coverage.halfWidthM},${coverage.line.map(position).join(',')}`)};\n${coverage.patches.map(patch => `${way(`${patch.radiusM},${position(patch.center)}`)};`).join('\n')}\n)->.roads;`;
  const query = `[out:json][timeout:25][maxsize:33554432];\n${selected}\nrel(bw.roads)["type"="restriction"]->.turns;\n(.roads;node(w.roads);.turns;);out body;`;
  if (query.length > 16000) throw new Error('Corridor query exceeds its vertex/text budget. Try a smaller circle.');
  return query;
}
function discardBody(response: Response) {
  try { void response.body?.cancel().catch(() => {}); } catch { /* Preserve the original status even if cancellation throws synchronously. */ }
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export async function loadNetwork(settings: Settings, signal: AbortSignal, client?: { userAgent: string }, options: { coverage?: Coverage; budget?: FetchBudget; waitForCooldown?: boolean; onWait?: (seconds: number) => void } = {}): Promise<NetworkResult> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const requested = options.coverage ?? initialCoverage(settings), query = queryFor(settings, requested), budget = options.budget;
  if (budget && performance.now() >= budget.deadline) throw new Error('Route planning time budget reached. Try a smaller circle.');
  for (let i = areas.length - 1; i >= 0; i--) if (Date.now() - areas[i].at >= 900000) areas.splice(i, 1);
  const hit = areas.findIndex(area => area.key === query || covers(area.coverage, requested));
  const cost = coverageCost(requested);
  if (hit !== -1) {
    const [area] = areas.splice(hit, 1); areas.push(area);
    const coverage = area.coverage.kind === 'corridor' && requested.kind === 'corridor' ? area.coverage : requested;
    return { data: area.data, cached: true, datasetId: area.datasetId, sourceCoverage: area.coverage, coverage, timing: { fetchMs: 0, parseMs: 0, bytes: 0, cacheHit: true, elements: 0, queryAreaM2: cost.areaM2, queryVertices: cost.vertices } };
  }
  if (Date.now() < nextRequestAt) {
    const remaining = nextRequestAt - Date.now();
    if (!options.waitForCooldown) throw new Error(`Please wait ${Math.ceil(remaining / 1000)} seconds before another map request. The public map service is shared.`);
    if (budget && performance.now() + remaining >= budget.deadline) throw new Error('Request cooldown exceeds the remaining planning budget. Try later.');
    options.onWait?.(Math.ceil(remaining / 1000)); await wait(remaining, signal); options.onWait?.(0);
  }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (budget && (budget.remainingRequests <= 0 || budget.remainingBytes <= 0 || budget.remainingElements <= 0 || performance.now() >= budget.deadline)) throw new Error('Route download budget reached. No more requests will be made.');
  nextRequestAt = Date.now() + REQUEST_COOLDOWN_MS;
  if (budget) budget.remainingRequests--;
  const started = performance.now(), timeout = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(45000, budget ? budget.deadline - performance.now() : 45000))));
  const requestSignal = AbortSignal.any([signal, timeout]);
  // Charge cancellation at the moment it happens, not when a late fetch settles.
  // An aborted old request must not later replace a newer request's backoff/cache.
  const onAbort = () => { nextRequestAt = Math.max(nextRequestAt, Date.now() + REQUEST_COOLDOWN_MS); };
  requestSignal.addEventListener('abort', onAbort, { once: true });
  if (requestSignal.aborted) onAbort();
  try {
    const response = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: query }), headers: client ? { 'User-Agent': client.userAgent } : undefined, signal: requestSignal });
    if (requestSignal.aborted) { discardBody(response); requestSignal.throwIfAborted(); }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const parsedRetry = retry === null ? 0 : /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      const retryMs = Number.isFinite(parsedRetry) ? Math.max(0, parsedRetry) : 0;
      const waitMs = Math.max(REQUEST_COOLDOWN_MS, retryMs);
      nextRequestAt = Math.max(nextRequestAt, Date.now() + waitMs);
      // Discard the error body without letting a failed body cancellation mask
      // the actual HTTP status or Retry-After. Never cache error/partial data.
      discardBody(response);
      throw new MapServiceError({ status: response.status, retryAfterSeconds: Math.ceil(waitMs / 1000), requestMs: performance.now() - started, queryBytes: new TextEncoder().encode(query).byteLength, queryVertices: cost.vertices, queryAreaM2: cost.areaM2 });
    }
    const limit = Math.min(RESPONSE_CAP, budget?.remainingBytes ?? RESPONSE_CAP);
    if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw new Error('Map download exceeds the remaining byte budget. Try a smaller circle.'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('The map service returned an empty response.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (budget) budget.remainingBytes -= value.byteLength;
      requestSignal.throwIfAborted();
      if (size > limit) { await reader.cancel(); throw new Error('Map download exceeds the remaining byte budget. Try a smaller circle.'); }
      chunks.push(value);
    }
    const fetched = performance.now(), bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    let data: OsmData;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('The map service returned invalid data (possibly truncated). No roads were used. Try later.'); }
    if (!data || typeof data !== 'object' || !Array.isArray(data.elements)) throw new Error('The map service returned incomplete data. Try later.');
    if (budget) budget.remainingElements -= data.elements.length;
    if (data.elements.length > 200000 || (budget && budget.remainingElements < 0)) throw new Error('Map data exceeds the remaining element budget. Try a smaller circle.');
    assertCompleteOsm(data);
    requestSignal.throwIfAborted();
    const datasetId = `osm-${++datasetSequence}`;
    if (size <= MAX_CACHED_BYTES) {
      areas.push({ key: query, at: Date.now(), data, coverage: requested, bytes: size, datasetId });
      while (areas.length > 3 || areas.reduce((sum, area) => sum + area.bytes, 0) > MAX_CACHED_BYTES) areas.shift();
    }
    return { data, cached: false, datasetId, sourceCoverage: requested, coverage: requested, timing: { fetchMs: fetched - started, parseMs: performance.now() - fetched, bytes: size, cacheHit: false, elements: data.elements.length, queryAreaM2: cost.areaM2, queryVertices: cost.vertices } };
  } catch (error) {
    // The abort listener already applied cancellation/timeout backoff. Other
    // failures start a full pause now; a longer HTTP Retry-After is preserved.
    if (!requestSignal.aborted) nextRequestAt = Math.max(nextRequestAt, Date.now() + REQUEST_COOLDOWN_MS);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timeout.aborted) throw new Error('The map service took too long. Wait a little and try a smaller circle.');
    if (error instanceof TypeError) throw new Error('Could not reach the public map service. Your connection may have changed, or the service may be unavailable. Check your connection, wait 30 seconds, then try again.');
    throw error;
  } finally { requestSignal.removeEventListener('abort', onAbort); }
}
