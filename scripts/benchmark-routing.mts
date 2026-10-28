// Explicit offline comparison; never run by install/build/default tests.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { RoutingEngine } from '../src/routing/engine';
import { toGpx } from '../src/routing/gpx';
import { circleFixture } from '../tests/fixtures';
import type { Route, Settings, SolveTiming } from '../src/routing/types';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--baseline') throw new Error('Usage: tsx scripts/benchmark-routing.mts --baseline /absolute/path/to/frozen-cfb2be0-source');
const baselineRoot = resolve(args[1]);
const baselineSource = await readFile(resolve(baselineRoot, 'src/routing/solve.ts'));
const sourceHash = createHash('sha256').update(baselineSource).digest('hex');
// Filled with the independently archived, published baseline source identity.
const EXPECTED_BASELINE_SOURCE_SHA = '47b53928be16f0816b863c012e8f2c8a8d9e8bf535f6268754261abb4fd24125';
if (sourceHash !== EXPECTED_BASELINE_SOURCE_SHA) throw new Error('The baseline solver is not the frozen published cfb2be0 source.');
const baseline = await import(pathToFileURL(resolve(baselineRoot, 'src/routing/solve.ts')).href) as { solve: (data: unknown, settings: Settings) => Route };
const raw = gunzipSync(await readFile(new URL('../tests/data/vancouver-west-end-2026-10-25.osm.json.gz', import.meta.url)));
const actualSha = createHash('sha256').update(raw).digest('hex');
if (actualSha !== 'ec1ddc51603b2b0f63c8ecf67970deab999ce9de200a638d127c9e59d6c28a16') throw new Error('Actual fixture changed.');
const ring = circleFixture(512, 1000); ring.settings.circleRadiusM = 1000;
const fixtures = [
  { name: 'ring-512-explicit-circle', data: ring.data, settings: ring.settings, gpxHash: 'b13fd849200ce89df575cd0346bb715e98aea5ae9920590f6c888a89153a9cfc' },
  { name: 'saved-vancouver-1km-legacy', data: JSON.parse(raw.toString()), settings: { center: { lat: 49.289, lon: -123.128 }, start: { lat: 49.289, lon: -123.128 }, radiusM: 1000, targetKm: 3, tolerance: 0.2, surface: 'mixed', style: 'quiet' } as Settings, gpxHash: '8b10c1811ceb29398dab233977af79b5203cbd3ee5d5983c2baae9c4b034dbec' },
];
const results = [];
for (const fixture of fixtures) {
  const warm = new RoutingEngine(); warm.setData(fixture.data); warm.solve(fixture.settings);
  const samples: { mode: string; elapsedMs: number; timing?: SolveTiming; points: number; lengthM: number; candidates: number }[] = [];
  for (let round = -1; round < 5; round++) {
    const modes = ['baseline', 'optimized-cold', 'optimized-warm'];
    const rotate = (round + 1) % 3; const order = [...modes.slice(rotate), ...modes.slice(0, rotate)];
    for (const mode of order) {
      let route: Route, timing: SolveTiming | undefined;
      const started = performance.now();
      if (mode === 'baseline') route = baseline.solve(fixture.data, fixture.settings);
      else {
        const engine = mode === 'optimized-warm' ? warm : new RoutingEngine();
        if (mode === 'optimized-cold') engine.setData(fixture.data);
        ({ route, timing } = engine.solve(fixture.settings));
      }
      const elapsedMs = performance.now() - started;
      if (createHash('sha256').update(toGpx(route)).digest('hex') !== fixture.gpxHash) throw new Error(`GPX parity failed: ${fixture.name}/${mode}`);
      if (round >= 0) samples.push({ mode, elapsedMs, timing, points: route.points.length, lengthM: route.lengthM, candidates: route.candidates });
    }
  }
  const summary = ['baseline', 'optimized-cold', 'optimized-warm'].map(mode => {
    const values = samples.filter(sample => sample.mode === mode).map(sample => sample.elapsedMs).sort((a, b) => a - b);
    return { mode, medianMs: values[2], minMs: values[0], maxMs: values.at(-1), samples: values.length };
  });
  results.push({ fixture: fixture.name, gpxHash: fixture.gpxHash, summary, samples });
}
const evidence = { baselineCommit: 'cfb2be02bba544e1c7b1192915fcd9ec4985dd91', baselineSourceSha: sourceHash, optimizedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.version, protocol: 'Offline, 1 excluded warmup per mode; 5 interleaved samples per mode, rotating order. Cold graph rebuilt each call; warm graph/dataset retained. Solve timings exclude JSON parsing, worker transfer/startup, export hashing and all network latency. Small local fixtures; not a universal speedup or statistical benchmark.', actualFixtureSha: actualSha, results };
await writeFile('/tmp/great-circle-routing-comparison.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ ...evidence, results: results.map(({ samples, ...rest }) => rest) }, null, 2));
