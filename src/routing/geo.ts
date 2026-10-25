import type { Point } from './types';
const R = 6371008.8;
const radians = Math.PI / 180;
export function distance(a: Point, b: Point): number {
  const h = Math.sin((b.lat - a.lat) * radians / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin((b.lon - a.lon) * radians / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function xy(p: Point, origin: Point): [number, number] {
  return [(p.lon - origin.lon) * radians * R * Math.cos(origin.lat * radians), (p.lat - origin.lat) * radians * R];
}
export function offset(p: Point, x: number, y: number): Point {
  return { lat: p.lat + y / R / radians, lon: p.lon + x / (R * Math.cos(p.lat * radians)) / radians };
}
export function angleDelta(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}
export function trackLength(points: Point[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
}
export function roundness(points: Point[]): number {
  const local = points.map(p => xy(p, points[0]));
  let area = 0;
  for (let i = 1; i < local.length; i++) area += local[i - 1][0] * local[i][1] - local[i][0] * local[i - 1][1];
  const length = trackLength(points);
  return length ? Math.min(1, 4 * Math.PI * Math.abs(area / 2) / length ** 2) : 0;
}
