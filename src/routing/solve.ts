import { NoLoopError, type SearchBudget, type SearchOptions } from './strategies';
import { CoverageGapError } from './coverage';
import { angleDelta, distance, offset, roundness, trackLength, xy } from './geo';
import { MAX_CIRCLE_RADIUS_M, MAX_SHARED_QUERY_RADIUS_M } from './limits';
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
type Budget = SearchBudget;
class SearchLimit extends Error {}
const edgeKeys = new WeakMap<Edge, string>(), physicalKeys = new WeakMap<Edge, string>();
const edgeKey = (edge: Edge) => { let key = edgeKeys.get(edge); if (key === undefined) { key = `${edge.to}/${edge.from}/${edge.way}`; edgeKeys.set(edge, key); } return key; };
const physicalKey = (edge: Edge) => { let key = physicalKeys.get(edge); if (key === undefined) { key = `${Math.min(edge.from, edge.to)}/${Math.max(edge.from, edge.to)}`; physicalKeys.set(edge, key); } return key; };

export function shortestPath(graph: Graph, from: number, to: number, options: { previous?: Edge; first?: Edge; center?: Point; radius?: number; used?: Set<string>; budget?: Budget; radialCosts?: Map<number, number>; excludeArrivals?: Set<string> } = {}): Edge[] | null {
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
      if (options.budget.remaining <= 0 || (options.budget.remaining % 512 === 0 && performance.now() >= options.budget.deadline)) throw new SearchLimit();
      options.budget.remaining--;
    }
    if (state.node === to && state.previous && options.excludeArrivals?.has(edgeKey(state.previous))) continue;
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
export function chooseAnchors(graph: Graph, start: number, center: Point, radius: number, clockwise: boolean, projected = projectNodes(graph, center), onMissing?: (point: Point) => void): number[] | null {
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
    if (best === undefined) { onMissing?.(offset(center, ideal[0], ideal[1])); return null; }
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

// A beam state owns its whole path and incoming turn state. Node reachability
// alone is insufficient: two arrivals at one anchor can permit different turns.
export function jointPaths(graph: Graph, start: number, center: Point, radius: number, clockwise: boolean, projected: Projected[], targetM: number, tolerance: number, budget: Budget, radialCosts: Map<number, number>, missing: (point: Point) => void): Edge[][] {
  type Beam = { node: number; edges: Edge[]; used: Set<string>; anchors: Set<number>; length: number; repeated: number; cost: number };
  let beam: Beam[] = [{ node: start, edges: [], used: new Set(), anchors: new Set([start]), length: 0, repeated: 0, cost: 0 }];
  const local = xy(graph.nodes.get(start)!, center), angle0 = Math.atan2(local[1], local[0]);
  const maximum = targetM * (1 + tolerance), complete: Edge[][] = [];
  for (let sector = 1; sector <= 8; sector++) {
    const angle = angle0 + (clockwise ? -1 : 1) * sector * Math.PI / 4;
    const ideal = offset(center, radius * Math.cos(angle), radius * Math.sin(angle));
    const ranked = sector === 8 ? [{ id: start }] : projected.filter(node => node.id !== start && node.radial >= radius * .5 && node.radial <= radius * 1.5 && angleDelta(node.angle, angle) <= Math.PI / 8).sort((a, b) => distance(graph.nodes.get(a.id)!, ideal) - distance(graph.nodes.get(b.id)!, ideal) || a.id - b.id);
    const pool: { id: number }[] = [];
    // Geometric diversity avoids spending every slot on adjacent way vertices.
    for (const candidate of ranked) {
      if (pool.every(known => distance(graph.nodes.get(known.id)!, graph.nodes.get(candidate.id)!) >= Math.min(75, radius * .1))) pool.push(candidate);
      if (pool.length === 3) break;
    }
    const junction = ranked.find(candidate => new Set((graph.edges.get(candidate.id) ?? []).map(edge => edge.to)).size >= 3);
    if (junction && !pool.some(candidate => candidate.id === junction.id)) pool.push(junction);
    if (!pool.length) { missing(ideal); return []; }
    const next: Beam[] = [];
    for (const state of beam) for (const candidate of pool) {
      if (sector !== 8 && state.anchors.has(candidate.id)) continue;
      const arrivals = new Set<string>();
      // At most two arrival headings per candidate, including legal closing seam.
      for (let alternative = 0; alternative < 2; alternative++) {
        let path: Edge[] | null;
        try { path = shortestPath(graph, state.node, candidate.id, { previous: state.edges.at(-1), first: sector === 8 ? state.edges[0] : undefined, center, radius, used: state.used, budget, radialCosts, excludeArrivals: arrivals }); }
        catch (error) { if (error instanceof SearchLimit && complete.length) return complete; throw error; }
        if (!path?.length) { if (!alternative) missing(graph.nodes.get(state.node)!); break; }
        arrivals.add(edgeKey(path.at(-1)!));
        let length = state.length, repeated = state.repeated, cost = state.cost;
        const used = new Set(state.used);
        for (const edge of path) { length += edge.length; const reused = used.has(physicalKey(edge)); if (reused) repeated += edge.length; cost += edge.length * (edge.factor + (radialCosts.get(edge.to) ?? 0) + (reused ? 5 : 0)); used.add(physicalKey(edge)); }
        if (length + distance(graph.nodes.get(candidate.id)!, graph.nodes.get(start)!) > maximum || repeated > maximum * .2) continue;
        const edges = [...state.edges, ...path];
        if (sector === 8) { complete.push(edges); continue; }
        next.push({ node: candidate.id, edges, used, anchors: new Set([...state.anchors, candidate.id]), length, repeated, cost });
      }
    }
    // Preserve different incoming headings and first edges (closure legality).
    const seen = new Set<string>();
    beam = next.sort((a, b) => a.cost - b.cost || a.node - b.node).filter(state => { const key = `${state.node}/${edgeKey(state.edges.at(-1)!)}/${edgeKey(state.edges[0])}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 4);
    if (!beam.length && sector < 8) return [];
  }
  return complete;
}

// Sample each original segment at <=25 m intervals, including the nearest
// projected point to the center. This is a diagnostic approximation, not a new
// routing constraint or an assertion of a perfectly circular route.
export function radialDeviation(points: Point[], center: Point, radius: number) {
  let minM = Infinity, maxM = 0, integral = 0, total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b), steps = Math.max(1, Math.ceil(length / 25));
    const [ax, ay] = xy(a, center), [bx, by] = xy(b, center), dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    minM = Math.min(minM, Math.hypot(ax + t * dx, ay + t * dy));
    for (let j = 0; j <= steps; j++) {
      const part = j / steps, radial = distance({ lat: a.lat + (b.lat - a.lat) * part, lon: a.lon + (b.lon - a.lon) * part }, center);
      minM = Math.min(minM, radial); maxM = Math.max(maxM, radial);
      integral += Math.abs(radial - radius) * length / steps * (j === 0 || j === steps ? .5 : 1);
    }
    total += length;
  }
  return { minM: Number.isFinite(minM) ? minM : 0, maxM, meanAbsoluteM: total ? integral / total : 0 };
}

export function validateSettings(settings: Settings) {
  for (const point of [settings.center, settings.start]) if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 75 || Math.abs(point.lon) > 180) throw new Error('Choose coordinates between 75°S and 75°N, with longitude between −180° and 180°.');
  if (!Number.isFinite(settings.radiusM) || settings.radiusM < 1000 || settings.radiusM > MAX_CIRCLE_RADIUS_M * 1.35 || (settings.circleRadiusM === undefined && settings.radiusM > MAX_SHARED_QUERY_RADIUS_M)) throw new Error('Choose a valid search radius: 1–6 km, or a padded boundary for an explicit circle up to 10 km radius.');
  if (!Number.isFinite(settings.targetKm) || settings.targetKm < 3 || settings.targetKm > MAX_CIRCLE_RADIUS_M * 2 * Math.PI / 1000) throw new Error('Choose a valid target distance for a circle up to 10 km radius.');
  if (![0.1, 0.2, 0.3].includes(settings.tolerance) || !['mixed', 'paved'].includes(settings.surface) || !['quiet', 'balanced'].includes(settings.style)) throw new Error('Choose valid route preferences.');
  if (settings.circleRadiusM !== undefined && (!Number.isFinite(settings.circleRadiusM) || settings.circleRadiusM < 500 || settings.circleRadiusM > MAX_CIRCLE_RADIUS_M || settings.circleRadiusM >= settings.radiusM || Math.abs(distance(settings.start, settings.center) - settings.circleRadiusM) > 2 || Math.abs(settings.targetKm * 1000 - settings.circleRadiusM * 2 * Math.PI) > 10)) throw new Error('Choose a valid circle size and a start on its edge.');
  if (distance(settings.start, settings.center) > settings.radiusM) throw new Error('Your start is outside the search area. Move the start or expand the area.');
  if (Math.abs(settings.center.lon) + settings.radiusM / (111000 * Math.cos(settings.center.lat * Math.PI / 180)) >= 180) throw new Error('Choose an area that does not cross the date line.');
}

export function solve(data: OsmData, settings: Settings, progress: (message: string) => void = () => {}, options: SearchOptions & { graph?: Graph; timing?: SolveTiming; budget?: SearchBudget } = {}): Route {
  const started = performance.now();
  validateSettings(settings);
  let graph = options.graph ?? loopCore(buildGraph(data, settings));
  const prepared = performance.now();
  if (options.timing && !options.graph) options.timing.graphMs = prepared - started;
  let start = -1;
  let snapM = Infinity;
  for (const [id, node] of graph.nodes) {
    if (options.pinnedStartId !== undefined && id !== options.pinnedStartId) continue;
    if (!(graph.edges.get(id)?.length)) continue;
    const d = distance(node, settings.start);
    if (d < snapM) { start = id; snapM = d; }
  }
  if (options.pinnedStartId !== undefined && snapM > 300) throw new Error('The selected snapped Start is unavailable in the new network. Choose another Start; it was not moved automatically.');
  if (snapM > 300 && graph.coverage?.kind === 'corridor' && graph.frontier?.length) throw new CoverageGapError('No returnable start in the downloaded corridor.', [...graph.frontier].sort((a, b) => distance(a, settings.start) - distance(b, settings.start)).slice(0, 2));
  if (snapM > 300) throw new Error('No usable cycling loop start within 300 m of your pin. Move the start onto a mapped road or permitted cycle path.');
  graph = returnableComponent(graph, start);
  const origin = graph.nodes.get(start)!;
  const searchStarted = performance.now();
  if (options.timing) options.timing.snapComponentMs = searchStarted - prepared;
  const targetM = settings.targetKm * 1000;
  const baseRadius = targetM / (2 * Math.PI);
  const circles: { center: Point; radius: number; clockwise: boolean; junctions?: boolean }[] = [];
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
  // Geometrically nearest degree-two nodes can force long alley/seawall detours.
  // Only after every original candidate fails, try the same sectors at junctions.
  // Keep all original successes and share the existing work/time budget.
  const originalCircleCount = circles.length;
  if (options.strategy !== 'joint' && settings.circleRadiusM !== undefined) circles.push(...circles.map(circle => ({ ...circle, junctions: true })));
  const junctions = new Set([...graph.edges].filter(([, edges]) => new Set(edges.map(edge => edge.to)).size >= 3).map(([id]) => id));
  let primaryCandidates = 0;
  const budget: Budget = options.budget ?? { remaining: 1800000, deadline: performance.now() + 14000 };
  const startingExpansions = budget.remaining;
  let best: Route | undefined;
  let bestScore = Infinity;
  let candidates = 0;
  let limited = false;
  let closestError = Infinity;
  const missingConnections: Point[] = [];
  const projections = new Map<string, Projected[]>();
  const radialCosts = new Map<string, Map<number, number>>();
  for (let index = 0; index < circles.length; index++) {
    if (index === originalCircleCount && best) break;
    if (performance.now() > budget.deadline || budget.remaining <= 0) { limited = true; break; }
    const circle = circles[index];
    progress(`Comparing road loops · ${index + 1} of ${circles.length}`);
    const centerKey = `${circle.center.lat}/${circle.center.lon}`;
    let projected = projections.get(centerKey);
    if (!projected) { projected = projectNodes(graph, circle.center); projections.set(centerKey, projected); if (projections.size > 2) projections.delete(projections.keys().next().value!); if (options.timing) options.timing.anchorNodeProjections += projected.length; }
    const radiusKey = `${centerKey}/${circle.radius}`;
    let costs = radialCosts.get(radiusKey);
    if (!costs) { costs = new Map(); radialCosts.set(radiusKey, costs); if (radialCosts.size > 4) radialCosts.delete(radialCosts.keys().next().value!); }
    let paths: Edge[][] = [];
    try {
      if (options.strategy === 'joint') {
        paths = jointPaths(graph, start, circle.center, circle.radius, circle.clockwise, projected, targetM, settings.tolerance, budget, costs, point => missingConnections.push(point));
      } else {
        const anchors = chooseAnchors(graph, start, circle.center, circle.radius, circle.clockwise, circle.junctions ? projected.filter(node => junctions.has(node.id)) : projected, point => missingConnections.push(point));
        if (!anchors) continue;
        const used = new Set<string>(), edges: Edge[] = [];
        for (let i = 0; i < anchors.length; i++) {
          const path = shortestPath(graph, anchors[i], anchors[(i + 1) % anchors.length], {
            previous: edges.at(-1), first: i === anchors.length - 1 ? edges[0] : undefined,
            center: circle.center, radius: circle.radius, used, budget, radialCosts: costs,
          });
          if (!path?.length) { missingConnections.push(graph.nodes.get(anchors[i])!); break; }
          edges.push(...path); path.forEach(edge => used.add(physicalKey(edge)));
          if (i === anchors.length - 1) paths = [edges];
        }
      }
    } catch (error) {
      if (!(error instanceof SearchLimit)) throw error;
      limited = true; break;
    }
    for (const routeEdges of paths) {
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
      if (!circle.junctions) primaryCandidates++;
      if (error > settings.tolerance || round < 0.3 || repeated > 0.2) continue;
      const score = error * 3 + (1 - round) * 1.5 + repeated * 4;
      if (score < bestScore) {
        bestScore = score;
        best = { points, startNodeId: start, searchStrategy: options.strategy === 'joint' ? 'joint' : 'nearest', radialDeviation: radialDeviation(points, settings.center, settings.circleRadiusM ?? circle.radius), lengthM, error, roundness: round, repeated, unknownSurface: unknownM / lengthM, snapM, circleCenter: circle.center, circleRadiusM: circle.radius, candidates, notes: [...graph.notes, ...(circle.junctions ? ['Used alternative junction anchors after the nearest anchors failed.'] : [])], dataTimestamp: data.osm3s?.timestamp_osm_base };
      }
    }
  }
  if (options.timing) { options.timing.searchMs = performance.now() - searchStarted; options.timing.pathExpansions = startingExpansions - budget.remaining; options.timing.totalMs = performance.now() - started; }
  if (!best) {
    if (!primaryCandidates && missingConnections.length && graph.coverage?.kind === 'corridor' && graph.frontier?.length) {
      const ranked = [...graph.frontier].sort((a, b) => Math.min(...missingConnections.map(point => distance(a, point))) - Math.min(...missingConnections.map(point => distance(b, point))));
      const gaps: Point[] = []; for (const point of ranked) { if (!gaps.some(known => distance(known, point) < 500)) gaps.push(point); if (gaps.length === 2) break; }
      throw new CoverageGapError('A connection reaches the downloaded corridor boundary.', gaps, start);
    }
    const hint = Number.isFinite(closestError) ? ` Closest closed candidate was ${Math.round(closestError * 100)}% from the target.` : '';
    throw new NoLoopError(`No sufficiently circular closed loop found within ±${Math.round(settings.tolerance * 100)}% of your target.${hint} Try a smaller circle, move its center or Start, increase Route variation, or use mixed surfaces.${graph.coverage?.kind === 'corridor' ? ' No loop was found within downloaded coverage; wider detours are unknown.' : ''}${limited ? ' The bounded search reached its limit.' : ''}`, start);
  }
  best.candidates = candidates;
  limited ||= budget.remaining < 0 || performance.now() > budget.deadline;
  if (limited) best.notes.push('Search stopped at its time/work limit; this is the best acceptable loop found so far.');
  if (best.snapM > 25) best.notes.push(`Start snapped ${Math.round(best.snapM)} m to the cycling network. Travel to the snapped start is not included.`);
  if (best.repeated > 0.02) best.notes.push(`${Math.round(best.repeated * 100)}% of the distance repeats a mapped section.`);
  if (best.unknownSurface > 0.05) best.notes.push(`${Math.round(best.unknownSurface * 100)}% of the route has no surface tag.`);
  return best;
}
