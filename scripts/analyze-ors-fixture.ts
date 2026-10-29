// Offline diagnostics only. No provider/key/HTTP imports or policy changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distance, xy } from '../src/routing/geo';
import { radialDeviation } from '../src/routing/solve';
import { scoreGeometry } from '../src/loop/score';
import type { Point, Settings } from '../src/routing/types';
export function diagnoseShape(points: Point[], settings: Settings) {
 const radius = settings.circleRadiusM!, score = scoreGeometry(points, settings, new AbortController().signal), radial = radialDeviation(points, settings.center, radius);
 const samples: { error: number; weight: number }[] = []; let forward = 0, reverse = 0, total = 0;
 for (let i = 1; i < points.length; i++) {
  const a = points[i - 1], b = points[i], length = distance(a, b), count = Math.max(1, Math.ceil(length / 5));
  if (samples.length + count > 30000) throw new Error('Offline sample budget exceeded.');
  const [ax, ay] = xy(a, settings.center), [bx, by] = xy(b, settings.center), delta = Math.atan2(Math.sin(Math.atan2(by, bx) - Math.atan2(ay, ax)), Math.cos(Math.atan2(by, bx) - Math.atan2(ay, ax)));
  forward += Math.max(0, delta); reverse += Math.max(0, -delta);
  for (let j = 0; j < count; j++) { const part = (j + .5) / count, p = { lat: a.lat + (b.lat - a.lat) * part, lon: a.lon + (b.lon - a.lon) * part }; samples.push({ error: Math.abs(distance(p, settings.center) - radius), weight: length / count }); }
  total += length;
 }
 samples.sort((a, b) => a.error - b.error);
 const percentile = (fraction: number) => { let weight = 0; for (const sample of samples) { weight += sample.weight; if (weight >= total * fraction) return sample.error; } return 0; };
 const fractionWithin = (fraction: number) => samples.reduce((sum, sample) => sum + (sample.error <= radius * fraction ? sample.weight : 0), 0) / total;
 return { points: points.length, score, radial, sampleIntervalMaxM: 5, p50AbsoluteDepartureM: percentile(.5), p90AbsoluteDepartureM: percentile(.9), p95AbsoluteDepartureM: percentile(.95), maxAbsoluteDepartureM: Math.max(radius - radial.minM, radial.maxM - radius), lengthWithin10PercentRadius: fractionWithin(.1), lengthWithin20PercentRadius: fractionWithin(.2), lengthWithin30PercentRadius: fractionWithin(.3), absoluteAngularTravelTurns: (forward + reverse) / (2 * Math.PI), oppositeAngularTravelTurns: Math.min(forward, reverse) / (2 * Math.PI), thresholds: { distanceErrorMax: settings.tolerance, meanRadialErrorMax: .2 + settings.tolerance * .5, angularCoverageMin: .875, maxRadialDepartureConstraint: false } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const fixture = JSON.parse(readFileSync(new URL('../tests/data/ors-la-intersection-2026-10-29.json', import.meta.url), 'utf8'));
 const report = { provenance: fixture.provenance, liveRuns: fixture.liveRuns, settings: fixture.settings, candidates: fixture.responses.map((response: { body: { features: { geometry: { coordinates: number[][] } }[] } }) => diagnoseShape(response.body.features[0].geometry.coordinates.map(([lon, lat]) => ({ lat, lon })), fixture.settings)), actualProviderCallsDuringAnalysis: 0 };
 const json = JSON.stringify(report, null, 2) + '\n';
 if (process.argv[2]) writeFileSync(process.argv[2], json); else console.log(json);
}
