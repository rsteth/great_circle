import { describe, expect, it } from 'vitest';
import { angleKey, bearingTo, changeCircle, circleRadius, normalizeBearing, pointOnCircle, radiusKey, safeSizeBearing } from '../src/circle';
import { distance } from '../src/routing/geo';
import { solve, validateSettings } from '../src/routing/solve';
import { circleFixture } from './fixtures';

describe('circle size and clock hand', () => {
  it('puts north/east/south/west starts on the geographic circumference', () => {
    const { settings } = circleFixture();
    for (const bearing of [0, 90, 180, 270, 359.9, -90, 720]) {
      const point = pointOnCircle(settings.center, 1234, bearing);
      expect(distance(settings.center, point)).toBeCloseTo(1234, 5);
      expect(bearingTo(settings.center, point)).toBeCloseTo(normalizeBearing(bearing), 5);
    }
  });
  it('keeps radius, center and target stable when rotating through north repeatedly', () => {
    let { settings } = circleFixture();
    settings = changeCircle(settings, { radiusM: 1000, bearing: 359 });
    const original = settings;
    for (const bearing of [359, 0, 1, 180, 270, 359, 0, 360, -1]) {
      settings = changeCircle(settings, { bearing });
      expect(settings.center).toEqual(original.center);
      expect(settings.circleRadiusM).toBe(original.circleRadiusM);
      expect(settings.radiusM).toBe(original.radiusM);
      expect(settings.targetKm).toBe(original.targetKm);
      expect(distance(settings.center, settings.start)).toBeCloseTo(1000, 5);
    }
  });
  it('preserves angle when resizing or moving center, with padded search limits', () => {
    let { settings } = circleFixture();
    settings = changeCircle(settings, { radiusM: 1000, bearing: 37 });
    for (const radiusM of [500, 1500, 4500, 10000, 10000, 10001, 1]) {
      settings = changeCircle(settings, { radiusM });
      expect(bearingTo(settings.center, settings.start)).toBeCloseTo(37, 5);
      expect(settings.targetKm).toBeCloseTo(circleRadius(settings) * 2 * Math.PI / 1000, 8);
      expect(settings.radiusM).toBeGreaterThan(circleRadius(settings));
      expect(settings.radiusM).toBeLessThanOrEqual(13500);
      validateSettings(settings);
    }
    settings = changeCircle(settings, { center: { lat: 50, lon: -124 } });
    expect(bearingTo(settings.center, settings.start)).toBeCloseTo(37, 5);
    expect(distance(settings.center, settings.start)).toBeCloseTo(circleRadius(settings), 5);
  });
  it('supports wraparound keyboard controls without coupling size and angle', () => {
    expect(angleKey('ArrowRight', 359, false)).toBe(0);
    expect(angleKey('ArrowLeft', 0, false)).toBe(359);
    expect(angleKey('PageUp', 355, false)).toBe(10);
    expect(angleKey('Home', 180, false)).toBe(0);
    expect(angleKey('End', 180, false)).toBe(359);
    expect(radiusKey('Home', 1000, false)).toBe(500);
    expect(radiusKey('End', 1000, false)).toBe(10000);
    expect(radiusKey('ArrowUp', 1000, true)).toBe(1250);
    expect(angleKey('Tab', 40, false)).toBeUndefined();
  });
  it('routes the hand position on the selected circle and retains its center', () => {
    const { data, settings } = circleFixture();
    const selected = changeCircle(settings, { radiusM: 1000, bearing: 90 });
    const route = solve(data, selected);
    expect(route.circleCenter).toEqual(selected.center);
    expect(route.points[0]).toEqual(route.points.at(-1));
    expect(distance(route.points[0], selected.start)).toBeLessThan(1);
    expect(route.snapM).toBeLessThan(1);
    expect(route.points).toHaveLength(65);
    const opposite = solve(data, changeCircle(selected, { bearing: 270 }));
    expect(distance(route.points[0], opposite.points[0])).toBeGreaterThan(1900);
    expect(opposite.circleCenter).toEqual(selected.center);
  });
  it('rejects mismatched explicit circle/start semantics', () => {
    const { settings } = circleFixture();
    const selected = changeCircle(settings, { radiusM: 1000, bearing: 0 });
    expect(() => validateSettings({ ...selected, start: selected.center })).toThrow('start on its edge');
    expect(() => validateSettings({ ...selected, targetKm: 20 })).toThrow('valid circle size');
  });
});

describe('10 km circle planning and safe perimeter angle', () => {
  it('uses 10 km radius, not diameter; rejects invalid configured circles', () => {
    const { settings } = circleFixture();
    const large = changeCircle(settings, { radiusM: 10000, bearing: 135 });
    expect(large.circleRadiusM).toBe(10000); expect(distance(large.center, large.start)).toBeCloseTo(10000, 5);
    expect(large.targetKm).toBeCloseTo(62.83185307, 6); expect(large.radiusM).toBe(13500); validateSettings(large);
    expect(changeCircle(large, { radiusM: 10001 }).circleRadiusM).toBe(10000);
    expect(() => validateSettings({ ...large, circleRadiusM: 10001 })).toThrow();
    expect(() => validateSettings({ ...large, circleRadiusM: NaN })).toThrow();
    expect(radiusKey('ArrowUp', 10000, false)).toBe(10000);
  });
  it('tracks the nearest safe perimeter angle with stable handoff in both directions', () => {
    for (const angles of [[330,350,359,0,1,10,30,60], [60,30,10,1,0,359,350,330]]) {
      let previous = angles[0];
      for (const desired of angles) {
        const actual = safeSizeBearing(desired, 0, 100, previous);
        expect(Math.hypot(Math.sin(actual * Math.PI / 180) * 100, (Math.cos(actual * Math.PI / 180) - 1) * 100)).toBeGreaterThanOrEqual(63.99);
        if (desired === 60) expect(actual).toBe(desired);
        previous = actual;
      }
    }
  });
});
