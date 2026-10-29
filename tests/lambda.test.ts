import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLambdaHandler, ALLOWED_ORIGIN, PARAMETER_NAME, type FunctionUrlEvent } from '../server/lambda';
import { exampleSettings } from '../src/selection';
import { pointOnCircle, bearingTo } from '../src/circle';
import { trackLength } from '../src/routing/geo';
import { ORS_ENDPOINT } from '../server/ors';
const settings = exampleSettings(), context = { getRemainingTimeInMillis: () => 30000 };
const event = (patch: Partial<FunctionUrlEvent> = {}): FunctionUrlEvent => ({ version: '2.0', rawPath: '/api/loop', rawQueryString: '', headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' }, requestContext: { http: { method: 'POST' } }, body: JSON.stringify({ requestId: 'lambda-test', settings }), isBase64Encoded: false, ...patch });
function geometry() { const points = Array.from({ length: 65 }, (_, i) => pointOnCircle(settings.center, settings.circleRadiusM!, bearingTo(settings.center, settings.start) + i * 360 / 64)); points[64] = { ...points[0] }; return { points, distanceM: trackLength(points), waypoints: Array.from({ length: 9 }, (_, i) => i * 8), surface: [[0, 64, 3]] as [number, number, number][] }; }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('health/preflight/invalid requests never load a secret or provider, and CORS headers belong to AWS', async () => {
 const loadSecret = vi.fn(), handler = createLambdaHandler({ loadSecret });
 const health = await handler(event({ rawPath: '/api/health', requestContext: { http: { method: 'GET' } }, headers: {} }), context); expect(JSON.parse(health.body)).toEqual({ ok: true, provider: 'openrouteservice', secret: 'not-checked' });
 const preflight = await handler(event({ requestContext: { http: { method: 'OPTIONS' } } }), context); expect(preflight.statusCode).toBe(204); expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
 for (const [input, code] of [[event({ version: '1' }), 400], [event({ headers: { origin: 'https://unrelated.invalid' } }), 403], [event({ headers: { 'content-type': 'application/json' } }), 403], [event({ rawPath: '/proxy' }), 404], [event({ rawQueryString: 'url=https://unrelated.invalid' }), 400], [event({ headers: { origin: ALLOWED_ORIGIN, 'content-type': 'text/plain' } }), 415], [event({ body: '{bad' }), 400], [event({ body: null }), 400], [event({ body: JSON.stringify({ requestId: 'x', settings: {} }) }), 400]] as const) expect((await handler(input, context)).statusCode).toBe(code);
 expect(loadSecret).not.toHaveBeenCalled();
});
it('accepts buffered plain/base64 JSON with exact UTF8/decoded limits, rejects malformed encodings', async () => {
 const loadSecret = vi.fn().mockResolvedValue('fake-unit-secret'), handler = createLambdaHandler({ loadSecret, makeProvider: () => ({ route: async () => geometry() }) });
 const plain = await handler(event(), context); expect(plain.statusCode).toBe(200); const base64 = await handler(event({ isBase64Encoded: true, body: Buffer.from(event().body!).toString('base64') }), context); expect(base64.statusCode).toBe(200); expect(loadSecret).toHaveBeenCalledTimes(1);
 for (const input of [event({ body: 'x'.repeat(16385) }), event({ isBase64Encoded: true, body: Buffer.alloc(16385).toString('base64') })]) expect((await handler(input, context)).statusCode).toBe(413);
 expect((await handler(event({ isBase64Encoded: true, body: '%%%invalid' }), context)).statusCode).toBe(400);
 expect((await handler(event({ isBase64Encoded: true, body: Buffer.from([255]).toString('base64') }), context)).statusCode).toBe(400);
});
it('does not echo secret failures, caches no failed key, and cools down before another load', async () => {
 vi.useFakeTimers(); const loadSecret = vi.fn().mockRejectedValue(new Error('DO-NOT-ECHO-sensitive-value')), log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), handler = createLambdaHandler({ loadSecret });
 const first = await handler(event(), context); expect(first.statusCode).toBe(503); expect(first.headers['retry-after']).toBe('30'); expect(first.body).not.toContain('DO-NOT'); expect(JSON.parse(first.body).providerRequests).toBe(0);
 await handler(event(), context); expect(loadSecret).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(30001); await handler(event(), context); expect(loadSecret).toHaveBeenCalledTimes(2); expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});
it('uses only the fixed ORS endpoint and server secret, not caller auth, identity, cookies or proxy input', async () => {
 const g = geometry(), client = vi.fn().mockResolvedValue(Response.json({ features: [{ geometry: { type: 'LineString', coordinates: g.points.map(p => [p.lon, p.lat]) }, properties: { summary: { distance: g.distanceM }, way_points: g.waypoints, extras: { surface: { values: g.surface } } } }] }));
 const handler = createLambdaHandler({ loadSecret: async () => 'fake-ssm-secret', client }), result = await handler(event({ headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json; charset=utf-8', Authorization: 'do-not-forward', Cookie: 'do-not-forward' }, body: JSON.stringify({ requestId: 'fixed', settings, upstream: 'https://unrelated.invalid' }) }), context);
 expect(result.statusCode).toBe(200); expect(client).toHaveBeenCalledTimes(1); const [url, init] = client.mock.calls[0]; expect(url).toBe(ORS_ENDPOINT); expect(init.headers.Authorization).toBe('fake-ssm-secret'); expect(JSON.stringify(init)).not.toContain('do-not-forward'); expect(JSON.stringify(init)).not.toContain('upstream'); expect(result.body).not.toContain('fake-ssm-secret'); expect(result.headers['cache-control']).toBe('no-store');
});
it('blocks overlapping work and enforces a 20-second aggregate deadline even on noncooperative secret/provider', async () => {
 vi.useFakeTimers(); const loadSecret = vi.fn(() => new Promise<string>(() => {})), handler = createLambdaHandler({ loadSecret });
 const pending = handler(event(), context); const busy = await handler(event(), context); expect(busy.statusCode).toBe(429); expect(busy.headers['retry-after']).toBe('2'); await vi.advanceTimersByTimeAsync(20001); const result = await pending; expect(result.statusCode).toBe(503); expect(result.body).toContain('time budget'); expect(loadSecret).toHaveBeenCalledTimes(1);
 const route = vi.fn(() => new Promise<ReturnType<typeof geometry>>(() => {})), providerHandler = createLambdaHandler({ loadSecret: async () => 'fake', makeProvider: () => ({ route }) }); const work = providerHandler(event(), context); await vi.advanceTimersByTimeAsync(20001); const timed = await work; expect(timed.statusCode).toBe(503); expect(JSON.parse(timed.body).requests).toBe(1); expect(JSON.parse(timed.body).providerRequests).toBe(1); expect(route).toHaveBeenCalledTimes(1);
});
it('subtracts secret-loading time and remaining invocation time from the same planner budget', async () => {
 vi.useFakeTimers(); const route = vi.fn(() => new Promise<ReturnType<typeof geometry>>(() => {})), handler = createLambdaHandler({ loadSecret: () => new Promise(resolve => setTimeout(() => resolve('fake'), 8000)), makeProvider: () => ({ route }) });
 const pending = handler(event(), context); await vi.advanceTimersByTimeAsync(8001); expect(route).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(12000); expect((await pending).statusCode).toBe(503);
 const short = createLambdaHandler({ loadSecret: () => new Promise(() => {}) }); const limited = short(event(), { getRemainingTimeInMillis: () => 4000 }); await vi.advanceTimersByTimeAsync(3001); expect((await limited).statusCode).toBe(503);
 const noTime = vi.fn(); expect((await createLambdaHandler({ loadSecret: noTime })(event(), { getRemainingTimeInMillis: () => 1500 })).statusCode).toBe(503); expect(noTime).not.toHaveBeenCalled();
});
it('keeps provider Retry-After and warm-instance cooldown without logging or claiming durable quotas', async () => {
 vi.useFakeTimers(); const client = vi.fn().mockResolvedValue(Response.json({}, { status: 429, headers: { 'retry-after': '75' } })), handler = createLambdaHandler({ loadSecret: async () => 'fake', client });
 const first = await handler(event(), context); expect(first.statusCode).toBe(503); expect(first.headers['retry-after']).toBe('75'); await handler(event(), context); expect(client).toHaveBeenCalledTimes(1);
});
it('proposal is fail-closed on account/region/public exposure and grants runtime access only to one parameter/own logs', () => {
 const template = JSON.parse(readFileSync(new URL('../infra/lambda/template.proposed.json', import.meta.url), 'utf8')), resources = template.Resources;
 expect(template.Parameters.PublicEndpointApproved.Default).toBe('false'); expect(template.Parameters.ExpectedAccountId.Default).toBeUndefined(); expect(resources.ApiFunction.Properties.Timeout).toBe(30); expect(resources.ApiFunction.Properties.ReservedConcurrentExecutions).toBe(1); expect(resources.ApiFunction.Properties.Runtime).toBe('nodejs24.x'); expect(resources.ApiFunction.Properties.VpcConfig).toBeUndefined(); expect(resources.ApiUrl.Properties.InvokeMode).toBe('BUFFERED'); expect(resources.ApiUrl.Condition).toBe('PublicDeploymentApproved'); expect(resources.PublicInvokeOnlyViaUrl.Properties.InvokedViaFunctionUrl).toBe(true); expect(resources.ApiUrl.Properties.Cors.AllowOrigins).toEqual([ALLOWED_ORIGIN]);
 const bootstrap = JSON.parse(readFileSync(new URL('../infra/lambda/bootstrap.proposed.json', import.meta.url), 'utf8')); const statements = bootstrap.Resources.RuntimeRole.Properties.Policies[0].PolicyDocument.Statement; expect(statements.map((s: { Action: string[] }) => s.Action)).toEqual([['ssm:GetParameter'], ['logs:CreateLogStream', 'logs:PutLogEvents']]); expect(JSON.stringify(statements[0].Resource)).toContain(PARAMETER_NAME.slice(1)); expect(JSON.stringify(template)).not.toContain('ssm:PutParameter'); expect(JSON.stringify(resources.ApiFunction.Properties.Environment)).not.toContain('ORS_API_KEY'); expect(resources.RuntimeRole).toBeUndefined(); expect(resources.ApiFunction.Properties.Role).toEqual({ Ref: 'RuntimeRoleArn' });
});

it('recurring deploy trust/policy cannot mutate IAM or read/write the ORS parameter', () => {
 const read = (name: string) => JSON.parse(readFileSync(new URL(`../infra/lambda/${name}`, import.meta.url), 'utf8'));
 const trust = read('deploy-trust.proposed.json'), policy = read('deploy-policy.proposed.json');
 expect(trust.Statement[0].Condition.StringEquals).toEqual({ 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': 'repo:rsteth/great_circle:ref:refs/heads/main' });
 const actions = policy.Statement.flatMap((s: { Action: string | string[] }) => typeof s.Action === 'string' ? [s.Action] : s.Action);
 expect(actions.filter((a: string) => a.startsWith('iam:'))).toEqual(['iam:PassRole', 'iam:GetRole']); expect(actions.some((a: string) => a.startsWith('ssm:'))).toBe(false);
 const pass = policy.Statement.find((s: { Action: unknown }) => s.Action === 'iam:PassRole'); expect(pass.Resource).toBe('arn:aws:iam::089089716476:role/great-circle-prod-runtime'); expect(pass.Condition.StringEquals['iam:PassedToService']).toBe('lambda.amazonaws.com');
 expect(JSON.stringify(policy)).toContain('APPROVED_ARTIFACT_BUCKET'); expect(actions).not.toContain('*');
});
