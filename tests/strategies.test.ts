import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { changeCircle, pointOnCircle } from '../src/circle';
import { exampleSettings } from '../src/selection';
import { compileCoverage, covers, CoverageGapError, expandCoverage, initialCoverage, validateCoverage } from '../src/routing/coverage';
import { RoutingEngine } from '../src/routing/engine';
import { buildGraph, turnAllowed } from '../src/routing/graph';
import { distance } from '../src/routing/geo';
import { toGpx } from '../src/routing/gpx';
import { queryFor } from '../src/routing/overpass';
import { planRoute } from '../src/routing/plan';
import { radialDeviation, shortestPath } from '../src/routing/solve';
import { comparisonOptions } from '../src/routing/strategies';
import type { CoverageStrategy } from '../src/routing/strategies';
import type { Edge, Graph, OsmData, Route } from '../src/routing/types';
import type { loadNetwork } from '../src/routing/overpass';
import { circleFixture } from './fixtures';
import { denseGrid, ringRoads, ruralTree, selectCompleteWays } from './corridor-fixtures';
const read = (name: string): OsmData => JSON.parse(gunzipSync(readFileSync(new URL(`./data/${name}`, import.meta.url))).toString());
export function assertLegal(route: Route, graph: Graph) {
  expect(route.points[0]).toEqual(route.points.at(-1));
  const ids = new Map([...graph.nodes.values()].map(node => [`${node.lat}/${node.lon}`, node.id]));
  const edges: Edge[] = [];
  for (let i = 1; i < route.points.length; i++) {
    const from = ids.get(`${route.points[i - 1].lat}/${route.points[i - 1].lon}`), to = ids.get(`${route.points[i].lat}/${route.points[i].lon}`);
    const edge = graph.edges.get(from!)?.find(edge => edge.to === to);
    expect(edge).toBeDefined(); expect(turnAllowed(graph, edges.at(-1), edge!)).toBe(true); edges.push(edge!);
    if (graph.coverage?.kind === 'corridor') expect(compileCoverage(graph.coverage).segment(route.points[i - 1], route.points[i])).toBe(true);
  }
  expect(turnAllowed(graph, edges.at(-1), edges[0])).toBe(true);
  expect(route.error).toBeLessThanOrEqual(.3); expect(route.repeated).toBeLessThanOrEqual(.2);
  expect(toGpx(route).match(/<trkpt /g)).toHaveLength(route.points.length);
}
it('selects search and coverage independently; unknown URL values preserve baseline', () => {
  expect(comparisonOptions('')).toEqual({ searchStrategy: 'nearest', coverageStrategy: 'corridor' });
  expect(comparisonOptions('?routeSearch=joint')).toEqual({ searchStrategy: 'joint', coverageStrategy: 'corridor' });
  expect(comparisonOptions('?roadCoverage=hybrid-small')).toEqual({ searchStrategy: 'nearest', coverageStrategy: 'hybrid-small' });
  expect(comparisonOptions('?routeSearch=bad&roadCoverage=bad')).toEqual(comparisonOptions(''));
});
it('uses an explicitly queried padded disk only at <=1km; never calls corridor coverage a disk', () => {
  expect(() => initialCoverage({ ...exampleSettings(), radiusM: 6000 }, 'hybrid-small')).toThrow('padded circle boundary');
  for (const radiusM of [500, 1000, 1001, 10000]) {
    const settings = changeCircle(exampleSettings(), { radiusM });
    const coverage = initialCoverage(settings, 'hybrid-small'); validateCoverage(coverage);
    expect(coverage.kind).toBe(radiusM <= 1000 ? 'disk' : 'corridor');
    if (coverage.kind === 'disk') {
      expect(coverage.radiusM).toBe(settings.radiusM + 50);
      expect(queryFor(settings, coverage)).toContain(`way(around:${settings.radiusM + 50},`);
      expect(queryFor(settings, coverage)).toContain('[timeout:25][maxsize:33554432]');
      expect(covers(initialCoverage(settings), coverage)).toBe(false);
    } else expect(coverage.clipMarginM).toBe(25);
  }
});
it('joint choices recover a grid loop without moving the snapped Start or relaxing quality', () => {
  const full = denseGrid(), settings = changeCircle(circleFixture().settings, { radiusM: 1000, bearing: 90 });
  for (const coverageStrategy of ['corridor', 'hybrid-small'] as CoverageStrategy[]) {
    const coverage = initialCoverage(settings, coverageStrategy), data = selectCompleteWays(full, coverage), engine = new RoutingEngine(); engine.setData(data, coverage);
    expect(() => engine.solve(settings, () => {}, coverage)).toThrow('27%');
    const result = engine.solve(settings, () => {}, coverage, { strategy: 'joint' });
    expect(result.route.lengthM).toBeCloseTo(6500, 3); expect(result.route.error).toBeLessThan(.04); expect(result.route.repeated).toBe(0);
    expect(distance(result.route.points[0], settings.start)).toBeLessThan(.1);
    assertLegal(result.route, buildGraph(data, settings, coverage));
    expect(result.timing.pathExpansions).toBeLessThanOrEqual(1800000);
  }
});
it('replays actual Vancouver snapshots with identical baseline GPX and legal joint result', () => {
  const settings = exampleSettings(), engine = new RoutingEngine(); const initial = initialCoverage(settings);
  engine.setData(read('vancouver-corridor-initial-2026-10-28.osm.json.gz'), initial);
  let gap: CoverageGapError | undefined;
  try { engine.solve(settings, () => {}, initial); } catch (error) { if (error instanceof CoverageGapError) gap = error; else throw error; }
  expect(gap).toBeDefined(); if (initial.kind !== 'corridor') throw new Error('fixture');
  const coverage = expandCoverage(initial, gap!.gaps)!, data = read('vancouver-corridor-expanded-2026-10-28.osm.json.gz'); engine.setData(data, coverage);
  const baseline = engine.solve(settings, () => {}, coverage, { pinnedStartId: gap!.startNodeId }).route;
  expect(createHash('sha256').update(toGpx(baseline)).digest('hex')).toBe('c694ec13f8376818a767951b35abb426968c48ee66ad30f51290bf4c76444cae');
  const joint = engine.solve(settings, () => {}, coverage, { strategy: 'joint', pinnedStartId: gap!.startNodeId }).route;
  expect(joint.startNodeId).toBe(baseline.startNodeId); expect(joint.error).toBeLessThan(baseline.error); expect(joint.repeated).toBeLessThan(baseline.repeated);
  expect(joint.radialDeviation!.minM).toBeGreaterThan(0); assertLegal(joint, buildGraph(data, settings, coverage));
  expect(() => engine.solve(settings, () => {}, coverage, { strategy: 'joint', pinnedStartId: -99 })).toThrow('not moved automatically');
});
it('preserves 25m guard, including high-latitude rounded 10km boundaries; diagnostic 10m is not production coverage', () => {
  const settings = exampleSettings(), coverage = initialCoverage(settings); if (coverage.kind !== 'corridor') throw new Error('fixture');
  const insideHole = pointOnCircle(settings.center, 140, 90);
  expect(compileCoverage(coverage).contains(insideHole)).toBe(false);
  expect(compileCoverage({ ...coverage, clipMarginM: 10 }).contains(insideHole)).toBe(true);
  expect(() => validateCoverage({ ...coverage, clipMarginM: 10 })).toThrow();
  for (const lat of [-75, 0, 75]) {
    const selected = changeCircle(settings, { center: { lat, lon: 10 }, radiusM: 10000 }), region = initialCoverage(selected); if (region.kind !== 'corridor') throw new Error('fixture');
    const known = compileCoverage(region), angle = 37, boundary = 10000 + region.halfWidthM - 25;
    expect(known.contains(pointOnCircle(selected.center, boundary - 30, angle))).toBe(true);
    expect(known.contains(pointOnCircle(selected.center, boundary + 30, angle))).toBe(false);
    expect(known.segment(pointOnCircle(selected.center, 10000, 90), pointOnCircle(selected.center, 10000, 270))).toBe(false);
  }
});
it('joint fails honestly on a peninsula tree and disconnected Start', () => {
  const settings = changeCircle(circleFixture().settings, { radiusM: 1000, bearing: 90 });
  for (const full of [ruralTree(), circleFixture(64, 2000).data]) {
    const coverage = initialCoverage(settings, 'hybrid-small'), data = selectCompleteWays(full, coverage), engine = new RoutingEngine(); engine.setData(data, coverage);
    expect(() => engine.solve(settings, () => {}, coverage, { strategy: 'joint' })).toThrow(/start|network/i);
  }
});
it('preserves a pinned Start when available across bounded bridge expansion and never fans out providers', async () => {
  const settings = changeCircle(circleFixture().settings, { radiusM: 2000, bearing: 90 }), full = ringRoads(true), engine = new RoutingEngine(); let requests = 0, firstStart: number | undefined;
  const load: typeof loadNetwork = async (_selected, signal, _client, options = {}) => {
    signal.throwIfAborted(); expect(++requests).toBeLessThanOrEqual(2);
    const coverage = options.coverage!, data = selectCompleteWays(full, coverage), bytes = Buffer.byteLength(JSON.stringify(data));
    options.budget!.remainingRequests--; options.budget!.remainingBytes -= bytes; options.budget!.remainingElements -= data.elements.length;
    return { data, cached: false, datasetId: String(requests), coverage, sourceCoverage: coverage, timing: { fetchMs: 0, parseMs: 0, bytes, cacheHit: false, elements: data.elements.length, queryAreaM2: 0, queryVertices: 0 } };
  };
  const result = await planRoute(settings, new AbortController().signal, () => {}, async (network, selected, signal, progress, options) => {
    signal.throwIfAborted(); engine.setData(network.data, network.sourceCoverage);
    try { const solved = engine.solve(selected, progress, network.coverage, options); expect(options?.pinnedStartId).toBe(firstStart); return { ...solved, transferMs: 0 }; }
    catch (error) { if (error instanceof CoverageGapError) firstStart = error.startNodeId; throw error; }
  }, { load, searchStrategy: 'joint', coverageStrategy: 'hybrid-small' });
  expect(requests).toBe(2); expect(result.route.startNodeId).toBe(firstStart ?? 1); expect(result.route.error).toBeLessThan(.09);
});
it('alternative arrivals keep incoming turn state and closing seam constraints', () => {
  const graph: Graph = { nodes: new Map([1, 2, 3, 4].map(id => [id, { type: 'node', id, lat: 0, lon: id / 1000 }])), edges: new Map(), turns: new Map([[2, [{ from: 10, to: 30, only: false, uturn: false }]]]), notes: [] };
  const add = (from: number, to: number, way: number, length: number) => { const edge = { from, to, way, length, factor: 1, surfaceKnown: true }; graph.edges.set(from, [...(graph.edges.get(from) ?? []), edge]); return edge; };
  const direct = add(1, 2, 10, 1); add(1, 3, 20, 2); add(3, 2, 21, 2); const exit = add(2, 4, 30, 1); const close = add(4, 1, 40, 1);
  expect(shortestPath(graph, 1, 2)).toEqual([direct]);
  const alternative = shortestPath(graph, 1, 2, { excludeArrivals: new Set(['2/1/10']) })!;
  expect(alternative.map(edge => edge.way)).toEqual([20, 21]);
  expect(shortestPath(graph, 2, 4, { previous: direct })).toBeNull();
  expect(shortestPath(graph, 2, 1, { previous: alternative.at(-1), first: alternative[0] })).toEqual([exit, close]);
  graph.turns.set(1, [{ from: 40, to: 20, only: false, uturn: false }]);
  expect(shortestPath(graph, 2, 1, { previous: alternative.at(-1), first: alternative[0] })).toBeNull();
});
it('radial diagnostics include a chord crossing the center and remain distinct from target size', () => {
  const center = { lat: 0, lon: 0 }, points = [pointOnCircle(center, 500, 90), pointOnCircle(center, 500, 270)];
  const result = radialDeviation(points, center, 500); expect(result.minM).toBeCloseTo(0, 4); expect(result.maxM).toBeCloseTo(500, 3); expect(result.meanAbsoluteM).toBeCloseTo(250, 0); expect(distance(points[0], points[1])).toBeCloseTo(1000, 2);
});
it('joint search honors a directed cycling ring and rejects a forbidden closing turn', () => {
  const fixture = circleFixture(64, 1000), settings = changeCircle(fixture.settings, { radiusM: 1000, bearing: 90 });
  const data: OsmData = { elements: fixture.data.elements.map(element => element.type === 'way' ? { ...element, tags: { ...element.tags, oneway: 'yes' } } : element) };
  const engine = new RoutingEngine(); engine.setData(data);
  const route = engine.solve(settings, () => {}, undefined, { strategy: 'joint' }).route;
  expect(route.startNodeId).toBe(1); assertLegal(route, buildGraph(data, settings));
  const restricted: OsmData = { elements: [...data.elements, { type: 'relation', id: 5000, tags: { type: 'restriction', restriction: 'no_straight_on' }, members: [{ type: 'way', role: 'from', ref: 1000 }, { type: 'node', role: 'via', ref: 1 }, { type: 'way', role: 'to', ref: 1000 }] }] };
  engine.setData(restricted); expect(() => engine.solve(settings, () => {}, undefined, { strategy: 'joint' })).toThrow('No sufficiently');
});
it('does not relabel a saved baseline expansion as coverage for joint search\'s different gaps', () => {
  const settings = exampleSettings(), initial = initialCoverage(settings); if (initial.kind !== 'corridor') throw new Error('fixture');
  const engine = new RoutingEngine(); engine.setData(read('vancouver-corridor-initial-2026-10-28.osm.json.gz'), initial);
  const gaps: Partial<Record<'nearest' | 'joint', CoverageGapError>> = {};
  for (const strategy of ['nearest', 'joint'] as const) try { engine.solve(settings, () => {}, initial, { strategy }); } catch (error) { if (error instanceof CoverageGapError) gaps[strategy] = error; else throw error; }
  const known = expandCoverage(initial, gaps.nearest!.gaps)!, requested = expandCoverage(initial, gaps.joint!.gaps)!;
  expect(covers(known, requested)).toBe(false); expect(gaps.nearest!.startNodeId).toBe(gaps.joint!.startNodeId);
  engine.setData(read('vancouver-corridor-expanded-2026-10-28.osm.json.gz'), known);
  expect(() => engine.solve(settings, () => {}, requested, { strategy: 'joint' })).toThrow('does not cover');
});

it('cleans planning timers/listeners when small-disk bounds reject and never makes a request', async () => {
  vi.useFakeTimers(); try {
    const signal = new AbortController().signal, removed = vi.spyOn(signal, 'removeEventListener'), load = vi.fn(), search = vi.fn();
    await expect(planRoute({ ...exampleSettings(), radiusM: 6000 }, signal, () => {}, search, { load, coverageStrategy: 'hybrid-small' })).rejects.toThrow('padded circle boundary');
    expect(load).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  } finally { vi.useRealTimers(); }
});
