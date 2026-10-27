import { angleDelta, distance, offset, roundness, trackLength, xy } from './geo';
import { buildGraph, turnAllowed } from './graph';
import type { Edge, Graph, OsmData, Point, Route, Settings, SolveTiming } from './types';

class Heap<T> {
  private values: { cost: number; value: T }[] = [];
  get size() { return this.values.length; }
  push(cost: number, value: T) {
    const item = { cost, value };
    let i = this.values.length;
    this.values.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.values[p].cost <= cost) break;
      this.values[i] = this.values[p]; i = p;
    }
    this.values[i] = item;
  }
  pop(): { cost: number; value: T } {
    const first = this.values[0];
    const last = this.values.pop()!;
    if (this.values.length) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.values.length && this.values[child + 1].cost < this.values[child].cost) child++;
        if (this.values[child].cost >= last.cost) break;
        this.values[i] = this.values[child]; i = child;
      }
      this.values[i] = last;
    }
    return first;
  }
}
type Budget = { remaining: number; deadline: number };
class SearchLimit extends Error {}
const edgeKeys = new WeakMap<Edge, string>(), physicalKeys = new WeakMap<Edge, string>();
const edgeKey = (edge: Edge) => { let key = edgeKeys.get(edge); if (key === undefined) { key = `${edge.to}/${edge.from}/${edge.way}`; edgeKeys.set(edge, key); } return key; };
const physicalKey = (edge: Edge) => { let key = physicalKeys.get(edge); if (key === undefined) { key = `${Math.min(edge.from, edge.to)}/${Math.max(edge.from, edge.to)}`; physicalKeys.set(edge, key); } return key; };

export function shortestPath(graph: Graph, from: number, to: number, options: { previous?: Edge; first?: Edge; center?: Point; radius?: number; used?: Set<string>; budget?: Budget; radialCosts?: Map<number, number> } = {}): Edge[] | null {
  if (from === to) return [];
  type State = { node: number; previous?: Edge; parent?: State; edge?: Edge };
  const heap = new Heap<State>();
  const initial: State = { node: from, previous: options.previous };
  const stateKey = (state: State) => state.previous ? edgeKey(state.previous) : `start/${state.node}`;
  const costs = new Map<string, number>([[stateKey(initial), 0]]);
  heap.push(0, initial);
  while (heap.size) {
    const { cost, value: state } = heap.pop();
    if (cost !== costs.get(stateKey(state))) continue;
    if (options.budget) {
      options.budget.remaining--;
      if (options.budget.remaining < 0 || (options.budget.remaining % 512 === 0 && Date.now() > options.budget.deadline)) throw new SearchLimit();
    }
    if (state.node === to && (!options.first || turnAllowed(graph, state.previous, options.first))) {
      const result: Edge[] = [];
      let cursor = state;
      while (cursor.edge) { result.push(cursor.edge); cursor = cursor.parent!; }
      return result.reverse();
    }
    for (const edge of graph.edges.get(state.node) ?? []) {
      if (!turnAllowed(graph, state.previous, edge)) continue;
      let radialCost = options.radialCosts?.get(edge.to);
      if (radialCost === undefined) {
        const radialError = options.center && options.radius ? Math.abs(distance(graph.nodes.get(edge.to)!, options.center) - options.radius) / options.radius : 0;
        radialCost = 2.5 * radialError ** 2;
        options.radialCosts?.set(edge.to, radialCost);
      }
      const costNext = cost + edge.length * (edge.factor + radialCost + (options.used?.has(physicalKey(edge)) ? 5 : 0));
      const key = edgeKey(edge);
      if (costNext >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, costNext);
      heap.push(costNext, { node: edge.to, previous: edge, parent: state, edge });
    }
  }
  return null;
}

type Projected = { id: number; x: number; y: number; radial: number; angle: number };
function projectNodes(graph: Graph, center: Point): Projected[] {
  const values: Projected[] = [];
  for (const [id, point] of graph.nodes) {
    if (!(graph.edges.get(id)?.length)) continue;
    const [x, y] = xy(point, center);
    values.push({ id, x, y, radial: Math.hypot(x, y), angle: Math.atan2(y, x) });
  }
  return values;
}
export function chooseAnchors(graph: Graph, start: number, center: Point, radius: number, clockwise: boolean, projected = projectNodes(graph, center)): number[] | null {
  const localStart = xy(graph.nodes.get(start)!, center);
  const startAngle = Math.atan2(localStart[1], localStart[0]);
  const anchors = [start];
  for (let i = 1; i < 8; i++) {
    const angle = startAngle + (clockwise ? -1 : 1) * i * Math.PI / 4;
    const ideal = [Math.cos(angle) * radius, Math.sin(angle) * radius];
    let best: number | undefined;
    let bestScore = Infinity;
    for (const { id, x, y, radial, angle: nodeAngle } of projected) {
      if (anchors.includes(id)) continue;
      if (radial < radius * 0.5 || radial > radius * 1.5 || angleDelta(nodeAngle, angle) > Math.PI / 8) continue;
      const score = (x - ideal[0]) ** 2 + (y - ideal[1]) ** 2;
      if (score < bestScore) { bestScore = score; best = id; }
    }
    if (best === undefined) return null;
    anchors.push(best);
  }
  return anchors;
}

// Prune physical dead ends before choosing anchors: a nearest ideal point on a
// cul-de-sac cannot support a loop without an immediate U-turn. Geometry stays
// untouched; this only narrows the candidate network.
export function loopCore(graph: Graph): Graph {
  const neighbors = new Map<number, Set<number>>();
  for (const [from, edges] of graph.edges) for (const edge of edges) {
    if (!neighbors.has(from)) neighbors.set(from, new Set());
    if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
    neighbors.get(from)!.add(edge.to); neighbors.get(edge.to)!.add(from);
  }
  const pending = [...neighbors].filter(([, adjacent]) => adjacent.size < 2).map(([id]) => id);
  const removed = new Set<number>();
  while (pending.length) {
    const id = pending.pop()!;
    if (removed.has(id)) continue;
    removed.add(id);
    for (const next of neighbors.get(id) ?? []) {
      neighbors.get(next)!.delete(id);
      if (neighbors.get(next)!.size < 2) pending.push(next);
    }
  }
  return subgraph(graph, new Set([...graph.nodes.keys()].filter(id => !removed.has(id))));
}
function subgraph(graph: Graph, keep: Set<number>): Graph {
  return { ...graph,
    nodes: new Map([...graph.nodes].filter(([id]) => keep.has(id))),
    edges: new Map([...graph.edges].filter(([id]) => keep.has(id)).map(([id, edges]) => [id, edges.filter(edge => keep.has(edge.to))])),
  };
}
export function returnableComponent(graph: Graph, start: number): Graph {
  const reverse = new Map<number, number[]>();
  for (const [id, edges] of graph.edges) for (const edge of edges) {
    const entries = reverse.get(edge.to) ?? []; entries.push(id); reverse.set(edge.to, entries);
  }
  function reachable(backwards: boolean): Set<number> {
    const seen = new Set([start]), pending = [start];
    while (pending.length) {
      const id = pending.pop()!;
      const next = backwards ? reverse.get(id) ?? [] : (graph.edges.get(id) ?? []).map(edge => edge.to);
      for (const to of next) if (!seen.has(to)) { seen.add(to); pending.push(to); }
    }
    return seen;
  }
  const forward = reachable(false), backward = reachable(true);
  return subgraph(graph, new Set([...forward].filter(id => backward.has(id))));
}

export function validateSettings(settings: Settings) {
  for (const point of [settings.center, settings.start]) if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 75 || Math.abs(point.lon) > 180) throw new Error('Choose coordinates between 75°S and 75°N, with longitude between −180° and 180°.');
  if (!Number.isFinite(settings.radiusM) || settings.radiusM < 1000 || settings.radiusM > 6000) throw new Error('Choose a search radius between 1 and 6 km.');
  if (!Number.isFinite(settings.targetKm) || settings.targetKm < 3 || settings.targetKm > 40) throw new Error('Choose a target distance between 3 and 40 km.');
  if (![0.1, 0.2, 0.3].includes(settings.tolerance) || !['mixed', 'paved'].includes(settings.surface) || !['quiet', 'balanced'].includes(settings.style)) throw new Error('Choose valid route preferences.');
  if (settings.circleRadiusM !== undefined && (!Number.isFinite(settings.circleRadiusM) || settings.circleRadiusM < 500 || settings.circleRadiusM > 4500 || settings.circleRadiusM >= settings.radiusM || Math.abs(distance(settings.start, settings.center) - settings.circleRadiusM) > 2 || Math.abs(settings.targetKm * 1000 - settings.circleRadiusM * 2 * Math.PI) > 10)) throw new Error('Choose a valid circle size and a start on its edge.');
  if (distance(settings.start, settings.center) > settings.radiusM) throw new Error('Your start is outside the search area. Move the start or expand the area.');
  if (Math.abs(settings.center.lon) + settings.radiusM / (111000 * Math.cos(settings.center.lat * Math.PI / 180)) >= 180) throw new Error('Choose an area that does not cross the date line.');
}

export function solve(data: OsmData, settings: Settings, progress: (message: string) => void = () => {}, options: { graph?: Graph; timing?: SolveTiming } = {}): Route {
  const started = performance.now();
  validateSettings(settings);
  let graph = options.graph ?? loopCore(buildGraph(data, settings));
  const prepared = performance.now();
  if (options.timing && !options.graph) options.timing.graphMs = prepared - started;
  let start = -1;
  let snapM = Infinity;
  for (const [id, node] of graph.nodes) {
    if (!(graph.edges.get(id)?.length)) continue;
    const d = distance(node, settings.start);
    if (d < snapM) { start = id; snapM = d; }
  }
  if (snapM > 300) throw new Error('No usable cycling loop start within 300 m of your pin. Move the start onto a mapped road or permitted cycle path.');
  graph = returnableComponent(graph, start);
  const origin = graph.nodes.get(start)!;
  const searchStarted = performance.now();
  if (options.timing) options.timing.snapComponentMs = searchStarted - prepared;
  const targetM = settings.targetKm * 1000;
  const baseRadius = targetM / (2 * Math.PI);
  const circles: { center: Point; radius: number; clockwise: boolean }[] = [];
  // Include a ring around the selected area, then circles that pass through the
  // start. Test several radii, orientations, and both travel directions.
  if (settings.circleRadiusM !== undefined) {
    // The circle-hand UI selects an explicit geographic center and size. Keep
    // that center stable; the existing path search may fit nearby ring radii.
    for (const scale of [1, 0.9, 1.1]) for (const clockwise of [true, false]) circles.push({ center: settings.center, radius: settings.circleRadiusM * scale, clockwise });
  } else for (const scale of [1, 0.8, 1.15]) {
    const radius = baseRadius * scale;
    if (distance(settings.center, origin) > radius * 0.55) {
      for (const clockwise of [true, false]) circles.push({ center: settings.center, radius, clockwise });
    }
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const center = offset(origin, Math.cos(angle) * radius, Math.sin(angle) * radius);
      if (distance(center, settings.center) + radius > settings.radiusM * 1.18) continue;
      for (const clockwise of [true, false]) circles.push({ center, radius, clockwise });
    }
  }
  const budget: Budget = { remaining: 1800000, deadline: Date.now() + 14000 };
  let best: Route | undefined;
  let bestScore = Infinity;
  let candidates = 0;
  let limited = false;
  let closestError = Infinity;
  const projections = new Map<string, Projected[]>();
  const radialCosts = new Map<string, Map<number, number>>();
  for (let index = 0; index < circles.length; index++) {
    if (Date.now() > budget.deadline || budget.remaining <= 0) { limited = true; break; }
    const circle = circles[index];
    progress(`Comparing road loops · ${index + 1} of ${circles.length}`);
    const centerKey = `${circle.center.lat}/${circle.center.lon}`;
    let projected = projections.get(centerKey);
    if (!projected) { projected = projectNodes(graph, circle.center); projections.set(centerKey, projected); if (projections.size > 2) projections.delete(projections.keys().next().value!); if (options.timing) options.timing.anchorNodeProjections += projected.length; }
    const radiusKey = `${centerKey}/${circle.radius}`;
    let costs = radialCosts.get(radiusKey);
    if (!costs) { costs = new Map(); radialCosts.set(radiusKey, costs); if (radialCosts.size > 4) radialCosts.delete(radialCosts.keys().next().value!); }
    const anchors = chooseAnchors(graph, start, circle.center, circle.radius, circle.clockwise, projected);
    if (!anchors) continue;
    const used = new Set<string>();
    const routeEdges: Edge[] = [];
    let failed = false;
    try {
      for (let i = 0; i < anchors.length; i++) {
        const path = shortestPath(graph, anchors[i], anchors[(i + 1) % anchors.length], {
          previous: routeEdges.at(-1), first: i === anchors.length - 1 ? routeEdges[0] : undefined,
          center: circle.center, radius: circle.radius, used, budget, radialCosts: costs,
        });
        if (!path?.length) { failed = true; break; }
        routeEdges.push(...path);
        path.forEach(e => used.add(physicalKey(e)));
      }
    } catch (error) {
      if (!(error instanceof SearchLimit)) throw error;
      limited = true; break;
    }
    if (failed) continue;
    const points = [origin, ...routeEdges.map(e => graph.nodes.get(e.to)!)].map(({ lat, lon }) => ({ lat, lon }));
    const lengthM = trackLength(points);
    const error = Math.abs(lengthM - targetM) / targetM;
    closestError = Math.min(closestError, error);
    const round = roundness(points);
    const seen = new Set<string>();
    let repeatedM = 0;
    let unknownM = 0;
    for (const edge of routeEdges) {
      const key = physicalKey(edge);
      if (seen.has(key)) repeatedM += edge.length;
      seen.add(key);
      if (!edge.surfaceKnown) unknownM += edge.length;
    }
    const repeated = repeatedM / lengthM;
    candidates++;
    if (error > settings.tolerance || round < 0.3 || repeated > 0.2) continue;
    const score = error * 3 + (1 - round) * 1.5 + repeated * 4;
    if (score < bestScore) {
      bestScore = score;
      best = { points, lengthM, error, roundness: round, repeated, unknownSurface: unknownM / lengthM, snapM, circleCenter: circle.center, circleRadiusM: circle.radius, candidates, notes: [...graph.notes], dataTimestamp: data.osm3s?.timestamp_osm_base };
    }
  }
  if (options.timing) { options.timing.searchMs = performance.now() - searchStarted; options.timing.pathExpansions = 1800000 - budget.remaining; options.timing.totalMs = performance.now() - started; }
  if (!best) {
    const hint = Number.isFinite(closestError) ? ` Closest closed candidate was ${Math.round(closestError * 100)}% from the target.` : '';
    throw new Error(`No sufficiently circular closed loop found within ±${Math.round(settings.tolerance * 100)}% of your target.${hint} Try a shorter distance, wider area, different start, or mixed surfaces.${limited ? ' The bounded search reached its limit.' : ''}`);
  }
  best.candidates = candidates;
  if (limited) best.notes.push('Search stopped at its time/work limit; this is the best acceptable loop found so far.');
  if (best.snapM > 25) best.notes.push(`Start snapped ${Math.round(best.snapM)} m to the cycling network. Travel to the snapped start is not included.`);
  if (best.repeated > 0.02) best.notes.push(`${Math.round(best.repeated * 100)}% of the distance repeats a mapped section.`);
  if (best.unknownSurface > 0.05) best.notes.push(`${Math.round(best.unknownSurface * 100)}% of the route has no surface tag.`);
  return best;
}
