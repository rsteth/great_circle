// Single offline correctness/telemetry diagnostic. Not an isolated benchmark.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { changeCircle } from '../src/circle';
import { exampleSettings } from '../src/selection';
import { covers, initialCoverage, type Coverage } from '../src/routing/coverage';
import { RoutingEngine } from '../src/routing/engine';
import { toGpx } from '../src/routing/gpx';
import { planRoute, PlanningFailure } from '../src/routing/plan';
import type { loadNetwork } from '../src/routing/overpass';
import type { OsmData, Settings } from '../src/routing/types';
import { circleFixture } from '../tests/fixtures';
import { denseGrid, selectCompleteWays } from '../tests/corridor-fixtures';
const ring = circleFixture(), selected = changeCircle(ring.settings, { radiusM: 1000, bearing: 90 });
const restricted: OsmData = { elements: [...ring.data.elements.map(element => element.type === 'way' ? { ...element, tags: { ...element.tags, oneway: 'yes' } } : element), { type: 'relation', id: 9000, tags: { type: 'restriction', 'restriction:bicycle': 'no_straight_on' }, members: [{ type: 'way', role: 'from', ref: 1000 }, { type: 'node', role: 'via', ref: 1 }, { type: 'way', role: 'to', ref: 1000 }] }] };
const recorded = JSON.parse(readFileSync(new URL('../docs/corridor-offline-diagnosis.json', import.meta.url), 'utf8'));
const snapshots = ['initial', 'expanded'].map(phase => JSON.parse(gunzipSync(readFileSync(new URL(`../tests/data/vancouver-corridor-${phase}-2026-10-28.osm.json.gz`, import.meta.url))).toString()) as OsmData);
const cases: { name: string; settings: Settings; source: (coverage: Coverage, index: number) => { data: OsmData; sourceCoverage: Coverage } }[] = [
 { name: 'fast-ring', settings: selected, source: coverage => ({ data: selectCompleteWays(ring.data, coverage), sourceCoverage: coverage }) },
 { name: 'fallback-grid', settings: selected, source: coverage => ({ data: selectCompleteWays(denseGrid(), coverage), sourceCoverage: coverage }) },
 { name: 'clean-restricted-failure', settings: selected, source: coverage => ({ data: selectCompleteWays(restricted, coverage), sourceCoverage: coverage }) },
 { name: 'saved-default-with-one-expansion', settings: exampleSettings(), source: (_coverage, index) => ({ data: snapshots[index], sourceCoverage: index ? recorded.expandedCoverage : recorded.initialCoverage }) },
];
let unexpectedFetch = 0;
globalThis.fetch = async () => { unexpectedFetch++; throw new Error('Provider requests disabled in offline diagnostic.'); };
const results = [];
for (const fixture of cases) {
 const engine = new RoutingEngine(), downloads: unknown[] = [], cpu: { userMs: number; systemMs: number }[] = [], progress: string[] = [];
 const load: typeof loadNetwork = async (_settings, signal, _client, options = {}) => {
  signal.throwIfAborted(); const coverage = options.coverage ?? initialCoverage(fixture.settings), source = fixture.source(coverage, downloads.length);
  if (!source.data || !covers(source.sourceCoverage, coverage)) throw new Error('Saved response does not cover requested footprint.');
  const bytes = Buffer.byteLength(JSON.stringify(source.data)); options.budget!.remainingRequests--; options.budget!.remainingBytes -= bytes; options.budget!.remainingElements -= source.data.elements.length;
  downloads.push({ kind: coverage.kind, patches: coverage.kind === 'corridor' ? coverage.patches : undefined, elements: source.data.elements.length, normalizedBytes: bytes });
  return { ...source, coverage, cached: false, datasetId: `${fixture.name}/${downloads.length}`, timing: { fetchMs: 0, parseMs: 0, bytes, cacheHit: false, elements: source.data.elements.length, queryAreaM2: 0, queryVertices: 0 } };
 };
 const started = performance.now();
 try {
  const result = await planRoute(fixture.settings, new AbortController().signal, message => progress.push(message), async (network, settings, signal, progress, options) => {
   signal.throwIfAborted(); engine.setData(network.data, network.sourceCoverage); const before = process.threadCpuUsage();
   try { return { ...engine.solve(settings, progress, network.coverage, options), transferMs: 0 }; }
   finally { const usage = process.threadCpuUsage(before); cpu.push({ userMs: usage.user / 1000, systemMs: usage.system / 1000 }); }
  }, { load });
  results.push({ name: fixture.name, success: true, localTotalElapsedMs: performance.now() - started, cpu, downloads, metrics: result.metrics, progress, route: { lengthM: result.route.lengthM, error: result.route.error, roundness: result.route.roundness, repeated: result.route.repeated, startNodeId: result.route.startNodeId, points: result.route.points.length, gpxSha256: createHash('sha256').update(toGpx(result.route)).digest('hex') } });
 } catch (error) {
  if (!(error instanceof PlanningFailure)) throw error;
  results.push({ name: fixture.name, success: false, localTotalElapsedMs: performance.now() - started, cpu, downloads, metrics: error.metrics, progress, error: error.message });
 }
}
if (unexpectedFetch) throw new Error('Unexpected provider call attempted.');
const evidence = { protocol: 'One cold Node engine diagnostic per fixture; no isolated performance claim. CPU user/system brackets graph+solve on the caller thread; does not include loading/JSON/worker startup or other runtime threads. Local elapsed metrics and mock download counts are separate. Background VM22.4%, WebKitGPU5.5% at preflight; no substantial benchmark performed. Actual browser-worker behavior tested separately.', node: process.version, providerRequests: 0, fetchDisabled: true, results };
writeFileSync(new URL('../docs/hybrid-local-results.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(results.map(result => ({ name: result.name, success: result.success, mockRoadRequests: result.downloads.length, localCpuMs: result.cpu.reduce((sum, sample) => sum + sample.userMs + sample.systemMs, 0), stages: (result.metrics.searchAttempts as { stages: unknown[] }[]).flatMap(attempt => attempt.stages), work: result.metrics.searchWork })), null, 2));
