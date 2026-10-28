import { pointOnCircle, bearingTo } from '../circle';
import { distance, roundness, trackLength } from './geo';
import { turnAllowed } from './graph';
import { radialDeviation, validateSettings } from './solve';
import type { Edge, Graph, Point, Route, Settings } from './types';
export type EngineRequest = {
  kind: 'ordered-waypoints' | 'round-trip';
  start: Point; startNodeId: number; targetM: number;
  waypoints?: Point[]; seed?: number;
  preferences: Pick<Settings, 'surface' | 'style'>;
  limits: { requests: 1; deadline: number; bytes: number; edges: number };
};
// Deliberately no hosted URL, credentials, automatic fallback, or demo endpoint.
// A real implementation must preserve detailed edge identity/geometry and apply
// these limits while reading; these adapters alone do not measure a real engine.
export type EngineTransport = (request: EngineRequest, signal: AbortSignal) => Promise<{ edges: Pick<Edge, 'from' | 'to' | 'way'>[] }>;
export function engineRequest(kind: EngineRequest['kind'], graph: Graph, settings: Settings, startNodeId: number): EngineRequest {
  validateSettings(settings);
  const start = graph.nodes.get(startNodeId);
  if (!start || distance(start, settings.start) > 300) throw new Error('Pinned Start is unavailable.');
  const bearing = bearingTo(settings.center, start);
  return { kind, start: { lat: start.lat, lon: start.lon }, startNodeId, targetM: settings.targetKm * 1000,
    ...(kind === 'ordered-waypoints' ? { waypoints: [start, ...Array.from({ length: 7 }, (_, i) => pointOnCircle(settings.center, settings.circleRadiusM ?? settings.targetKm * 1000 / (2 * Math.PI), bearing + (i + 1) * 45)), start].map(({ lat, lon }) => ({ lat, lon })) } : { seed: 0 }),
    preferences: { surface: settings.surface, style: settings.style }, limits: { requests: 1, deadline: performance.now() + 14000, bytes: 32 * 1024 * 1024, edges: 200000 } };
}
export async function compareEngine(kind: EngineRequest['kind'], graph: Graph, settings: Settings, startNodeId: number, transport: EngineTransport, signal: AbortSignal): Promise<Route> {
  signal.throwIfAborted();
  const request = engineRequest(kind, graph, settings, startNodeId), controller = new AbortController();
  const cancel = () => controller.abort(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
  signal.addEventListener('abort', cancel, { once: true });
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Engine comparison time budget reached.')), Math.max(1, request.limits.deadline - performance.now()));
  try {
    const response = await Promise.race([transport(request, controller.signal), aborted]);
    controller.signal.throwIfAborted(); signal.throwIfAborted();
    if (!Array.isArray(response.edges) || response.edges.length > request.limits.edges || new TextEncoder().encode(JSON.stringify(response)).byteLength > request.limits.bytes) throw new Error('Engine response exceeds the comparison budget.');
    const edges: Edge[] = [], points: Point[] = [request.start], used = new Set<string>();
    let node = startNodeId, repeatedM = 0, unknownM = 0;
    for (const step of response.edges) {
      const edge = graph.edges.get(node)?.find(edge => edge.from === step.from && edge.to === step.to && edge.way === step.way);
      if (!edge || !turnAllowed(graph, edges.at(-1), edge)) throw new Error('Engine route has an unknown, disconnected or illegal road/turn.');
      const key = `${Math.min(edge.from, edge.to)}/${Math.max(edge.from, edge.to)}`;
      if (used.has(key)) repeatedM += edge.length; used.add(key);
      if (!edge.surfaceKnown) unknownM += edge.length;
      edges.push(edge); node = edge.to; const point = graph.nodes.get(node)!; points.push({ lat: point.lat, lon: point.lon });
    }
    if (!edges.length || node !== startNodeId || !turnAllowed(graph, edges.at(-1), edges[0])) throw new Error('Engine route is not a legally closed loop at pinned Start.');
    // Ordered waypoints must be visited in order within the existing 300 m snap
    // bound. Round-trip intentionally has no promise to orbit the drawn center.
    if (request.waypoints) {
      let index = 0;
      for (const waypoint of request.waypoints.slice(1, -1)) {
        while (index < points.length && distance(points[index], waypoint) > 300) index++;
        if (index === points.length) throw new Error('Engine did not preserve the ordered circle waypoints.');
      }
    }
    const lengthM = trackLength(points), error = Math.abs(lengthM - request.targetM) / request.targetM, round = roundness(points), repeated = repeatedM / lengthM;
    if (error > settings.tolerance || round < .3 || repeated > .2) throw new Error('Engine loop fails the same distance, roundness or repetition checks.');
    const radius = settings.circleRadiusM ?? request.targetM / (2 * Math.PI);
    return { points, startNodeId, lengthM, error, roundness: round, repeated, unknownSurface: unknownM / lengthM, snapM: distance(request.start, settings.start), circleCenter: settings.center, circleRadiusM: radius, candidates: 1, radialDeviation: radialDeviation(points, settings.center, radius), notes: [...graph.notes, 'Engine comparison result validated against this fixture graph.', ...(kind === 'round-trip' ? ['Round-trip aims at distance from Start; it does not promise the drawn center or circle shape.'] : [])] };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', onAbort); }
}
