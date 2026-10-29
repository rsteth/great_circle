import { bearingTo, pointOnCircle } from '../src/circle';
import { distance } from '../src/routing/geo';
import { radialDeviation, validateSettings } from '../src/routing/solve';
import { scoreGeometry } from '../src/loop/score';
import { ProviderFailure, type LoopRequest, type LoopResult, type PreparedProvider } from '../src/loop/types';
export function createLoopPlanner(provider: PreparedProvider, timeoutMs = 20000) {
 const plan = async (request: LoopRequest, signal: AbortSignal): Promise<LoopResult> => {
  let requests = 0; const requestId = typeof request?.requestId === 'string' ? request.requestId.slice(0, 80) : '';
  try { validateSettings(request.settings); if (!request.settings.circleRadiusM || !requestId) throw new Error(); } catch { return { status: 'invalid-request', requestId, message: 'Choose a circle radius from 0.5 to 10 km and a valid Start.', requests }; }
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason); signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new Error('Routing time budget reached. Try later.')), Math.min(30000, timeoutMs));
  let pinned = request.settings.start, pinnedAccepted = false, last: LoopResult | undefined;
  try {
   for (const direction of [1, -1]) {
    controller.signal.throwIfAborted();
    if (requests) await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(wait); reject(controller.signal.reason); }; const wait = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 1550); controller.signal.addEventListener('abort', abort, { once: true }); });
    const settings = request.settings, bearing = bearingTo(settings.center, pinned), coordinates = [pinned, ...Array.from({ length: 7 }, (_, i) => pointOnCircle(settings.center, settings.circleRadiusM!, bearing + direction * (i + 1) * 45)), pinned];
    requests++; let geometry;
    try {
      let stop!: () => void; const aborted = new Promise<never>((_resolve, reject) => { stop = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', stop, { once: true }); if (controller.signal.aborted) stop(); });
      try { geometry = await Promise.race([provider.route(coordinates, settings, controller.signal), aborted]); } finally { controller.signal.removeEventListener('abort', stop); }
    } catch (error) { if (error instanceof ProviderFailure && error.kind === 'unroutable') { last = { status: 'unroutable', requestId, requests, message: error.message }; continue; } throw error; }
    controller.signal.throwIfAborted();
    if (!Array.isArray(geometry.waypoints) || geometry.waypoints.length !== coordinates.length || geometry.waypoints.some((index, i) => !Number.isInteger(index) || index < 0 || index >= geometry.points.length || (i > 0 && index < geometry.waypoints[i - 1])) || geometry.waypoints[0] !== 0 || geometry.waypoints.at(-1) !== geometry.points.length - 1) return { status: 'unavailable', requestId, requests, message: 'Routing service returned incomplete ordered waypoints.' };
    if (geometry.waypoints.some((index, i) => distance(geometry.points[index], coordinates[i]) > 300)) { last = { status: 'unroutable', requestId, requests, message: 'The circle waypoints could not be snapped within 300 m.' }; continue; }
    let score; try { score = scoreGeometry(geometry.points, settings, controller.signal); } catch (error) { controller.signal.throwIfAborted(); last = { status: 'shape-tolerance', requestId, requests, message: error instanceof Error ? error.message : 'Returned route geometry could not be checked.' }; continue; }
    if (!Number.isFinite(geometry.distanceM) || Math.abs(geometry.distanceM - score.lengthM) > Math.max(10, score.lengthM * .01)) return { status: 'unavailable', requestId, requests, message: 'Routing distance and returned geometry disagree.' };
    if (score.snapM > 300 || (pinnedAccepted && distance(geometry.points[0], pinned) > 1)) { last = { status: 'unroutable', requestId, requests, message: 'Routing service could not preserve the accepted Start. Choose another Start.' }; continue; }
    if (!pinnedAccepted) { pinned = geometry.points[0]; pinnedAccepted = true; }
    if (score.distanceError > settings.tolerance || score.roundness < .3 || score.radialError > .2 + settings.tolerance * .5 || score.angularCoverage < .875 || Math.abs(score.winding) < .85 || Math.abs(score.winding) > 1.15 || score.retraced > .2) { last = { status: 'shape-tolerance', requestId, requests, score, message: 'Roads connect, but the route is too far from this circle or repeats too much. Move or resize the circle.' }; continue; }
    const surface = new Array<number | undefined>(geometry.points.length - 1).fill(undefined);
    for (const item of geometry.surface ?? []) if (Array.isArray(item) && item.length === 3 && Number.isInteger(item[0]) && Number.isInteger(item[1]) && item[0] >= 0 && item[1] < geometry.points.length && Number.isInteger(item[2])) for (let i = item[0]; i < item[1]; i++) surface[i] = item[2];
    if (settings.surface === 'paved' && surface.some(code => code === undefined || ![1, 3, 4, 5, 6, 7, 14].includes(code))) return { status: 'unroutable', requestId, requests, message: 'The returned route is not fully verified as paved. Try mixed surfaces or another circle.' };
    const unknownSurface = surface.filter(code => code === undefined || code === 0).length / surface.length;
    return { status: 'ok', requestId, requests, score, route: { points: geometry.points, lengthM: score.lengthM, error: score.distanceError, roundness: score.roundness, repeated: score.retraced, unknownSurface, snapM: score.snapM, circleCenter: settings.center, circleRadiusM: settings.circleRadiusM!, radialDeviation: radialDeviation(geometry.points, settings.center, settings.circleRadiusM!), candidates: requests, notes: ['Road access and turn restrictions follow the provider cycling profile; they are not independently audited against a local road graph.', 'Geometry retracing uses a 1 m tolerance. No elevation or turn-by-turn instructions are exported.'], license: { attribution: 'Routing © HeiGIT / openrouteservice; OpenStreetMap contributors', name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } } };
   }
   return { ...last!, requests };
  } catch (error) {
   if (signal.aborted) return { status: 'cancelled', requestId, requests, message: 'Cancelled.' };
   if (controller.signal.aborted) return { status: 'unavailable', requestId, requests, message: 'Routing time budget reached. Try later.' };
   if (error instanceof ProviderFailure) return { status: error.kind, requestId, requests, message: error.message, retryAfterSeconds: error.retryAfterSeconds };
   return { status: 'unavailable', requestId, requests, message: 'Routing service could not complete this request.' };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
 };
 return async (request: LoopRequest, signal: AbortSignal): Promise<LoopResult> => { const before = provider.requestCount?.() ?? 0; const result = await plan(request, signal); return { ...result, providerRequests: provider.requestCount ? provider.requestCount() - before : result.requests }; };
}
