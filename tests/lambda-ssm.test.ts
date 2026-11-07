import { afterEach, expect, it, vi } from 'vitest';
import { exampleSettings } from '../src/selection';
import { pointOnCircle, bearingTo } from '../src/circle';
import { trackLength } from '../src/routing/geo';
const sdk = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), configuration: vi.fn(), command: vi.fn() }));
vi.mock('@aws-sdk/client-ssm', () => ({ SSMClient: class { constructor(config: unknown) { sdk.configuration(config); } send(command: { input: unknown }, options: unknown) { return sdk.send(command.input, options); } destroy() { sdk.destroy(); } }, GetParameterCommand: class { constructor(readonly input: unknown) { sdk.command(input); } } }));
vi.mock('../server/guard-store', () => ({ createDynamoGuardStore: () => { const rows = new Map<string, unknown>([['control', { enabled: true, counter: { revision: 0, lastAt: 0, minute: [], hours: [] } }]]); return { read: async (key: string) => rows.get(key), compareAndSet: async (key: string, _old: unknown, next: unknown) => { rows.set(key, next); return true; } }; } }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sdk.send.mockReset(); sdk.destroy.mockReset(); sdk.configuration.mockReset(); sdk.command.mockReset(); });
const settings = exampleSettings(), event = () => ({ version: '2.0', rawPath: '/api/loop', headers: { origin: 'https://stethem.com', 'content-type': 'application/json' }, requestContext: { http: { method: 'POST', sourceIp: '192.0.2.1' } }, body: JSON.stringify({ requestId: 'ssm-mock', settings }) }), context = { getRemainingTimeInMillis: () => 30000 };
it('default entry point reads only the fixed SecureString through a mocked SDK and never exposes it', async () => {
 vi.resetModules(); sdk.send.mockResolvedValue({ Parameter: { Type: 'SecureString', Value: 'ssm-test-only-not-real' } });
 const points = Array.from({ length: 65 }, (_, i) => pointOnCircle(settings.center, settings.circleRadiusM!, bearingTo(settings.center, settings.start) + i * 360 / 64)); points[64] = { ...points[0] };
 const client = vi.fn().mockResolvedValue(Response.json({ features: [{ geometry: { type: 'LineString', coordinates: points.map(p => [p.lon, p.lat]) }, properties: { summary: { distance: trackLength(points) }, way_points: Array.from({ length: 9 }, (_, i) => i * 8), extras: { surface: { values: [[0, 64, 3]] } } } }] })); vi.stubGlobal('fetch', client);
 const { handler } = await import('../server/lambda'); const result = await handler(event(), context);
 expect(sdk.configuration).toHaveBeenCalledWith({ region: 'us-east-1', maxAttempts: 1 }); expect(sdk.command).toHaveBeenCalledWith({ Name: '/great-circle/production/ors-api-key', WithDecryption: true }); expect(sdk.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal); expect(sdk.destroy).toHaveBeenCalledTimes(1); expect(result.statusCode).toBe(200); expect(result.body).not.toContain('ssm-test-only'); expect(client.mock.calls[0][1].headers.Authorization).toBe('ssm-test-only-not-real');
});
it('rejects plaintext/missing parameters and bounds a hung mocked SSM call at three seconds', async () => {
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 vi.resetModules(); sdk.send.mockResolvedValue({ Parameter: { Type: 'String', Value: 'must-not-use' } }); const client = vi.fn(); vi.stubGlobal('fetch', client); const first = await (await import('../server/lambda')).handler(event(), context); expect(first.statusCode).toBe(503); expect(client).not.toHaveBeenCalled(); expect(first.body).not.toContain('must-not-use');
 vi.resetModules(); vi.useFakeTimers(); sdk.send.mockImplementation((_input, { abortSignal }) => new Promise((_resolve, reject) => { abortSignal.addEventListener('abort', () => reject(new Error('mock-secret-should-not-echo')), { once: true }); })); const pending = (await import('../server/lambda')).handler(event(), context); await vi.advanceTimersByTimeAsync(3001); expect((await pending).statusCode).toBe(503); expect(client).not.toHaveBeenCalled(); expect(warn.mock.calls).toEqual([[{ event: 'routing_service', reason: 'secret_unavailable' }], [{ event: 'routing_service', reason: 'secret_unavailable' }]]);
});
it('mocked SSM AccessDenied/missing/plaintext/blank values emit static bounded operational warnings', async () => {
 vi.useFakeTimers();
 for (const response of [undefined, {}, { Parameter: { Type: 'String', Value: 'PRIVATE' } }, { Parameter: { Type: 'SecureString', Value: ' ' } }]) {
  vi.resetModules(); sdk.send.mockReset(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  if (response === undefined) sdk.send.mockRejectedValue(Object.assign(new Error('PRIVATE secret path and credentials'), { name: 'AccessDeniedException' })); else sdk.send.mockResolvedValue(response);
  const { handler } = await import('../server/lambda'); const first = await handler(event(), context); expect(first.statusCode).toBe(503); expect(first.body).not.toContain('PRIVATE');
  await vi.advanceTimersByTimeAsync(30_001); await handler(event(), context);
  expect(sdk.send).toHaveBeenCalledTimes(2); expect(warn.mock.calls).toEqual([[{ event: 'routing_service', reason: 'secret_unavailable' }]]); warn.mockRestore();
 }
});
