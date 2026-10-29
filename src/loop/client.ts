import { distance } from '../routing/geo';
import type { Settings } from '../routing/types';
import type { LoopResult } from './types';
export const ROUTING_MODE = import.meta.env.VITE_ROUTING_MODE === 'legacy' ? 'legacy' : 'ors';
export async function requestLoop(settings: Settings, requestId: string, signal: AbortSignal, client: typeof fetch = fetch): Promise<LoopResult> {
 const controller = new AbortController(), cancel = () => controller.abort(signal.reason); signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
 const timer = setTimeout(() => controller.abort(new Error('Routing service took too long. Try later.')), 25000);
 try {
  const response = await client(import.meta.env.VITE_LOOP_URL || '/api/loop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, settings }), signal: controller.signal });
  const reader = response.body?.getReader(); if (!reader) throw new Error('Routing service is unavailable.'); const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 8 * 1024 * 1024) { void reader.cancel().catch(() => {}); throw new Error('Route response exceeded its data budget.'); } chunks.push(part.value); }
  controller.signal.throwIfAborted(); const raw = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
  let data: LoopResult; try { data = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error('Routing service is unavailable. Start or configure the local API server.'); }
  if (data.requestId !== requestId || !['ok', 'unavailable', 'unroutable', 'shape-tolerance', 'cancelled', 'invalid-request'].includes(data.status)) throw new Error('Routing service returned an invalid or stale response.');
  if (data.status === 'ok' && (!response.ok || !Array.isArray(data.route?.points) || data.route.points.length < 4 || data.route.points.length > 20000 || data.route.points.some(p => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) || !Number.isFinite(data.route.lengthM) || data.route.lengthM <= 0 || distance(data.route.points[0], data.route.points.at(-1)!) > .1)) throw new Error('Routing service returned invalid geometry.');
  if (data.status === 'ok' && data.route.distanceNotice) { const notice = data.route.distanceNotice; if (!Number.isFinite(notice.targetM) || notice.targetM <= 0 || !Number.isFinite(notice.excessM) || notice.excessM <= 0 || ![.1, .2, .3].includes(notice.tolerance) || Math.abs(data.route.lengthM - notice.targetM - notice.excessM) > 1 || notice.excessM / notice.targetM <= notice.tolerance) throw new Error('Routing service returned an invalid larger-loop warning.'); }
  return data;
 } catch (error) { if (signal.aborted) throw signal.reason; if (controller.signal.aborted) throw new Error('Routing service took too long. Try later.'); throw error instanceof Error ? error : new Error('Routing service is unavailable.'); }
 finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
