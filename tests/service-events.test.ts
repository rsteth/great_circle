import { afterEach, expect, it, vi } from 'vitest';
import { createServiceReporter } from '../server/service-events';
import { createOrsProvider } from '../server/ors';
import { createLambdaHandler, ALLOWED_ORIGIN, type FunctionUrlEvent } from '../server/lambda';
import { ProviderFailure } from '../src/loop/types';
import { exampleSettings } from '../src/selection';
const settings = exampleSettings(), context = { getRemainingTimeInMillis: () => 30000 };
const event = (): FunctionUrlEvent => ({ version: '2.0', rawPath: '/api/loop', headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' }, requestContext: { http: { method: 'POST', sourceIp: '192.0.2.1' } }, body: JSON.stringify({ requestId: 'sensitive-route-id', settings }) });
const guard = { start: async () => {}, reserve: async () => ({ expiresAt: Date.now() + 20_000 }) };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('only allowlisted static event fields are emitted, at most once per reason per minute, with inert sink errors', () => {
 let now = 100_000; const log = vi.fn(), report = createServiceReporter(log, () => now);
 for (let i = 0; i < 100; i++) report('ors_unavailable');
 report('secret_unavailable'); report('ors_timeout'); report('SECRET http://example.invalid/private?key=PRIVATE' as never);
 expect(log.mock.calls).toEqual(['ors_unavailable', 'secret_unavailable', 'ors_timeout'].map(reason => [{ event: 'routing_service', reason }]));
 now += 59_999; report('ors_unavailable'); expect(log).toHaveBeenCalledTimes(3);
 now++; report('ors_unavailable'); expect(log).toHaveBeenCalledTimes(4);
 expect(() => createServiceReporter(() => { throw Error('SECRET'); })('secret_unavailable')).not.toThrow();
});
it('reports attempted ORS HTTP/transport/data failures without input, body or exception details', async () => {
 const failures = [
  ...[401, 403, 429, 500, 502, 503].map(status => async () => Response.json({ error: { message: 'SECRET coordinates private', code: 2010 } }, { status })),
  async () => { throw Error('SECRET https://private.invalid?key=SECRET'); },
  async () => new Response('SECRET-not-json', { status: 200 }),
  async () => Response.json({ features: [{ geometry: { type: 'bad', coordinates: ['PRIVATE'] } }] })
 ];
 for (const failure of failures) {
  const log = vi.fn(), client = vi.fn(failure) as unknown as typeof fetch, provider = createOrsProvider('SECRET', client, undefined, createServiceReporter(log));
  await expect(provider.route([settings.start], settings, new AbortController().signal)).rejects.toBeInstanceOf(ProviderFailure);
  expect(log.mock.calls).toEqual([[{ event: 'routing_service', reason: 'ors_unavailable' }]]);
 }
});
it('expected unroutable, denied gate/lease and local cancellation do not create ORS operational alerts', async () => {
 for (const status of [400, 404]) {
  const log = vi.fn(), provider = createOrsProvider('SECRET', vi.fn(async () => Response.json({ error: { code: 2010 } }, { status })), undefined, createServiceReporter(log));
  await expect(provider.route([settings.start], settings, new AbortController().signal)).rejects.toMatchObject({ kind: 'unroutable' }); expect(log).not.toHaveBeenCalled();
 }
 for (const before of [async () => { throw new ProviderFailure('unavailable', 'guard denied'); }, async () => ({ expiresAt: 0 })]) {
  const log = vi.fn(), client = vi.fn(), provider = createOrsProvider('SECRET', client, before, createServiceReporter(log));
  await expect(provider.route([settings.start], settings, new AbortController().signal)).rejects.toThrow(); expect(client).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
 }
 const log = vi.spyOn(console, 'warn').mockImplementation(() => {}), controller = new AbortController();
 const local = createOrsProvider('SECRET', vi.fn(async () => { controller.abort(Error('PRIVATE cancellation')); throw controller.signal.reason; }));
 await expect(local.route([settings.start], settings, controller.signal)).rejects.toThrow('PRIVATE'); expect(log).not.toHaveBeenCalled();
});
it('production timeout is reported after upstream attempt even when fetch ignores abort, only once', async () => {
 vi.useFakeTimers();
 const log = vi.spyOn(console, 'warn').mockImplementation(() => {}), client = vi.fn(() => new Promise<Response>(() => {}));
 const handler = createLambdaHandler({ loadSecret: async () => 'SECRET', guard, client });
 const pending = handler(event(), context); await vi.advanceTimersByTimeAsync(20_001);
 const result = await pending; expect(result.statusCode).toBe(503); expect(client).toHaveBeenCalledTimes(1);
 expect(log.mock.calls).toEqual([[{ event: 'routing_service', reason: 'ors_timeout' }]]); expect(result.body).not.toContain('SECRET');
});
it('secret access denial, malformed/empty/oversized secret and timeout emit only bounded static events', async () => {
 vi.useFakeTimers();
 for (const loadSecret of [async () => { throw Error('AccessDenied SECRET URL'); }, async () => '', async () => ' ', async () => 'S'.repeat(4097), async () => new Promise<string>(() => {})]) {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {}), client = vi.fn(), handler = createLambdaHandler({ loadSecret, guard, client });
  const first = handler(event(), context); await vi.advanceTimersByTimeAsync(20_001); expect((await first).statusCode).toBe(503);
  await handler(event(), context); expect(log.mock.calls).toEqual([[{ event: 'routing_service', reason: 'secret_unavailable' }]]); expect(client).not.toHaveBeenCalled(); log.mockRestore();
 }
});
it('health/preflight/invalid input do not read secrets, touch gates or emit service events', async () => {
 const log = vi.spyOn(console, 'warn').mockImplementation(() => {}), loadSecret = vi.fn(), start = vi.fn(), reserve = vi.fn(), handler = createLambdaHandler({ loadSecret, guard: { start, reserve } });
 await handler({ version: '2.0', rawPath: '/api/health', requestContext: { http: { method: 'GET' } } }, context);
 await handler({ ...event(), requestContext: { http: { method: 'OPTIONS' } } }, context);
 await handler({ ...event(), body: '{}' }, context);
 expect(log).not.toHaveBeenCalled(); expect(loadSecret).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
});
it('production reporter bounds repeated ORS failures and throwing logger cannot change responses', async () => {
 vi.useFakeTimers();
 const log = vi.spyOn(console, 'warn').mockImplementation(() => { throw Error('sink PRIVATE'); });
 const client = vi.fn(async () => Response.json({}, { status: 503 })), handler = createLambdaHandler({ loadSecret: async () => 'SECRET', guard, client });
 expect((await handler(event(), context)).statusCode).toBe(503);
 await vi.advanceTimersByTimeAsync(30_001); expect((await handler(event(), context)).statusCode).toBe(503);
 expect(client).toHaveBeenCalledTimes(2); expect(log).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(30_001); expect((await handler(event(), context)).statusCode).toBe(503); expect(log).toHaveBeenCalledTimes(2);
});
