import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { ProviderFailure } from '../src/loop/types';
export const GUARD_TABLE = 'great-circle-prod-routing-guard';
export const SEND_LEASE_MS = 20_000;
export type SendLease = { expiresAt: number };
export const HOUR = 3_600_000;
export type Counter = { revision: number; lastAt: number; minute: number[]; hours: [number, number][] };
export type StoredCounter = { counter: Counter; enabled?: boolean };
export type GuardStore = {
 read(id: string, signal: AbortSignal): Promise<StoredCounter | undefined>;
 compareAndSet(id: string, previous: StoredCounter | undefined, next: StoredCounter, signal: AbortSignal): Promise<boolean>;
};
export type RoutingGuard = { start(clientId: string, signal: AbortSignal): Promise<void>; reserve(signal: AbortSignal): Promise<SendLease> };
export const emptyCounter = (): Counter => ({ revision: 0, lastAt: 0, minute: [], hours: [] });
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
// Backwards clocks fail closed instead of discarding live reservations.
export function validCounter(value: unknown, now: number, minuteLimit: number, dayLimit: number, leaseMs = 0): value is Counter {
 if (!value || typeof value !== 'object') return false;
 const c = value as Counter;
 return integer(c.revision) && c.revision < Number.MAX_SAFE_INTEGER && integer(c.lastAt) && c.lastAt <= now &&
 Array.isArray(c.minute) && c.minute.length <= minuteLimit && c.minute.every((t, i) => integer(t) && t <= c.lastAt && (!i || t >= c.minute[i - 1])) &&
 Array.isArray(c.hours) && c.hours.length <= (leaseMs ? 26 : 25) && c.hours.every((b, i) => Array.isArray(b) && b.length === 2 && integer(b[0]) && b[0] <= Math.floor(c.lastAt / HOUR) && integer(b[1]) && b[1] > 0 && (!i || b[0] > c.hours[i - 1][0])) && c.hours.reduce((sum, b) => sum + b[1], 0) <= dayLimit &&
 c.minute.every(t => c.hours.some(([hour, count]) => hour === Math.floor(t / HOUR) && count >= c.minute.filter(other => Math.floor(other / HOUR) === hour).length));
}
export function advanceCounter(c: Counter, now: number, minuteLimit: number, dayLimit: number, leaseMs = 0): { counter?: Counter; retry: number; near?: boolean } {
 const hour = Math.floor(now / HOUR), minute = c.minute.filter(t => t > now - 60_000 - leaseMs), hours = c.hours.filter(([h]) => (h + 25) * HOUR + leaseMs > now).map(([h, n]): [number, number] => [h, n]);
 const used = hours.reduce((sum, [, n]) => sum + n, 0);
 if (minute.length >= minuteLimit) return { retry: Math.max(1, Math.ceil((minute[0] + 60_000 + leaseMs - now) / 1000)) };
 if (used >= dayLimit) return { retry: Math.max(1, Math.ceil(((hours[0][0] + 25) * HOUR + leaseMs - now) / 1000)) };
 minute.push(now); if (hours.at(-1)?.[0] === hour) hours[hours.length - 1][1]++; else hours.push([hour, 1]);
 return { counter: { revision: c.revision + 1, lastAt: now, minute, hours }, retry: 0, near: used + 1 >= dayLimit * .8 };
}
export function normalizeClientIp(ip: unknown): string | undefined {
 if (typeof ip !== 'string' || ip.includes('%') || !isIP(ip)) return undefined;
 if (isIP(ip) === 4) return ip;
 const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
 const sides = canonical.split('::'), left = sides[0] ? sides[0].split(':') : [], right = sides[1] ? sides[1].split(':') : [];
 const words = sides.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
 const n = words.map(w => parseInt(w, 16));
 if (n.slice(0, 5).every(v => v === 0) && n[5] === 65535) return `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
 return n.slice(0, 4).map(v => v.toString(16).padStart(4, '0')).join(':') + '::/64';
}
export function clientIdentity(ip: unknown, key: string): string | undefined {
 const normalized = normalizeClientIp(ip);
 return normalized ? createHmac('sha256', key).update('great-circle-routing-client-v1\0').update(normalized).digest('hex') : undefined;
}
export type GuardEvent = { event: 'routing_guard'; reason: 'near_budget' | 'budget_block' | 'guard_error' | 'disabled'; scope: 'global' | 'client' | 'store' };
export function createRoutingGuard(store: GuardStore, now = Date.now, log: (event: GuardEvent) => void = event => console.warn(event)): RoutingGuard {
 const logged = new Map<string, number>();
 function emit(reason: GuardEvent['reason'], scope: GuardEvent['scope']) { const key = reason + scope, at = now(); if (at - (logged.get(key) ?? -Infinity) >= 60_000) { logged.set(key, at); try { log({ event: 'routing_guard', reason, scope }); } catch { /* Logging cannot change admission. */ } } }
 async function take(id: string, signal: AbortSignal, checkOnly = false) {
  const global = id === 'control', minuteLimit = global ? 36 : 3, dayLimit = global ? 1800 : 60, scope = global ? 'global' : 'client';
  try {
   for (let attempt = 0; attempt < 4; attempt++) {
    signal.throwIfAborted();
    const previous = await store.read(id, signal), at = now(); signal.throwIfAborted();
    if (!integer(at) || (global && !previous) || (previous && !validCounter(previous.counter, at, minuteLimit, dayLimit, global ? SEND_LEASE_MS : 0)) || (global && typeof previous?.enabled !== 'boolean')) throw new Error('Invalid guard state');
    if (global && !previous!.enabled) { emit('disabled', scope); throw new ProviderFailure('unavailable', 'Routing is temporarily paused. Try later.', 60); }
    const decision = advanceCounter(previous?.counter ?? emptyCounter(), at, minuteLimit, dayLimit, global ? SEND_LEASE_MS : 0);
    if (!decision.counter) { emit('budget_block', scope); throw new ProviderFailure('unavailable', 'Routing request budget reached. Try later.', decision.retry); }
    if (checkOnly) return;
    const next = { counter: decision.counter, ...(global ? { enabled: true } : {}) };
    if (await store.compareAndSet(id, previous, next, signal)) { signal.throwIfAborted(); if (decision.near) emit('near_budget', scope); return { expiresAt: at + SEND_LEASE_MS }; }
   }
   throw new Error('Contention');
  } catch (error) {
   if (error instanceof ProviderFailure) throw error;
   emit('guard_error', 'store'); throw new ProviderFailure('unavailable', 'Routing protection is unavailable. Try later.', 30);
  }
 }
 return { start: (id, signal) => /^[a-f0-9]{64}$/.test(id) ? take('control', signal, true).then(() => take(`client:${id}`, signal)).then(() => {}) : Promise.reject(new ProviderFailure('unavailable', 'Routing protection is unavailable.', 30)), reserve: async signal => (await take('control', signal))! };
}
