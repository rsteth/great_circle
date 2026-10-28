import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { changeCircle } from '../src/circle';
import { exampleSettings } from '../src/selection';
import { CoverageGapError, initialCoverage } from '../src/routing/coverage';
import { RoutingEngine } from '../src/routing/engine';
import * as graphModule from '../src/routing/graph';
import { toGpx } from '../src/routing/gpx';
import { planRoute, PlanningFailure } from '../src/routing/plan';
import { MAX_SEARCH_LIMITS, SearchFailure } from '../src/routing/strategies';
import type { loadNetwork, NetworkResult } from '../src/routing/overpass';
import type { OsmData, SolveTiming } from '../src/routing/types';
import { circleFixture } from './fixtures';
import { denseGrid, selectCompleteWays } from './corridor-fixtures';
afterEach(() => vi.restoreAllMocks());
const gridSettings = () => changeCircle(circleFixture().settings, { radiusM: 1000, bearing: 90 });
const blankTiming = (pathExpansions = 0, totalMs = 0, clientElapsedMs = totalMs): SolveTiming => ({ graphMs: 0, graphCached: false, snapComponentMs: 0, searchMs: totalMs, totalMs, clientElapsedMs, anchorNodeProjections: 0, pathExpansions });
function caught(run: () => unknown): SearchFailure { try { run(); throw new Error('Expected failure'); } catch (error) { expect(error).toBeInstanceOf(SearchFailure); return error as SearchFailure; } }
it('returns a quick valid loop without flexible search and preserves exact baseline GPX', () => {
 const { data, settings } = circleFixture(), engine = new RoutingEngine(), progress: string[] = []; engine.setData(data);
 const build = vi.spyOn(graphModule, 'buildGraph');
 const result = engine.solve(settings, message => progress.push(message));
 expect(result.timing.stages?.map(stage => stage.strategy)).toEqual(['nearest']); expect(result.route.searchStrategy).toBe('nearest'); expect(progress).toContain('Finding a loop…'); expect(progress.join(' ')).not.toContain('flexible'); expect(build).toHaveBeenCalledTimes(1);
 expect(toGpx(result.route)).toBe(toGpx(engine.solve(settings, () => {}, undefined, { strategy: 'nearest' }).route));
});
it('falls back jointly on the same prepared grid, preserving snapped Start and legal known GPX', () => {
 const settings = gridSettings(), coverage = initialCoverage(settings), data = selectCompleteWays(denseGrid(), coverage), before = structuredClone(data), engine = new RoutingEngine(); engine.setData(data, coverage); const build = vi.spyOn(graphModule, 'buildGraph'), progress: string[] = [];
 const result = engine.solve(settings, message => progress.push(message), coverage);
 expect(build).toHaveBeenCalledTimes(1); expect(data).toEqual(before);
 expect(result.timing.stages?.map(stage => [stage.strategy, stage.status])).toEqual([['nearest', 'no-loop'], ['joint', 'success']]);
 expect(result.timing.stages![0].startNodeId).toBe(result.route.startNodeId); expect(result.timing.stages![1].startNodeId).toBe(result.route.startNodeId);
 expect(result.route.lengthM).toBeCloseTo(6500, 3); expect(result.route.repeated).toBe(0); expect(result.route.searchStrategy).toBe('joint');
 expect(createHash('sha256').update(toGpx(result.route)).digest('hex')).toBe('675c0459848133214cc7d429a29305940fab0c6f95b68919a9cdda68d4baa130');
 expect(progress).toContain('Trying a more flexible loop on the same roads…'); expect(result.timing.pathExpansions).toBe(result.timing.stages!.reduce((sum, stage) => sum + stage.pathExpansions, 0)); expect(result.timing.pathExpansions).toBeLessThanOrEqual(1800000);
});
it('returns a clean failure after both stages cannot legally close a directed restricted ring', () => {
 const { data, settings } = circleFixture();
 const restricted: OsmData = { elements: [...data.elements.map(element => element.type === 'way' ? { ...element, tags: { ...element.tags, oneway: 'yes' } } : element), { type: 'relation', id: 9000, tags: { type: 'restriction', 'restriction:bicycle': 'no_straight_on' }, members: [{ type: 'way', role: 'from', ref: 1000 }, { type: 'node', role: 'via', ref: 1 }, { type: 'way', role: 'to', ref: 1000 }] }] };
 const engine = new RoutingEngine(); engine.setData(restricted); const error = caught(() => engine.solve(settings));
 expect(error.message).toContain('No sufficiently circular'); expect(error.timing!.stages?.map(stage => stage.status)).toEqual(['no-loop', 'no-loop']);
});
it('shares one strict expansion ceiling and cannot reset it for flexible search', () => {
 const settings = gridSettings(), engine = new RoutingEngine(); engine.setData(denseGrid());
 const error = caught(() => engine.solve(settings, () => {}, undefined, { limits: { expansions: 100, timeMs: 14000 } }));
 expect(error.message).toContain('shared work/time limit'); expect(error.timing!.pathExpansions).toBe(100); expect(error.timing!.stages?.map(stage => stage.strategy)).toEqual(['nearest']); expect(error.timing!.searchBudget!.remainingExpansions).toBe(0);
 const fallbackLimit = caught(() => engine.solve(settings, () => {}, undefined, { limits: { expansions: 3000, timeMs: 14000 } }));
 expect(fallbackLimit.timing!.pathExpansions).toBe(3000); expect(fallbackLimit.timing!.stages?.map(stage => [stage.strategy, stage.status])).toEqual([['nearest', 'no-loop'], ['joint', 'limit']]); expect(fallbackLimit.timing!.stages![1].pathExpansions).toBeGreaterThan(0);
 const { data, settings: ring } = circleFixture(); engine.setData(data); const result = engine.solve(ring, () => {}, undefined, { limits: { expansions: 1e9, timeMs: 1e9 } }); expect(result.timing.searchBudget!.expansionLimit).toBe(MAX_SEARCH_LIMITS.expansions); expect(result.timing.searchBudget!.timeLimitMs).toBe(MAX_SEARCH_LIMITS.timeMs);
});
it('includes graph preparation in the shared monotonic deadline before any fallback', () => {
 let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
 const { data, settings } = circleFixture(), engine = new RoutingEngine(); engine.setData(data);
 const error = caught(() => engine.solve(settings, () => { now = 20; }, undefined, { limits: { expansions: 1800000, timeMs: 10 } }));
 expect(error.message).toContain('shared work/time limit'); expect(error.timing!.stages).toEqual([]); expect(error.timing!.searchBudget!.remainingTimeMs).toBe(0);
});
function mockedPlan() {
 const { data, settings } = circleFixture(), selected = changeCircle(settings, { radiusM: 1000, bearing: 90 }), calls: NetworkResult[] = [];
 const load: typeof loadNetwork = async (_settings, signal, _client, options = {}) => { signal.throwIfAborted(); const coverage = options.coverage!; const bytes = Buffer.byteLength(JSON.stringify(data)); options.budget!.remainingRequests--; options.budget!.remainingBytes -= bytes; options.budget!.remainingElements -= data.elements.length; const network: NetworkResult = { data, coverage, sourceCoverage: coverage, datasetId: String(calls.length), cached: false, timing: { fetchMs: 0, parseMs: 0, bytes, cacheHit: false, elements: data.elements.length, queryAreaM2: 0, queryVertices: 0 } }; calls.push(network); return network; };
 const engine = new RoutingEngine(); engine.setData(data); return { selected, calls, load, route: engine.solve(settings).route };
}
it('carries remaining work/time and pinned Start across the separately counted single expansion', async () => {
 const fixture = mockedPlan(), received: unknown[] = []; let searches = 0;
 const result = await planRoute(fixture.selected, new AbortController().signal, () => {}, async (_network, _settings, _signal, _progress, options) => {
  received.push(options); if (++searches === 1) throw new CoverageGapError('gap', [fixture.selected.start], 1, blankTiming(600, 20, 30));
  return { route: fixture.route, timing: blankTiming(350, 5, 10), transferMs: 0 };
 }, { load: fixture.load, searchLimits: { expansions: 1000, timeMs: 100 } });
 expect(received).toEqual([{ strategy: undefined, pinnedStartId: undefined, limits: { expansions: 1000, timeMs: 100 } }, { strategy: undefined, pinnedStartId: 1, limits: { expansions: 400, timeMs: 70 } }]);
 expect(fixture.calls).toHaveLength(2); expect(result.metrics.requests).toBe(2); expect(result.metrics.searchWork).toEqual({ expansions: 950, localElapsedMs: 40, expansionLimit: 1000, timeLimitMs: 100 });
});
it('does not download an expansion after work exhaustion or an unresponsive-worker deadline', async () => {
 for (const timedOut of [false, true]) {
  const fixture = mockedPlan(); let failure: unknown;
  try { await planRoute(fixture.selected, new AbortController().signal, () => {}, async () => { if (timedOut) throw new SearchFailure('deadline', undefined, true); throw new CoverageGapError('gap', [fixture.selected.start], 1, blankTiming(1000, 1)); }, { load: fixture.load, searchLimits: { expansions: 1000, timeMs: 100 } }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(PlanningFailure); expect((failure as Error).message).toContain('shared work/time limit'); expect(fixture.calls).toHaveLength(1); expect((failure as PlanningFailure).phase).toBe('budget'); expect((failure as PlanningFailure).metrics.searchTimedOut).toBe(timedOut);
 }
});
it('replays the saved default with baseline expansion footprints, explicit counts and one aggregate search budget', async () => {
 const selected = exampleSettings(), engine = new RoutingEngine(), snapshots = ['initial', 'expanded'].map(phase => JSON.parse(gunzipSync(readFileSync(new URL(`./data/vancouver-corridor-${phase}-2026-10-28.osm.json.gz`, import.meta.url))).toString()) as OsmData); let count = 0;
 const load: typeof loadNetwork = async (_settings, _signal, _client, options = {}) => {
  const coverage = options.coverage!, data = snapshots[count++]; expect(count).toBeLessThanOrEqual(2);
  if (coverage.kind === 'corridor' && count === 2) expect(coverage.patches.map(patch => patch.center)).toEqual([{ lat: 49.289824, lon: -123.126263 }, { lat: 49.288765, lon: -123.117445 }]);
  const bytes = Buffer.byteLength(JSON.stringify(data)); options.budget!.remainingRequests--; options.budget!.remainingBytes -= bytes; options.budget!.remainingElements -= data.elements.length;
  return { data, coverage, sourceCoverage: coverage, datasetId: String(count), cached: false, timing: { fetchMs: 0, parseMs: 0, bytes, cacheHit: false, elements: data.elements.length, queryAreaM2: 0, queryVertices: 0 } };
 };
 const result = await planRoute(selected, new AbortController().signal, () => {}, async (network, settings, signal, progress, options) => { signal.throwIfAborted(); engine.setData(network.data, network.sourceCoverage); return { ...engine.solve(settings, progress, network.coverage, options), transferMs: 0 }; }, { load });
 expect(count).toBe(2); expect(result.metrics.requests).toBe(2); expect(result.metrics.searchAttempts.flatMap(attempt => attempt.stages!.map(stage => stage.strategy))).toEqual(['nearest', 'joint', 'nearest']);
 expect(result.metrics.searchWork.expansions).toBeLessThanOrEqual(1800000); expect(result.metrics.searchWork.localElapsedMs).toBeLessThan(14000); expect(createHash('sha256').update(toGpx(result.route)).digest('hex')).toBe('c694ec13f8376818a767951b35abb426968c48ee66ad30f51290bf4c76444cae');
});
