import { distance, roundness, trackLength, xy } from '../routing/geo';
import { radialDeviation } from '../routing/solve';
import type { Point, Settings } from '../routing/types';
import type { ShapeScore } from './types';
// Compare overlapping collinear geometry, including different segmentation and
// opposite travel directions. No OSM edge identity is claimed for hosted data.
export function retracedFraction(points: Point[], signal: AbortSignal): number {
  type Segment = { a: [number, number]; b: [number, number]; length: number };
  const segments: Segment[] = [], buckets = new Map<string, Set<number>>(); let total = 0, repeated = 0, work = 0;
  for (let i = 1; i < points.length; i++) {
    signal.throwIfAborted(); const a = xy(points[i - 1], points[0]), b = xy(points[i], points[0]), length = Math.hypot(b[0] - a[0], b[1] - a[1]), count = Math.max(1, Math.ceil(length / 25));
    for (let j = 0; j < count; j++) {
      const from: [number, number] = [a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count], to: [number, number] = [a[0] + (b[0] - a[0]) * (j + 1) / count, a[1] + (b[1] - a[1]) * (j + 1) / count], len = length / count;
      if (len < .01) continue; if (segments.length >= 30000) throw new Error('Route geometry exceeds the scoring budget.');
      const keys: string[] = []; for (let x = Math.floor((Math.min(from[0], to[0]) - 1) / 50); x <= Math.floor((Math.max(from[0], to[0]) + 1) / 50); x++) for (let y = Math.floor((Math.min(from[1], to[1]) - 1) / 50); y <= Math.floor((Math.max(from[1], to[1]) + 1) / 50); y++) keys.push(`${x}/${y}`);
      const candidates = new Set(keys.flatMap(key => [...(buckets.get(key) ?? [])])), intervals: [number, number][] = [], ux = (to[0] - from[0]) / len, uy = (to[1] - from[1]) / len;
      for (const id of candidates) {
        if (++work > 2000000) throw new Error('Route geometry exceeds the scoring budget.'); const prior = segments[id], px = (prior.b[0] - prior.a[0]) / prior.length, py = (prior.b[1] - prior.a[1]) / prior.length;
        if (Math.abs(ux * px + uy * py) < .999 || Math.abs((prior.a[0] - from[0]) * uy - (prior.a[1] - from[1]) * ux) > 1 || Math.abs((prior.b[0] - from[0]) * uy - (prior.b[1] - from[1]) * ux) > 1) continue;
        const ta = (prior.a[0] - from[0]) * ux + (prior.a[1] - from[1]) * uy, tb = (prior.b[0] - from[0]) * ux + (prior.b[1] - from[1]) * uy, lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(len, Math.max(ta, tb)); if (hi > lo + .1) intervals.push([lo, hi]);
      }
      let last = 0; for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0])) { repeated += Math.max(0, hi - Math.max(last, lo)); last = Math.max(last, hi); }
      const id = segments.length; segments.push({ a: from, b: to, length: len }); for (const key of keys) { if (!buckets.has(key)) buckets.set(key, new Set()); buckets.get(key)!.add(id); } total += len;
    }
  }
  return total ? Math.min(1, repeated / total) : 0;
}
export function scoreGeometry(points: Point[], settings: Settings, signal: AbortSignal): ShapeScore {
  if (points.length < 4 || points.length > 20000 || points.some(point => !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180)) throw new Error('Routing service returned invalid or over-budget geometry.');
  if (distance(points[0], points.at(-1)!) > .1) throw new Error('Returned route does not close at the same snapped Start.');
  const radius = settings.circleRadiusM!, lengthM = trackLength(points), bins = new Set<number>(); let winding = 0, samples = 0;
  for (let i = 1; i < points.length; i++) {
    signal.throwIfAborted(); const a = xy(points[i - 1], settings.center), b = xy(points[i], settings.center), aa = Math.atan2(a[1], a[0]), ba = Math.atan2(b[1], b[0]); winding += Math.atan2(Math.sin(ba - aa), Math.cos(ba - aa));
    const count = Math.max(1, Math.ceil(distance(points[i - 1], points[i]) / 25)); if ((samples += count + 1) > 30000) throw new Error('Route geometry exceeds the scoring budget.');
    for (let j = 0; j <= count; j++) { const angle = Math.atan2(a[1] + (b[1] - a[1]) * j / count, a[0] + (b[0] - a[0]) * j / count); bins.add(Math.floor(((angle + Math.PI) / (2 * Math.PI) * 32) % 32)); }
  }
  return { lengthM, distanceError: Math.abs(lengthM - settings.targetKm * 1000) / (settings.targetKm * 1000), roundness: roundness(points), radialError: radialDeviation(points, settings.center, radius).meanAbsoluteM / radius, angularCoverage: bins.size / 32, winding: winding / (2 * Math.PI), retraced: retracedFraction(points, signal), snapM: distance(points[0], settings.start) };
}
