import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOrsProvider } from './ors';
import { createLoopPlanner } from './loop';
import type { LoopRequest, PreparedProvider } from '../src/loop/types';
export function makeLoopServer(provider: PreparedProvider, configured: boolean) {
 const plan = createLoopPlanner(provider); let active = false;
 const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
  const send = (code: number, body: unknown) => { if (!response.destroyed) { response.writeHead(code); response.end(JSON.stringify(body)); } };
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(request.headers.host ?? '')) return send(403, { status: 'unavailable', message: 'Host not allowed.' });
  const origin = request.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return send(403, { status: 'unavailable', message: 'Origin not allowed.' });
  if (request.method === 'GET' && request.url === '/api/health') return send(200, { ok: true, configured, provider: 'openrouteservice' });
  if (request.method !== 'POST' || request.url !== '/api/loop') return send(404, { status: 'unavailable', message: 'Unknown endpoint.' });
  if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { status: 'invalid-request', message: 'Send JSON.' });
  const controller = new AbortController(), abort = () => controller.abort(); request.once('aborted', abort); response.once('close', () => { if (!response.writableEnded) abort(); });
  try {
   const chunks: Buffer[] = []; let bytes = 0;
   for await (const chunk of request) { bytes += chunk.length; if (bytes > 16384) return send(413, { status: 'invalid-request', message: 'Request is too large.' }); chunks.push(chunk); }
   let input: LoopRequest; try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(400, { status: 'invalid-request', message: 'Invalid JSON.' }); }
   if (active) return send(503, { status: 'unavailable', requestId: input.requestId, message: 'Another route is running. Try again shortly.', requests: 0, providerRequests: 0 });
   active = true;
   try { const result = await plan(input, controller.signal); send(result.status === 'ok' ? 200 : result.status === 'invalid-request' ? 400 : result.status === 'unavailable' ? 503 : 422, result); } finally { active = false; }
  } catch { if (!controller.signal.aborted) send(503, { status: 'unavailable', message: 'Routing service unavailable.' }); }
 });
 server.requestTimeout = 10000; server.headersTimeout = 10000; server.timeout = 35000; return server;
}
// The optional Keychain source is read only when explicitly selected at launch.
// No key is written, printed, exposed via health, or included in a browser bundle.
export function loadServerKey(): string | undefined {
 if (process.env.ORS_API_KEY?.trim()) return process.env.ORS_API_KEY.trim();
 const service = process.env.ORS_KEYCHAIN_SERVICE;
 if (process.platform === 'darwin' && service && /^[a-zA-Z0-9._-]{1,80}$/.test(service)) try { return execFileSync('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim() || undefined; } catch { return undefined; }
 return undefined;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const key = loadServerKey(); makeLoopServer(createOrsProvider(key), !!key).listen(8787, '127.0.0.1', () => console.log(`Great Circle local API: http://127.0.0.1:8787 (${key ? 'ORS configured' : 'key not configured'})`));
}
