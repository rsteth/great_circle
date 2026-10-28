// Offline diagnostic, not an isolated performance benchmark. No fetch/imported
// engine transport is used. Synthetic mock selection is not Overpass server cost.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { changeCircle } from '../src/circle';
import { exampleSettings } from '../src/selection';
import { CoverageGapError, covers, coverageCost, expandCoverage, initialCoverage } from '../src/routing/coverage';
import type { Coverage } from '../src/routing/coverage';
import { buildGraph } from '../src/routing/graph';
import { offset, xy } from '../src/routing/geo';
import { toGpx } from '../src/routing/gpx';
import { loopCore, solve } from '../src/routing/solve';
import type { CoverageStrategy, SearchStrategy } from '../src/routing/strategies';
import type { OsmData, Settings, SolveTiming } from '../src/routing/types';
import { circleFixture, center } from '../tests/fixtures';
import { denseGrid, ringRoads, ruralTree, selectCompleteWays } from '../tests/corridor-fixtures';
const read = (name: string): OsmData => JSON.parse(gunzipSync(readFileSync(new URL(`../tests/data/${name}`, import.meta.url))).toString());
const scaledBridge: OsmData = { elements: ringRoads(true).elements.map(element => {
  if (element.type !== 'node') return element;
  const [x, y] = xy(element, center); return { ...element, ...offset(center, x / 2, y / 2) };
}) };
const directed = circleFixture(64, 1000).data;
directed.elements = directed.elements.map(element => element.type === 'way' ? { ...element, tags: { ...element.tags, oneway: 'yes' } } : element);
function compare(name: string, settings: Settings, coverageStrategy: CoverageStrategy, strategy: SearchStrategy, source: (coverage: Coverage, stage: number) => OsmData, initial = initialCoverage(settings, coverageStrategy), knownSources?: Coverage[]) {
  let coverage = initial, pinnedStartId: number | undefined;
  const stages: Record<string, unknown>[] = [], started = performance.now();
  for (let stage = 0; stage < 2; stage++) {
    if (knownSources && !covers(knownSources[stage], coverage)) return { name, coverageStrategy, strategy, success: false, mockRequests: stages.length, localDiagnosticMs: performance.now() - started, stages, error: 'UNMEASURED: proposed expansion is not covered by the saved response. No request was made and no complete/no-loop conclusion is available.' };
    const data = source(coverage, stage);
    const timing: SolveTiming = { graphMs: 0, graphCached: false, snapComponentMs: 0, searchMs: 0, totalMs: 0, anchorNodeProjections: 0, pathExpansions: 0 };
    const record: Record<string, unknown> = { coverage: coverage.kind, patches: coverage.kind === 'corridor' ? coverage.patches.length : 0, normalizedJsonBytes: Buffer.byteLength(JSON.stringify(data)), elements: data.elements.length, queryCostProxy: coverageCost(coverage), timing };
    stages.push(record);
    try {
      const graphStarted = performance.now(), graph = loopCore(buildGraph(data, settings, coverage));
      timing.graphMs = performance.now() - graphStarted; record.preparedNodes = graph.nodes.size; record.preparedDirectedEdges = [...graph.edges.values()].reduce((n, edges) => n + edges.length, 0);
      const route = solve(data, settings, () => {}, { graph, strategy, pinnedStartId, timing });
      return { name, coverageStrategy, strategy, success: true, mockRequests: stages.length, localDiagnosticMs: performance.now() - started, stages, route: { lengthM: route.lengthM, error: route.error, roundness: route.roundness, repeated: route.repeated, snapM: route.snapM, startNodeId: route.startNodeId, radialDeviation: route.radialDeviation, points: route.points.length, closed: JSON.stringify(route.points[0]) === JSON.stringify(route.points.at(-1)), gpxSha256: createHash('sha256').update(toGpx(route)).digest('hex') } };
    } catch (error) {
      record.error = String(error);
      if (error instanceof CoverageGapError && coverage.kind === 'corridor' && stage === 0) {
        const expanded = expandCoverage(coverage, error.gaps); pinnedStartId = error.startNodeId ?? pinnedStartId;
        if (expanded) { coverage = expanded; continue; }
      }
      return { name, coverageStrategy, strategy, success: false, mockRequests: stages.length, localDiagnosticMs: performance.now() - started, stages, error: String(error) };
    }
  }
  throw new Error('Unexpected comparison state');
}
const settings = changeCircle(circleFixture().settings, { radiusM: 1000, bearing: 90 });
const results: ReturnType<typeof compare>[] = [];
for (const [name, full] of [['dense-grid-1km', denseGrid()], ['river-bridge-1km', scaledBridge], ['peninsula-tree-1km', ruralTree()], ['disconnected-from-start-1km', circleFixture(64, 2000).data], ['directed-ring-1km', directed]] as const) {
  for (const coverageStrategy of ['corridor', 'hybrid-small'] as const) for (const strategy of ['nearest', 'joint'] as const) results.push(compare(name, settings, coverageStrategy, strategy, coverage => selectCompleteWays(full, coverage)));
}
const smallInitial = initialCoverage(exampleSettings());
if (smallInitial.kind !== 'corridor') throw new Error('fixture');
const smallExpanded = expandCoverage(smallInitial, [{ lat: 49.289824, lon: -123.126263 }, { lat: 49.288765, lon: -123.117445 }])!;
const old = changeCircle({ ...exampleSettings(), center: { lat: 49.299, lon: -123.133 }, tolerance: .2 }, { radiusM: 10000 / (2 * Math.PI), bearing: 180 });
const oldInitial = initialCoverage(old); if (oldInitial.kind !== 'corridor') throw new Error('fixture');
const oldExpanded = expandCoverage(oldInitial, [{ lat: 49.300546, lon: -123.150087 }, { lat: 49.295783, lon: -123.149447 }])!;
for (const strategy of ['nearest', 'joint'] as const) {
  results.push(compare('saved-Vancouver-2026-10-28-adaptive-replay', exampleSettings(), 'corridor', strategy, (_coverage, stage) => read(`vancouver-corridor-${stage ? 'expanded' : 'initial'}-2026-10-28.osm.json.gz`), smallInitial, [smallInitial, smallExpanded]));
  results.push(compare('saved-Vancouver-FIXED-known-expanded-graph-NOT-query-count-comparison', exampleSettings(), 'corridor', strategy, () => read('vancouver-corridor-expanded-2026-10-28.osm.json.gz'), smallExpanded, [smallExpanded]));
  results.push(compare('historical-Vancouver-2026-10-25-disk-NOT-same-snapshot', exampleSettings(), 'hybrid-small', strategy, () => read('vancouver-west-end-2026-10-25.osm.json.gz')));
  results.push(compare('saved-old-default-2026-10-28-corridor', old, 'corridor', strategy, (_coverage, stage) => read(`vancouver-default-${stage ? 'expanded' : 'corridor'}-2026-10-28.osm.json.gz`), oldInitial, [oldInitial, oldExpanded]));
}

const evidence = { protocol: 'One cold offline diagnostic per arm; 25m corridor margin unchanged. No provider requests, server latency, warmed graph, isolated timing or statistical speedup claim. Local timings can overlap unrelated machine work. Query counts/normalized JSON bytes are mock data-volume measures; real query/index work and response formatting differ. Historical disk is a different date and footprint: not a paired network comparison.', realOrderedEngine: 'unmeasured; mock contract tests only', realRoundTripEngine: 'unmeasured; mock contract tests only', results };
writeFileSync(new URL('../docs/local-strategy-comparison.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(results.map(row => ({ name: row.name, coverage: row.coverageStrategy, search: row.strategy, ok: row.success, requests: row.mockRequests, lengthM: row.route?.lengthM, error: row.route?.error, expansions: row.stages.reduce((sum, stage) => sum + (stage.timing as SolveTiming).pathExpansions, 0) })), null, 2));
