import { describe, expect, it, vi } from 'vitest';
import { changeCircle } from '../src/circle';
import { compileCoverage, CoverageGapError, initialCoverage } from '../src/routing/coverage';
import { RoutingEngine } from '../src/routing/engine';
import { buildGraph, turnAllowed } from '../src/routing/graph';
import { toGpx } from '../src/routing/gpx';
import { coverageCost } from '../src/routing/coverage';
import { planRoute } from '../src/routing/plan';
import { newFetchBudget, type NetworkResult, type loadNetwork } from '../src/routing/overpass';
import { solve } from '../src/routing/solve';
import { circleFixture } from './fixtures';
import { denseGrid, ringRoads, ruralTree, selectCompleteWays } from './corridor-fixtures';
import type { OsmData } from '../src/routing/types';
const settings = () => changeCircle(circleFixture().settings, { radiusM: 2000, bearing: 90 });
function offline(full: OsmData) {
  const calls: NetworkResult[] = [], engine = new RoutingEngine();
  const load: typeof loadNetwork = async (selected, _signal, _client, options = {}) => {
    const coverage = options.coverage ?? initialCoverage(selected), data = selectCompleteWays(full, coverage), bytes = JSON.stringify(data).length;
    if (options.budget) { if (--options.budget.remainingRequests < 0) throw new Error('request budget'); options.budget.remainingBytes -= bytes; options.budget.remainingElements -= data.elements.length; }
    const cost = coverageCost(coverage), result: NetworkResult = { data, datasetId: `fixture-${calls.length}`, cached: false, coverage, sourceCoverage: coverage, timing: { fetchMs: 0, parseMs: 0, bytes, cacheHit: false, elements: data.elements.length, queryAreaM2: cost.areaM2, queryVertices: cost.vertices } };
    calls.push(result); return result;
  };
  const search = async (network: NetworkResult, selected: ReturnType<typeof settings>, signal: AbortSignal, progress: (message: string) => void) => { signal.throwIfAborted(); engine.setData(network.data, network.sourceCoverage); return { ...engine.solve(selected, progress, network.coverage), transferMs: 0 }; };
  return { calls, load, search };
}
describe('bounded offline adaptive prototype', () => {
  it('dense grid downloads fewer elements/edges while retaining valid closed route quality', async () => {
    const full = denseGrid(), selected = settings(), disk = selectCompleteWays(full, { kind: 'disk', center: selected.center, radiusM: selected.radiusM + 50 });
    const fixture = offline(full), result = await planRoute(selected, new AbortController().signal, () => {}, fixture.search, { load: fixture.load });
    expect(fixture.calls).toHaveLength(1); expect(fixture.calls[0].data.elements.length).toBeLessThan(disk.elements.length);
    const graph = buildGraph(fixture.calls[0].data, selected, fixture.calls[0].coverage), baseline = buildGraph(disk, selected);
    expect(graph.nodes.size).toBeLessThan(baseline.nodes.size); expect(result.route.error).toBeLessThanOrEqual(selected.tolerance); expect(result.route.roundness).toBeGreaterThanOrEqual(0.3); expect(result.route.points[0]).toEqual(result.route.points.at(-1));
    const known = compileCoverage(fixture.calls[0].coverage);
    for (let i = 1; i < result.route.points.length; i++) expect(known.segment(result.route.points[i - 1], result.route.points[i])).toBe(true);
  });
  it('one local bridge expansion closes a loop and matches disk geometry exactly', async () => {
    const full = ringRoads(true), selected = settings(), fixture = offline(full);
    const result = await planRoute(selected, new AbortController().signal, () => {}, fixture.search, { load: fixture.load });
    expect(fixture.calls).toHaveLength(2); expect(fixture.calls[1].coverage.kind).toBe('corridor');
    expect(toGpx(result.route)).toBe(toGpx(solve(full, selected))); expect(result.metrics.requests).toBe(2);
  });
  it('a rural tree exhausts finite widening and reports no loop, never a straight-line route', async () => {
    const fixture = offline(ruralTree()), selected = settings();
    await expect(planRoute(selected, new AbortController().signal, () => {}, fixture.search, { load: fixture.load })).rejects.toThrow(/coverage|network/);
    expect(fixture.calls.length).toBeLessThanOrEqual(2);
  });
  it('retains selected crossing-way geometry and restrictions without routing through the hole', () => {
    const full = ringRoads(), selected = settings();
    full.elements.push({ type:'node',id:9000,...selected.center }, { type:'way',id:9001,nodes:[1,9000,33],tags:{highway:'residential',surface:'asphalt'} }, { type:'relation',id:9002,tags:{type:'restriction',restriction:'no_left_turn'},members:[{type:'way',ref:10000,role:'from'},{type:'way',ref:9001,role:'to'},{type:'node',ref:1,role:'via'}] });
    const coverage=initialCoverage(selected), data=selectCompleteWays(full,coverage), graph=buildGraph(data,selected,coverage);
    expect(data.elements.some(element=>element.id===9000)).toBe(true); expect(data.elements.some(element=>element.id===9002)).toBe(true); expect(graph.nodes.has(9000)).toBe(false); expect(graph.turns.get(1)).toHaveLength(1);
    const previous=graph.edges.get(2)!.find(edge=>edge.to===1)!;expect(turnAllowed(graph,previous,{from:1,to:9000,way:9001,length:2000,factor:1,surfaceKnown:true})).toBe(false);
  });
  it('does not widen provider errors or retry access denials', async () => {
    const fixture=offline(ringRoads()); const load=vi.fn().mockRejectedValue(new Error('HTTP 406'));
    await expect(planRoute(settings(),new AbortController().signal,()=>{},fixture.search,{load})).rejects.toThrow('406');expect(load).toHaveBeenCalledTimes(1);
  });
  it('aborts deadline/cancelled searches and never starts another coverage request', async () => {
    const fixture=offline(ringRoads()),controller=new AbortController();
    const search=vi.fn((_network,_selected,signal:AbortSignal)=>new Promise<never>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
    const pending=planRoute(settings(),controller.signal,()=>{},search,{load:fixture.load});
    await Promise.resolve();controller.abort();await expect(pending).rejects.toThrow();expect(fixture.calls).toHaveLength(1);
    const budget=newFetchBudget();budget.deadline=performance.now()+15;
    await expect(planRoute(settings(),new AbortController().signal,()=>{},search,{load:fixture.load,budget})).rejects.toThrow('time budget');expect(fixture.calls).toHaveLength(2);
  });
  it('permits at most two searches even if a mock keeps reporting frontier gaps', async () => {
    const fixture=offline(ringRoads());const search=vi.fn().mockRejectedValue(new CoverageGapError('gap',[settings().start]));
    await expect(planRoute(settings(),new AbortController().signal,()=>{},search,{load:fixture.load})).rejects.toThrow('bounded');expect(search).toHaveBeenCalledTimes(2);expect(fixture.calls).toHaveLength(2);
  });
});
