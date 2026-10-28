import { distance, xy } from './geo';
import { pointOnCircle } from '../circle';
import type { Point, Settings } from './types';
export type Disk = { kind: 'disk'; center: Point; radiusM: number };
export type Corridor = { kind: 'corridor'; center: Point; line: Point[]; halfWidthM: number; clipMarginM: number; patches: Disk[] };
export type Coverage = Disk | Corridor;
export const MAX_CORRIDOR_AREA_M2 = 110000000;
export const MAX_CORRIDOR_VERTICES = 128;
export const MAX_PATCHES = 2;
const roundPoint = (point: Point): Point => ({ lat: Number(point.lat.toFixed(6)), lon: Number(point.lon.toFixed(6)) });
export class CoverageGapError extends Error {
  constructor(message: string, readonly gaps: Point[]) { super(message); this.name = 'CoverageGapError'; }
}
export const coverageKey = (coverage: Coverage | undefined) => coverage ? JSON.stringify(coverage) : 'legacy-disk';
export function initialCoverage(settings: Settings): Coverage {
  if (settings.circleRadiusM === undefined) return { kind: 'disk', center: roundPoint(settings.center), radiusM: settings.radiusM + 50 };
  const radius = settings.circleRadiusM;
  const line = Array.from({ length: 96 }, (_, index) => roundPoint(pointOnCircle(settings.center, radius, index * 360 / 96)));
  line.push({ ...line[0] });
  const halfWidthM = Math.ceil(Math.max(350, radius * 0.06 + 150)) + 25;
  return { kind: 'corridor', center: roundPoint(settings.center), line, halfWidthM, clipMarginM: 25, patches: [] };
}
export function coverageCost(coverage: Coverage) {
  if (coverage.kind === 'disk') return { vertices: 1, areaM2: Math.PI * coverage.radiusM ** 2 };
  let length = 0;
  for (let i = 1; i < coverage.line.length; i++) length += distance(coverage.line[i - 1], coverage.line[i]);
  return { vertices: coverage.line.length + coverage.patches.length, areaM2: 2 * coverage.halfWidthM * length + Math.PI * coverage.halfWidthM ** 2 + coverage.patches.reduce((sum, patch) => sum + Math.PI * patch.radiusM ** 2, 0) };
}
export function validateCoverage(coverage: Coverage) {
  const bufferFits = (point: Point, radius: number) => Math.abs(point.lon) + radius / (111000 * Math.cos(point.lat * Math.PI / 180)) < 180;
  const validPoint = (point: Point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 76 && Math.abs(point.lon) <= 180;
  if (!validPoint(coverage.center)) throw new Error('Invalid download coverage.');
  if (coverage.kind === 'disk') {
    if (!Number.isFinite(coverage.radiusM) || coverage.radiusM <= 0 || coverage.radiusM > 6050 || !bufferFits(coverage.center, coverage.radiusM)) throw new Error('Disk map downloads remain limited to a 6 km search radius.');
    return;
  }
  const cost = coverageCost(coverage);
  if (coverage.line.length < 4 || coverage.line.length > MAX_CORRIDOR_VERTICES || !coverage.line.every((point, index) => validPoint(point) && bufferFits(point, coverage.halfWidthM) && distance(coverage.center, point) <= 10010 && (index === 0 || distance(coverage.line[index - 1], point) <= 1000)) || distance(coverage.line[0], coverage.line.at(-1)!) > 0.1 || coverage.halfWidthM < 100 || coverage.halfWidthM > 1000 || coverage.clipMarginM !== 25 || coverage.patches.length > MAX_PATCHES || coverage.patches.some(patch => !validPoint(patch.center) || !bufferFits(patch.center, patch.radiusM) || patch.radiusM <= 25 || patch.radiusM > 1025) || !Number.isFinite(cost.areaM2) || cost.areaM2 > MAX_CORRIDOR_AREA_M2 || cost.vertices > MAX_CORRIDOR_VERTICES) throw new Error('Corridor exceeds the bounded area, width or vertex budget. Try a smaller circle.');
}
export function covers(source: Coverage, requested: Coverage): boolean {
  if (coverageKey(source) === coverageKey(requested)) return true;
  if (source.kind === 'disk') {
    if (requested.kind === 'disk') return distance(source.center, requested.center) + requested.radiusM + 1 <= source.radiusM;
    return requested.line.every(point => distance(source.center, point) + requested.halfWidthM + 1 <= source.radiusM) && requested.patches.every(patch => distance(source.center, patch.center) + patch.radiusM + 1 <= source.radiusM);
  }
  if (requested.kind === 'disk' || source.halfWidthM < requested.halfWidthM || JSON.stringify(source.line) !== JSON.stringify(requested.line) || source.clipMarginM !== requested.clipMarginM) return false;
  return requested.patches.every(patch => source.patches.some(known => coverageKey(known) === coverageKey(patch)));
}
export function expandCoverage(coverage: Corridor, gaps: Point[]): Corridor | undefined {
  const patches = [...coverage.patches];
  for (const point of gaps) {
    if (patches.length >= MAX_PATCHES) break;
    const center = roundPoint(point);
    if (patches.some(patch => distance(patch.center, center) < 500)) continue;
    if (distance(coverage.center, center) > 12000) continue;
    patches.push({ kind: 'disk', center, radiusM: 1025 });
  }
  if (patches.length === coverage.patches.length) return undefined;
  const expanded: Corridor = { ...coverage, patches };
  try { validateCoverage(expanded); return expanded; } catch { return undefined; }
}

type Vec = [number, number];
type Interval = [number, number];
type Primitive = { a: Vec; b: Vec; radius: number; minX: number; maxX: number; minY: number; maxY: number };
function diskInterval(a: Vec, b: Vec, center: Vec, radius: number): Interval | undefined {
  const dx = b[0] - a[0], dy = b[1] - a[1], x = a[0] - center[0], y = a[1] - center[1];
  const aa = dx * dx + dy * dy, bb = 2 * (x * dx + y * dy), cc = x * x + y * y - radius * radius;
  if (aa === 0) return cc <= 0 ? [0, 1] : undefined;
  const d = bb * bb - 4 * aa * cc;
  if (d < 0) return undefined;
  const lo = Math.max(0, (-bb - Math.sqrt(d)) / (2 * aa)), hi = Math.min(1, (-bb + Math.sqrt(d)) / (2 * aa));
  return lo <= hi ? [lo, hi] : undefined;
}
function rectangleInterval(a: Vec, b: Vec, from: Vec, to: Vec, width: number): Interval | undefined {
  const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
  if (!length) return undefined;
  const ux = dx / length, uy = dy / length;
  const x = (a[0] - from[0]) * ux + (a[1] - from[1]) * uy, y = -(a[0] - from[0]) * uy + (a[1] - from[1]) * ux;
  const vx = (b[0] - a[0]) * ux + (b[1] - a[1]) * uy, vy = -(b[0] - a[0]) * uy + (b[1] - a[1]) * ux;
  let lo = 0, hi = 1;
  for (const [origin, change, min, max] of [[x, vx, 0, length], [y, vy, -width, width]]) {
    if (Math.abs(change) < 1e-12) { if (origin < min || origin > max) return undefined; continue; }
    const first = (min - origin) / change, second = (max - origin) / change;
    lo = Math.max(lo, Math.min(first, second)); hi = Math.min(hi, Math.max(first, second));
    if (lo > hi) return undefined;
  }
  return [lo, hi];
}
export function compileCoverage(coverage: Coverage) {
  const primitives: Primitive[] = [];
  const add = (a: Vec, b: Vec, radius: number) => primitives.push({ a, b, radius, minX: Math.min(a[0], b[0]) - radius, maxX: Math.max(a[0], b[0]) + radius, minY: Math.min(a[1], b[1]) - radius, maxY: Math.max(a[1], b[1]) + radius });
  if (coverage.kind === 'disk') add([0, 0], [0, 0], coverage.radiusM - 25);
  else {
    const line = coverage.line.map(point => xy(point, coverage.center));
    for (let i = 1; i < line.length; i++) add(line[i - 1], line[i], coverage.halfWidthM - coverage.clipMarginM);
    for (const patch of coverage.patches) { const center = xy(patch.center, coverage.center); add(center, center, patch.radiusM - coverage.clipMarginM); }
  }
  function intervals(a: Vec, b: Vec): Interval[] {
    const result: Interval[] = [];
    for (const primitive of primitives) {
      if (Math.max(a[0], b[0]) < primitive.minX || Math.min(a[0], b[0]) > primitive.maxX || Math.max(a[1], b[1]) < primitive.minY || Math.min(a[1], b[1]) > primitive.maxY) continue;
      const first = diskInterval(a, b, primitive.a, primitive.radius), last = diskInterval(a, b, primitive.b, primitive.radius);
      if (first) result.push(first); if (last) result.push(last);
      const middle = rectangleInterval(a, b, primitive.a, primitive.b, primitive.radius); if (middle) result.push(middle);
    }
    return result;
  }
  const contains = (point: Point) => intervals(xy(point, coverage.center), xy(point, coverage.center)).length > 0;
  const segment = (from: Point, to: Point) => {
    const spans = intervals(xy(from, coverage.center), xy(to, coverage.center)).sort((a, b) => a[0] - b[0]);
    let until = 0;
    for (const [lo, hi] of spans) { if (lo > until + 1e-9) return false; until = Math.max(until, hi); if (until >= 1 - 1e-9) return true; }
    return false;
  };
  const intersects = (from: Point, to: Point) => intervals(xy(from, coverage.center), xy(to, coverage.center)).length > 0;
  return { contains, segment, intersects };
}
