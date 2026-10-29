// Buffered Function URL adapter. Importing this module never reads a secret.
// Events carry no browser-disconnect signal; the controller bounds invocation
// work only. UI cancellation/stale-result guards remain a separate guarantee.
import { createLoopPlanner } from './loop';
import { createOrsProvider } from './ors';
import { validateSettings } from '../src/routing/solve';
import type { LoopRequest, LoopResult, PreparedProvider } from '../src/loop/types';
export const PARAMETER_NAME = '/great-circle/production/ors-api-key';
export const ALLOWED_ORIGIN = 'https://stethem.com';
const BODY_LIMIT = 16384, RESPONSE_LIMIT = 5 * 1024 * 1024, PLAN_MS = 20000;
export type FunctionUrlEvent = { version?: string; rawPath?: string; rawQueryString?: string; headers?: Record<string, string | undefined>; body?: string | null; isBase64Encoded?: boolean; requestContext?: { http?: { method?: string } } };
export type LambdaContext = { getRemainingTimeInMillis(): number };
type HttpResult = { statusCode: number; headers: Record<string, string>; body: string; isBase64Encoded: false };
type Dependencies = { loadSecret(signal: AbortSignal): Promise<string>; client?: typeof fetch; makeProvider?: (key: string) => PreparedProvider };
async function bounded<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
 let stop!: () => void;
 const aborted = new Promise<never>((_resolve, reject) => { stop = () => reject(signal.reason); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop(); });
 try { return await Promise.race([task, aborted]); } finally { signal.removeEventListener('abort', stop); }
}
export function createLambdaHandler(dependencies: Dependencies) {
 let provider: PreparedProvider | undefined, active = false, nextSecretAt = 0;
 return async (event: FunctionUrlEvent, context: LambdaContext): Promise<HttpResult> => {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  // CORS headers are emitted by Function URL configuration, not duplicated here.
  const send = (statusCode: number, data: unknown, retry?: number): HttpResult => {
   if (retry && Number.isFinite(retry) && retry > 0) headers['retry-after'] = String(Math.ceil(retry));
   const body = JSON.stringify(data);
   if (Buffer.byteLength(body) > RESPONSE_LIMIT) return { statusCode: 503, headers, body: JSON.stringify({ status: 'unavailable', requestId: typeof data === 'object' && data && 'requestId' in data ? data.requestId : '', message: 'Route response exceeded its delivery budget.', requests: typeof data === 'object' && data && 'requests' in data ? data.requests : 0, providerRequests: typeof data === 'object' && data && 'providerRequests' in data ? data.providerRequests : 0 }), isBase64Encoded: false };
   return { statusCode, headers, body, isBase64Encoded: false };
  };
  const failure = (code: number, message: string, requestId = '', retry?: number) => send(code, { status: code < 500 && code !== 429 ? 'invalid-request' : 'unavailable', requestId, message, requests: 0, providerRequests: 0 }, retry);
  if (event?.version !== '2.0') return failure(400, 'Expected a buffered Function URL event.');
  const method = event.requestContext?.http?.method, path = event.rawPath;
  const incoming = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  if (incoming.origin && incoming.origin !== ALLOWED_ORIGIN) return failure(403, 'Origin not allowed.');
  if (event.rawQueryString) return failure(400, 'Query parameters are not supported.');
  if (method === 'GET' && path === '/api/health') return send(200, { ok: true, provider: 'openrouteservice', secret: 'not-checked' });
  if (method === 'OPTIONS' && path === '/api/loop' && incoming.origin === ALLOWED_ORIGIN) return { statusCode: 204, headers, body: '', isBase64Encoded: false };
  if (method !== 'POST' || path !== '/api/loop') return failure(404, 'Unknown endpoint.');
  if (incoming.origin !== ALLOWED_ORIGIN) return failure(403, 'Origin not allowed.');
  if (incoming['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return failure(415, 'Send JSON.');
  if (typeof event.body !== 'string') return failure(400, 'Invalid JSON.');
  let bytes: Buffer;
  if (event.isBase64Encoded) {
   if (event.body.length > Math.ceil(BODY_LIMIT / 3) * 4) return failure(413, 'Request is too large.');
   if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.body)) return failure(400, 'Invalid base64 body.');
   bytes = Buffer.from(event.body, 'base64');
  } else { if (Buffer.byteLength(event.body) > BODY_LIMIT) return failure(413, 'Request is too large.'); bytes = Buffer.from(event.body); }
  if (bytes.length > BODY_LIMIT) return failure(413, 'Request is too large.');
  let input: LoopRequest;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return failure(400, 'Invalid JSON.'); }
  if (!input || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.requestId)) return failure(400, 'Choose a valid request ID.');
  try { validateSettings(input.settings); if (!input.settings.circleRadiusM) throw new Error(); } catch { return failure(400, 'Choose a valid circle and route preferences.', input.requestId); }
  if (active) return failure(429, 'Another route is running. Try again shortly.', input.requestId, 2);
  if (!provider && Date.now() < nextSecretAt) return failure(503, 'Routing secret is unavailable. Try later.', input.requestId, Math.ceil((nextSecretAt - Date.now()) / 1000));
  const remaining = context.getRemainingTimeInMillis();
  if (!Number.isFinite(remaining) || remaining < 2000) return failure(503, 'Not enough execution time remains. Try later.', input.requestId);
  const controller = new AbortController(), started = Date.now(), budget = Math.min(PLAN_MS, remaining - 1000);
  const timer = setTimeout(() => controller.abort(new Error('Routing time budget reached.')), budget); active = true;
  try {
   if (!provider) {
    let key: string;
    try {
     key = await bounded(dependencies.loadSecret(controller.signal), controller.signal);
     if (typeof key !== 'string' || !key.trim() || Buffer.byteLength(key) > 4096) throw new Error();
    } catch { nextSecretAt = Date.now() + 30000; return failure(503, controller.signal.aborted ? 'Routing time budget reached. Try later.' : 'Routing secret is unavailable. Check the server configuration.', input.requestId, 30); }
    controller.signal.throwIfAborted();
    provider = dependencies.makeProvider?.(key.trim()) ?? createOrsProvider(key.trim(), dependencies.client);
   }
   const timeLeft = budget - (Date.now() - started); if (timeLeft <= 0) return failure(503, 'Routing time budget reached. Try later.', input.requestId);
   const result: LoopResult = await createLoopPlanner(provider, timeLeft)(input, controller.signal);
   // An invocation deadline is a service limit, not a browser cancellation.
   if (controller.signal.aborted) return send(503, { status: 'unavailable', requestId: input.requestId, message: 'Routing time budget reached. Try later.', requests: result.requests, providerRequests: result.providerRequests });
   return send(result.status === 'ok' ? 200 : result.status === 'invalid-request' ? 400 : result.status === 'unavailable' ? 503 : 422, result, result.status === 'unavailable' ? result.retryAfterSeconds : undefined);
  } catch { return failure(503, controller.signal.aborted ? 'Routing time budget reached. Try later.' : 'Routing service is unavailable.', input.requestId); }
  finally { clearTimeout(timer); active = false; }
 };
}
// Only the invoked production handler can read this fixed parameter. Tests inject
// loadSecret and never invoke this source. No local Keychain or fallback env key.
async function loadProductionSecret(signal: AbortSignal): Promise<string> {
 const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
 const client = new SSMClient({ region: 'us-east-1', maxAttempts: 1 });
 try {
  const result = await client.send(new GetParameterCommand({ Name: PARAMETER_NAME, WithDecryption: true }), { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) });
  if (result.Parameter?.Type !== 'SecureString' || !result.Parameter.Value) throw new Error('Unavailable');
  return result.Parameter.Value;
 } finally { client.destroy(); }
}
export const handler = createLambdaHandler({ loadSecret: loadProductionSecret });
