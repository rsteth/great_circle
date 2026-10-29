import { afterEach, expect, it, vi } from 'vitest';
import fixture from './data/ors-la-intersection-2026-10-29.json';
import { createLoopPlanner } from '../server/loop';
import { createOrsProvider } from '../server/ors';
import { diagnoseShape } from '../scripts/analyze-ors-fixture';
import { toGpx } from '../src/routing/gpx';
import type { Route, Settings } from '../src/routing/types';
const settings = fixture.settings as Settings;
afterEach(() => vi.useRealTimers());
it('keeps the historical rejection and now selects the best valid larger LA loop after both directions', async () => {
 vi.useFakeTimers(); const client = vi.fn(); for (const response of fixture.responses) client.mockResolvedValueOnce(Response.json(response.body, { status: response.httpStatus }));
 const pending = createLoopPlanner(createOrsProvider('fixture-only-not-a-real-key', client))({ requestId: 'la-replay', settings }, new AbortController().signal); await vi.advanceTimersByTimeAsync(1600); const result = await pending;
 expect(fixture.expectedResult.status).toBe('shape-tolerance'); expect(result.status).toBe('ok'); expect(result.requests).toBe(2); expect(result.providerRequests).toBe(2); expect(client).toHaveBeenCalledTimes(2); expect('route' in result).toBe(true);
 if (result.status !== 'ok') throw new Error('Expected larger-loop result'); expect(result.score.distanceError).toBeCloseTo(.4302067735, 8); expect(result.route.distanceNotice?.excessM).toBeCloseTo(4054.6033, 2); expect(result.route.points).toHaveLength(432); expect(result.route.points).toEqual(fixture.responses[0].body.features[0].geometry.coordinates.map(([lon, lat]) => ({ lat, lon })));
});
it('distinguishes average proximity from route-wide excursions on actual LA geometry', () => {
 for (const [i, response] of fixture.responses.entries()) {
  const points = response.body.features[0].geometry.coordinates.map(([lon, lat]) => ({ lat, lon })), report = diagnoseShape(points, settings), score = report.score;
  expect(score.distanceError).toBeGreaterThan(.3); expect(score.roundness).toBeGreaterThan(.3); expect(score.radialError).toBeLessThan(.35); expect(score.angularCoverage).toBe(1); expect(Math.abs(score.winding)).toBeCloseTo(1); expect(score.retraced).toBeLessThan(.2);
  expect(report.radial.minM).toBeGreaterThan(1084); expect(report.radial.minM).toBeLessThan(1087); expect(report.radial.maxM).toBeGreaterThan(2084); expect(report.radial.maxM).toBeLessThan(2087);
  expect(report.lengthWithin30PercentRadius).toBeGreaterThan(.96); expect(report.lengthWithin30PercentRadius).toBeLessThan(.97); expect(report.maxAbsoluteDepartureM / 1500).toBeGreaterThan(.39);
  expect(report.p95AbsoluteDepartureM).toBeGreaterThan(420); expect(report.p95AbsoluteDepartureM).toBeLessThan(440); expect(report.absoluteAngularTravelTurns).toBeGreaterThan(1.06); expect(report.absoluteAngularTravelTurns).toBeLessThan(1.07);
  expect(report.points).toBe(i === 0 ? 432 : 443);
 }
});
it('serializes every actual rejected geometry point faithfully for diagnostics, without making it accepted', () => {
 for (const response of fixture.responses) {
  const points = response.body.features[0].geometry.coordinates.map(([lon, lat]) => ({ lat, lon })), report = diagnoseShape(points, settings);
  const diagnostic: Route = { points, lengthM: report.score.lengthM, error: report.score.distanceError, roundness: report.score.roundness, repeated: report.score.retraced, unknownSurface: 0, snapM: report.score.snapM, circleCenter: settings.center, circleRadiusM: 1500, candidates: 2, notes: ['Rejected diagnostic geometry; not an accepted app route.'], license: fixture.provenance.license };
  const xml = toGpx(diagnostic), tracks = [...xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"\/>/g)]; expect(tracks).toHaveLength(points.length);
  tracks.forEach((track, i) => { expect(track[1]).toBe(points[i].lat.toFixed(7)); expect(track[2]).toBe(points[i].lon.toFixed(7)); }); expect(points[0]).toEqual(points.at(-1)); expect(xml).toContain('CC BY-SA 4.0'); expect(xml).toContain('HeiGIT');
 }
});
it('cancels before the second captured direction, without another mocked provider send', async () => {
 vi.useFakeTimers(); const controller = new AbortController(), client = vi.fn().mockResolvedValue(Response.json(fixture.responses[0].body));
 const pending = createLoopPlanner(createOrsProvider('fixture-only-not-a-real-key', client))({ requestId: 'la-cancel', settings }, controller.signal); await vi.advanceTimersByTimeAsync(50); controller.abort(); expect((await pending).status).toBe('cancelled'); await vi.advanceTimersByTimeAsync(2000); expect(client).toHaveBeenCalledTimes(1);
});

it('prefers an in-tolerance second direction over a complete larger first candidate', async () => {
 vi.useFakeTimers(); const { pointOnCircle, bearingTo } = await import('../src/circle'); const { trackLength } = await import('../src/routing/geo'); let calls = 0;
 const pending = createLoopPlanner({ route: async coordinates => {
  if (++calls === 1) { const f = fixture.responses[0].body.features[0]; return { points: f.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })), distanceM: f.properties.summary.distance, waypoints: f.properties.way_points, surface: f.properties.extras.surface.values as [number, number, number][] }; }
  const bearing = bearingTo(settings.center, coordinates[0]), points = Array.from({ length: 65 }, (_, i) => pointOnCircle(settings.center, 1500, bearing - i * 360 / 64)); points[0] = { ...coordinates[0] }; points[64] = { ...points[0] };
  return { points, distanceM: trackLength(points), waypoints: Array.from({ length: 9 }, (_, i) => i * 8), surface: [[0, 64, 3]] };
 } })({ requestId: 'prefer-normal', settings }, new AbortController().signal);
 await vi.advanceTimersByTimeAsync(1600); const result = await pending; expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error(); expect(result.route.distanceNotice).toBeUndefined(); expect(result.route.error).toBeLessThan(.3); expect(calls).toBe(2);
});
it('never promotes an open partial route and preserves an earlier complete loop if repair is unavailable', async () => {
 vi.useFakeTimers(); const base = fixture.responses[0].body.features[0], complete = () => ({ points: base.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })), distanceM: base.properties.summary.distance, waypoints: base.properties.way_points, surface: base.properties.extras.surface.values as [number, number, number][] });
 const open = complete(); open.points[open.points.length - 1] = { ...open.points[open.points.length - 2] };
 const failed = createLoopPlanner({ route: async () => open })({ requestId: 'partial', settings }, new AbortController().signal); await vi.advanceTimersByTimeAsync(1600); expect((await failed).status).not.toBe('ok');
 const { ProviderFailure } = await import('../src/loop/types'); let calls = 0;
 const saved = createLoopPlanner({ route: async () => { if (++calls === 1) return complete(); throw new ProviderFailure('unavailable', 'Service quota reached.', 60); } })({ requestId: 'safe-existing', settings }, new AbortController().signal);
 await vi.advanceTimersByTimeAsync(1600); const result = await saved; expect(result.status).toBe('ok'); if (result.status !== 'ok') throw new Error(); expect(result.route.distanceNotice).toBeDefined(); expect(result.route.points).toEqual(complete().points); expect(result.route.notes.join(' ')).toContain('60 seconds');
});
