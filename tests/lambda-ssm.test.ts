import { afterEach, expect, it, vi } from 'vitest';
import { exampleSettings } from '../src/selection';
import { pointOnCircle, bearingTo } from '../src/circle';
import { trackLength } from '../src/routing/geo';
const sdk = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), configuration: vi.fn(), command: vi.fn() }));
vi.mock('@aws-sdk/client-ssm', () => ({ SSMClient: class { constructor(config: unknown) { sdk.configuration(config); } send(command: { input: unknown }, options: unknown) { return sdk.send(command.input, options); } destroy() { sdk.destroy(); } }, GetParameterCommand: class { constructor(readonly input: unknown) { sdk.command(input); } } }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sdk.send.mockReset(); sdk.destroy.mockReset(); sdk.configuration.mockReset(); sdk.command.mockReset(); });
const settings = exampleSettings(), event = () => ({ version: '2.0', rawPath: '/api/loop', headers: { origin: 'https://stethem.com', 'content-type': 'application/json' }, requestContext: { http: { method: 'POST' } }, body: JSON.stringify({ requestId: 'ssm-mock', settings }) }), context = { getRemainingTimeInMillis: () => 30000 };
it('default entry point reads only the fixed SecureString through a mocked SDK and never exposes it', async () => {
 vi.resetModules(); sdk.send.mockResolvedValue({ Parameter: { Type: 'SecureString', Value: 'ssm-test-only-not-real' } });
 const points = Array.from({ length: 65 }, (_, i) => pointOnCircle(settings.center, settings.circleRadiusM!, bearingTo(settings.center, settings.start) + i * 360 / 64)); points[64] = { ...points[0] };
 const client = vi.fn().mockResolvedValue(Response.json({ features: [{ geometry: { type: 'LineString', coordinates: points.map(p => [p.lon, p.lat]) }, properties: { summary: { distance: trackLength(points) }, way_points: Array.from({ length: 9 }, (_, i) => i * 8), extras: { surface: { values: [[0, 64, 3]] } } } }] })); vi.stubGlobal('fetch', client);
 const { handler } = await import('../server/lambda'); const result = await handler(event(), context);
 expect(sdk.configuration).toHaveBeenCalledWith({ region: 'us-east-1', maxAttempts: 1 }); expect(sdk.command).toHaveBeenCalledWith({ Name: '/great-circle/production/ors-api-key', WithDecryption: true }); expect(sdk.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal); expect(sdk.destroy).toHaveBeenCalledTimes(1); expect(result.statusCode).toBe(200); expect(result.body).not.toContain('ssm-test-only'); expect(client.mock.calls[0][1].headers.Authorization).toBe('ssm-test-only-not-real');
});
it('rejects plaintext/missing parameters and bounds a hung mocked SSM call at three seconds', async () => {
 vi.resetModules(); sdk.send.mockResolvedValue({ Parameter: { Type: 'String', Value: 'must-not-use' } }); const client = vi.fn(); vi.stubGlobal('fetch', client); const first = await (await import('../server/lambda')).handler(event(), context); expect(first.statusCode).toBe(503); expect(client).not.toHaveBeenCalled(); expect(first.body).not.toContain('must-not-use');
 vi.resetModules(); vi.useFakeTimers(); sdk.send.mockImplementation((_input, { abortSignal }) => new Promise((_resolve, reject) => { abortSignal.addEventListener('abort', () => reject(new Error('mock-secret-should-not-echo')), { once: true }); })); const pending = (await import('../server/lambda')).handler(event(), context); await vi.advanceTimersByTimeAsync(3001); expect((await pending).statusCode).toBe(503); expect(client).not.toHaveBeenCalled();
});
