import { distance } from './routing/geo';
import { MIN_CIRCLE_RADIUS_M, MAX_CIRCLE_RADIUS_M, MAX_SHARED_CIRCLE_RADIUS_M, MAX_SHARED_QUERY_RADIUS_M } from './routing/limits';
import type { Point, Settings } from './routing/types';
const R = 6371008.8;
const rad = Math.PI / 180;
export const MIN_CIRCLE_RADIUS = MIN_CIRCLE_RADIUS_M;
export const MAX_CIRCLE_RADIUS = MAX_CIRCLE_RADIUS_M;
export const normalizeBearing = (degrees: number) => ((degrees % 360) + 360) % 360;
export const circleRadius = (settings: Settings) => settings.circleRadiusM ?? settings.targetKm * 1000 / (2 * Math.PI);
export function pointOnCircle(center: Point, radiusM: number, bearing: number): Point {
  const a = radiusM / R, b = normalizeBearing(bearing) * rad, lat = center.lat * rad, lon = center.lon * rad;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(a) + Math.cos(lat) * Math.sin(a) * Math.cos(b));
  const nextLon = lon + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(lat), Math.cos(a) - Math.sin(lat) * Math.sin(nextLat));
  return { lat: nextLat / rad, lon: ((nextLon / rad + 540) % 360) - 180 };
}
export function bearingTo(center: Point, point: Point, fallback = 0): number {
  if (distance(center, point) < 1) return normalizeBearing(fallback);
  const lat1 = center.lat * rad, lat2 = point.lat * rad, dlon = (point.lon - center.lon) * rad;
  return normalizeBearing(Math.atan2(Math.sin(dlon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon)) / rad);
}
export function changeCircle(settings: Settings, change: { center?: Point; radiusM?: number; bearing?: number }): Settings {
  const center = change.center ?? settings.center;
  const radius = Math.max(MIN_CIRCLE_RADIUS, Math.min(MAX_CIRCLE_RADIUS, change.radiusM ?? circleRadius(settings)));
  const bearing = change.bearing ?? bearingTo(settings.center, settings.start, 180);
  return { ...settings, center, circleRadiusM: radius, radiusM: radius <= MAX_SHARED_CIRCLE_RADIUS_M ? Math.min(MAX_SHARED_QUERY_RADIUS_M, Math.max(1000, Math.ceil(radius * 1.35))) : Math.ceil(radius * 1.35), targetKm: radius * 2 * Math.PI / 1000, start: pointOnCircle(center, radius, bearing) };
}
export function angleKey(key: string, bearing: number, shift: boolean): number | undefined {
  if (key === 'Home') return 0;
  if (key === 'End') return 359;
  const step = shift || key.startsWith('Page') ? 15 : 1;
  if (['ArrowRight', 'ArrowUp', 'PageUp'].includes(key)) return normalizeBearing(bearing + step);
  if (['ArrowLeft', 'ArrowDown', 'PageDown'].includes(key)) return normalizeBearing(bearing - step);
}
export function radiusKey(key: string, radius: number, shift: boolean): number | undefined {
  if (key === 'Home') return MIN_CIRCLE_RADIUS;
  if (key === 'End') return MAX_CIRCLE_RADIUS;
  const step = key.startsWith('Page') ? 500 : shift ? 250 : 50;
  if (['ArrowRight', 'ArrowUp', 'PageUp'].includes(key)) return Math.min(MAX_CIRCLE_RADIUS, radius + step);
  if (['ArrowLeft', 'ArrowDown', 'PageDown'].includes(key)) return Math.max(MIN_CIRCLE_RADIUS, radius - step);
}

// Nearest perimeter position outside Start's screen-space hit zone. A small
// hysteresis at its midpoint avoids jitter when the pointer crosses Start.
export function safeSizeBearing(desired: number, start: number, radiusPx: number, previous: number): number {
  const delta = (angle: number) => ((normalizeBearing(angle - start) + 180) % 360) - 180;
  const separation = 2 * Math.asin(Math.min(1, 32 / Math.max(1, radiusPx))) / rad;
  const difference = delta(desired);
  if (Math.abs(difference) >= separation) return normalizeBearing(desired);
  const side = Math.abs(difference) > Math.min(3, separation / 4) ? Math.sign(difference) : Math.sign(delta(previous)) || 1;
  return normalizeBearing(start + side * separation);
}
