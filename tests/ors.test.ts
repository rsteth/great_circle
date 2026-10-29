import { afterEach, expect, it, vi } from 'vitest';
import { pointOnCircle, changeCircle } from '../src/circle';
import { trackLength } from '../src/routing/geo';
import { toGpx } from '../src/routing/gpx';
import { circleFixture } from './fixtures';
import { createOrsProvider, ORS_ENDPOINT } from '../server/ors';
import { createLoopPlanner } from '../server/loop';
import { makeLoopServer } from '../server';
import { retracedFraction, scoreGeometry } from '../src/loop/score';
import type { PreparedProvider, ProviderGeometry } from '../src/loop/types';
import { assertCompleteOsm } from '../src/routing/validateData';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const settings = changeCircle(circleFixture().settings, { radiusM: 1000, bearing: 90 });
function geometry(radius = 1000): ProviderGeometry { const points = Array.from({ length: 65 }, (_, i) => pointOnCircle(settings.center, radius, 90 + i * 360 / 64)); points[64] = { ...points[0] }; return { points, distanceM: trackLength(points), waypoints: Array.from({ length: 9 }, (_, i) => i * 8), surface: [[0, 64, 3]] }; }
function response(g = geometry()) { return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: g.points.map(p => [p.lon, p.lat]) }, properties: { summary: { distance: g.distanceM }, way_points: g.waypoints, extras: { surface: { values: g.surface } } } }] }; }
it('uses the new ORS endpoint, server auth, lon/lat ordered closure, no retry, faithful licensed GPX', async () => {
 const client = vi.fn().mockResolvedValue(Response.json(response())), provider = createOrsProvider('unit-test-key-not-real', client), result = await createLoopPlanner(provider)({ requestId: 'one', settings }, new AbortController().signal);
 expect(result.status).toBe('ok'); expect(client).toHaveBeenCalledTimes(1); expect(client.mock.calls[0][0]).toBe(ORS_ENDPOINT); expect(ORS_ENDPOINT).toContain('api.heigit.org');
 const init = client.mock.calls[0][1], body = JSON.parse(init.body); expect(init.headers.Authorization).toBe('unit-test-key-not-real'); expect(body.coordinates).toHaveLength(9); expect(body.coordinates[0]).toEqual(body.coordinates.at(-1)); expect(body.coordinates[0][0]).toBeCloseTo(settings.start.lon); expect(body.geometry_simplify).toBe(false);
 if (result.status !== 'ok') throw new Error('Expected valid loop'); expect(result.providerRequests).toBe(1); expect(result.route.points).toEqual(geometry().points);
 const xml = toGpx(result.route); expect(xml).toContain('CC BY-SA 4.0'); expect(xml).toContain('HeiGIT'); expect(xml).toContain('https://creativecommons.org/licenses/by-sa/4.0/'); expect(xml.match(/<trkpt /g)).toHaveLength(65); expect(xml).not.toContain('unit-test-key');
});
it('missing key makes no provider calls; quota/unavailable honors Retry-After and does not leak error bodies', async () => {
 const client = vi.fn(); const missing = await createLoopPlanner(createOrsProvider(undefined, client))({ requestId: 'missing', settings }, new AbortController().signal); expect(missing.status).toBe('unavailable'); expect(missing.providerRequests).toBe(0); expect(client).not.toHaveBeenCalled();
 client.mockResolvedValue(Response.json({ error: { message: 'do-not-leak-server-secret' } }, { status: 429, headers: { 'Retry-After': '90' } })); const provider = createOrsProvider('unit-test-key-not-real', client), plan = createLoopPlanner(provider);
 const failure = await plan({ requestId: 'quota', settings }, new AbortController().signal); expect(failure.status).toBe('unavailable'); if (failure.status === 'ok') throw new Error(); expect(failure.retryAfterSeconds).toBe(90); expect(JSON.stringify(failure)).not.toContain('do-not-leak');
 await plan({ requestId: 'again', settings }, new AbortController().signal); expect(client).toHaveBeenCalledTimes(1);
});
it('keeps unroutable and shape mismatch distinct, with at most two finite direction attempts', async () => {
 vi.useFakeTimers(); const route = vi.fn().mockRejectedValue(new (await import('../src/loop/types')).ProviderFailure('unroutable', 'No connection'));
 const pending = createLoopPlanner({ route })({ requestId: 'no-route', settings }, new AbortController().signal); await vi.advanceTimersByTimeAsync(1600); expect((await pending).status).toBe('unroutable'); expect(route).toHaveBeenCalledTimes(2);
 const wrong = geometry(600); const bad = vi.fn().mockResolvedValue(wrong); const failure = createLoopPlanner({ route: bad })({ requestId: 'bad-circle', settings }, new AbortController().signal); await vi.advanceTimersByTimeAsync(1600); expect((await failure).status).not.toBe('ok'); expect(bad).toHaveBeenCalledTimes(2);
});
it('does not accept open geometry, moved pinned Start or unknown paved surfaces', async () => {
 vi.useFakeTimers(); const open = geometry(); open.points[64] = open.points[63]; const route = vi.fn().mockResolvedValue(open), pending = createLoopPlanner({ route })({ requestId: 'open', settings }, new AbortController().signal); await vi.advanceTimersByTimeAsync(1600); expect((await pending).status).not.toBe('ok');
 const g = geometry(); g.surface = undefined; const pavedPending = createLoopPlanner({ route: async () => g })({ requestId: 'paved', settings: { ...settings, surface: 'paved' } }, new AbortController().signal); await vi.advanceTimersByTimeAsync(1600); expect((await pavedPending).status).toBe('unroutable');
});
it('cancels or times out even a non-cooperative provider and discards late results', async () => {
 vi.useFakeTimers(); const controller = new AbortController(); let finish!: (g: ProviderGeometry) => void; const route = vi.fn(() => new Promise<ProviderGeometry>(resolve => { finish = resolve; }));
 const pending = createLoopPlanner({ route })({ requestId: 'cancel', settings }, controller.signal); controller.abort(); expect((await pending).status).toBe('cancelled'); finish(geometry());
 const timeout = createLoopPlanner({ route: () => new Promise(() => {}) }, 20)({ requestId: 'timeout', settings }, new AbortController().signal); await vi.advanceTimersByTimeAsync(21); expect((await timeout).status).toBe('unavailable');
});
it('geometry scoring catches retrace with different segmentation, multiple laps and wrong-center loops', () => {
 const signal = new AbortController().signal, a = settings.center, b = pointOnCircle(a, 1000, 90), mid = pointOnCircle(a, 500, 90);
 expect(retracedFraction([a, b, mid, a], signal)).toBeGreaterThan(.49);
 const twice = [...geometry().points, ...geometry().points.slice(1)], score = scoreGeometry(twice, settings, signal); expect(Math.abs(score.winding)).toBeCloseTo(2); expect(score.retraced).toBeGreaterThan(.49);
 const shifted = geometry().points.map(point => ({ ...point, lat: point.lat + .03 })); expect(Math.abs(scoreGeometry(shifted, settings, signal).winding)).toBeLessThan(.1);
});
it('malformed and remarked Overpass data is rejected, while valid empty data is not called malformed', () => {
 expect(() => assertCompleteOsm({ elements: [], remark: 'runtime error: Query timed out' })).toThrow('server query timeout'); expect(() => assertCompleteOsm({ elements: [], remark: 'out of memory' })).toThrow('server memory limit');
 expect(() => assertCompleteOsm({ elements: [{ type: 'node', id: 1, lat: 'bad', lon: 1 }] })).toThrow('malformed road coordinates'); expect(() => assertCompleteOsm({ elements: [] })).not.toThrow();
 const partial = circleFixture().data; partial.elements = partial.elements.filter(element => element.id !== 2); expect(() => assertCompleteOsm(partial)).toThrow('incomplete way geometry');
});
it('thin HTTP backend has no secret in health/results and rejects cross-origin calls', async () => {
 const provider: PreparedProvider = { route: async () => geometry() }, server = makeLoopServer(provider, true); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 try { const address = server.address(); if (!address || typeof address === 'string') throw new Error(); const url = `http://127.0.0.1:${address.port}`;
  const health = await (await fetch(`${url}/api/health`)).json(); expect(health).toEqual({ ok: true, configured: true, provider: 'openrouteservice' });
  const denied = await fetch(`${url}/api/loop`, { method: 'POST', headers: { Origin: 'https://unrelated.invalid', 'Content-Type': 'application/json' }, body: '{}' }); expect(denied.status).toBe(403);
  const result = await (await fetch(`${url}/api/loop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'http', settings }) })).json(); expect(result.status).toBe('ok'); expect(JSON.stringify(result)).not.toContain('Authorization');
 } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('pins the accepted snapped Start across direction repair instead of moving it to rescue quality', async () => {
 vi.useFakeTimers(); const first = geometry(); first.points[0] = {...first.points[0], lat:first.points[0].lat+.0001}; first.points[64]={...first.points[0]}; first.points[1]=pointOnCircle(settings.center,3000,96); first.distanceM=trackLength(first.points);
 const second=geometry(); second.points.reverse();second.distanceM=trackLength(second.points);const route=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
 const pending=createLoopPlanner({route})({requestId:'pinned',settings},new AbortController().signal);await vi.advanceTimersByTimeAsync(1600);const result=await pending;expect(result.status).toBe('unroutable');if(result.status==='ok')throw new Error();expect(result.message).toContain('preserve the accepted Start');expect(route.mock.calls[1][0][0]).toEqual(first.points[0]);
});
it('preserves HTTP status/Retry-After for non-JSON failures and enforces cooldown after transport failure', async()=>{
 const client=vi.fn().mockResolvedValue(new Response('<h1>Busy</h1>',{status:503,headers:{'Retry-After':'80'}})),provider=createOrsProvider('unit-test-key-not-real',client),plan=createLoopPlanner(provider);
 const result=await plan({requestId:'html',settings},new AbortController().signal);expect(result.status).toBe('unavailable');if(result.status==='ok')throw new Error();expect(result.message).toContain('HTTP 503');expect(result.retryAfterSeconds).toBe(80);await plan({requestId:'again',settings},new AbortController().signal);expect(client).toHaveBeenCalledTimes(1);
 const broken=vi.fn().mockRejectedValue(new Error('network')),p=createLoopPlanner(createOrsProvider('unit-test-key-not-real',broken));await p({requestId:'first',settings},new AbortController().signal);await p({requestId:'second',settings},new AbortController().signal);expect(broken).toHaveBeenCalledTimes(1);
});

it('retains a failed HTTP status and cooldown even when its response body stream fails',async()=>{
 const response=new Response(new ReadableStream({start(controller){controller.error(new Error('body failed'));}}),{status:502,headers:{'Retry-After':'70'}}),client=vi.fn().mockResolvedValue(response),plan=createLoopPlanner(createOrsProvider('unit-test-key-not-real',client));
 const result=await plan({requestId:'body-error',settings},new AbortController().signal);expect(result.status).toBe('unavailable');if(result.status==='ok')throw new Error();expect(result.message).toContain('HTTP 502');expect(result.retryAfterSeconds).toBe(70);await plan({requestId:'again',settings},new AbortController().signal);expect(client).toHaveBeenCalledTimes(1);
});
it('bounds malformed large geometry before unbounded angular scoring work',()=>{
 const a=pointOnCircle(settings.center,300000,0),b=pointOnCircle(settings.center,300000,180),points=Array.from({length:200},(_,i)=>i%2?a:b);points.push(points[0]);expect(()=>scoreGeometry(points,settings,new AbortController().signal)).toThrow('scoring budget');
});
