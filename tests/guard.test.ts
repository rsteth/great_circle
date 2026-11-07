import { describe, expect, it, vi } from 'vitest';
import { advanceCounter, clientIdentity, createRoutingGuard, emptyCounter, HOUR, normalizeClientIp, validCounter, type GuardStore, type StoredCounter } from '../server/guard';
import { createDynamoGuardStore } from '../server/guard-store';
import { createLambdaHandler, ALLOWED_ORIGIN, type FunctionUrlEvent } from '../server/lambda';
import { exampleSettings } from '../src/selection';
const signal = () => new AbortController().signal;
const id = 'a'.repeat(64);
function memory() {
 const rows = new Map<string, StoredCounter>([['control', { enabled: true, counter: emptyCounter() }]]);
 const store: GuardStore = {
  async read(key) { return structuredClone(rows.get(key)); },
  async compareAndSet(key, previous, next) {
   const actual = rows.get(key);
   if (actual?.counter.revision !== previous?.counter.revision || (key === 'control' && !actual?.enabled)) return false;
   rows.set(key, structuredClone(next)); return true;
  }
 };
 return { rows, store };
}
it('normalizes IPv6 /64 and mapped IPv4 without trusting malformed addresses', () => {
 expect(normalizeClientIp('2001:db8:0:1::abcd')).toBe('2001:0db8:0000:0001::/64');
 expect(clientIdentity('2001:db8:0:1::abcd', 'fake')).toBe(clientIdentity('2001:0db8:0000:0001::2', 'fake'));
 expect(clientIdentity('::ffff:192.0.2.1', 'fake')).toBe(clientIdentity('192.0.2.1', 'fake'));
 expect(clientIdentity('192.0.2.1', 'fake')).not.toBe(clientIdentity('192.0.2.1', 'other'));
 for (const value of [undefined, '', 'unknown', '127.0.0.1:80', '010.0.0.1', 'fe80::1%en0', '1.2.3.4, 5.6.7.8']) expect(normalizeClientIp(value)).toBeUndefined();
});
it('uses exact sliding minute boundary and conservative 24–25 hour budget, not UTC midnight', () => {
 let c = emptyCounter();
 for (let i = 0; i < 3; i++) c = advanceCounter(c, HOUR - 10, 3, 60).counter!;
 expect(advanceCounter(c, HOUR + 59_989, 3, 60).counter).toBeUndefined();
 expect(advanceCounter(c, HOUR + 59_990, 3, 60).counter).toBeDefined();
 c = { revision: 60, lastAt: HOUR - 10, minute: [], hours: [[0, 60]] };
 expect(advanceCounter(c, 24 * HOUR + 1, 3, 60).counter).toBeUndefined();
 expect(advanceCounter(c, 25 * HOUR, 3, 60).counter?.hours).toEqual([[25, 1]]);
 expect(validCounter(c, HOUR - 11, 3, 60)).toBe(false);
});
it('enforces client3/minute and60/rolling-day; global36/minute and1800/rolling-day', async () => {
 const { store, rows } = memory(); let now = 30 * HOUR; const guard = createRoutingGuard(store, () => now, () => {});
 for (let i = 0; i < 3; i++) await guard.start(id, signal());
 await expect(guard.start(id, signal())).rejects.toThrow('budget');
 for (let i = 0; i < 36; i++) await guard.reserve(signal());
 await expect(guard.reserve(signal())).rejects.toThrow('budget');
 now += 80_000; await guard.reserve(signal());
 rows.set('control', { enabled: true, counter: { revision: 1800, lastAt: now, minute: [], hours: [[30, 1800]] } });
 await expect(guard.reserve(signal())).rejects.toThrow('budget');
 rows.set(`client:${id}`, { counter: { revision: 60, lastAt: now, minute: [], hours: [[30, 60]] } });
 await expect(guard.start(id, signal())).rejects.toThrow('budget');
});
it('concurrent independent workers never over-reserve; bounded conflict retries fail closed', async () => {
 const { rows, store } = memory(); const workers = Array.from({ length: 80 }, () => createRoutingGuard(store, () => 100_000, () => {}));
 const settled = await Promise.allSettled(workers.map(g => g.reserve(signal())));
 const allowed = settled.filter(r => r.status === 'fulfilled').length;
 expect(allowed).toBeGreaterThan(0); expect(allowed).toBeLessThanOrEqual(36);
 expect(rows.get('control')!.counter.minute).toHaveLength(allowed);
 const cas = vi.fn(async () => false), guard = createRoutingGuard({ ...store, compareAndSet: cas }, () => 100_000, () => {});
 await expect(guard.reserve(signal())).rejects.toThrow('protection'); expect(cas).toHaveBeenCalledTimes(4);
});
it('a disable racing a stale reservation wins, and enabled state is never recreated', async () => {
 const { store, rows } = memory(); const compare = store.compareAndSet;
 store.compareAndSet = async (...args) => { const old = rows.get('control')!; rows.set('control', { enabled: false, counter: { ...old.counter, revision: old.counter.revision + 1 } }); return compare(...args); };
 await expect(createRoutingGuard(store, () => 100_000, () => {}).reserve(signal())).rejects.toThrow('paused');
 expect(rows.get('control')!.enabled).toBe(false); expect(rows.get('control')!.counter.minute).toHaveLength(0);
 rows.delete('control'); await expect(createRoutingGuard(store, () => 100_000, () => {}).reserve(signal())).rejects.toThrow('protection');
});
it('fails closed on malformed, missing, future, excessive, unordered state and store errors', async () => {
 const invalid = [undefined, { enabled: true, counter: {} }, { enabled: 'true', counter: emptyCounter() }, { enabled: true, counter: { ...emptyCounter(), revision: -1 } }, { enabled: true, counter: { ...emptyCounter(), lastAt: 100_001 } }, { enabled: true, counter: { ...emptyCounter(), lastAt: 100_000, minute: [10, 9] } }, { enabled: true, counter: { ...emptyCounter(), hours: [[0, 1801]] } }];
 for (const value of invalid) {
  const cas = vi.fn(); const store = { read: async () => value, compareAndSet: cas } as unknown as GuardStore;
  await expect(createRoutingGuard(store, () => 100_000, () => {}).reserve(signal())).rejects.toThrow('protection'); expect(cas).not.toHaveBeenCalled();
 }
 const store: GuardStore = { read: async () => { throw new Error('SECRET AWS DETAIL'); }, compareAndSet: vi.fn() };
 const log = vi.fn(), guard = createRoutingGuard(store, () => 100_000, log);
 for (let i = 0; i < 10; i++) await expect(guard.reserve(signal())).rejects.toThrow('protection');
 expect(log).toHaveBeenCalledTimes(1); expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET');
});
it('near budget logging is low cardinality and >=80%, distinguishing global/client/store', async () => {
 const { store, rows } = memory(); rows.set('control', { enabled: true, counter: { revision: 1439, lastAt: 100_000, minute: [], hours: [[0, 1439]] } });
 const log = vi.fn(), guard = createRoutingGuard(store, () => 100_000, log); await guard.reserve(signal()); await guard.reserve(signal());
 expect(log.mock.calls).toEqual([[{ event: 'routing_guard', reason: 'near_budget', scope: 'global' }]]);
});
describe('DynamoDB adapter (mocked, no AWS)', () => {
 it('strong reads, fixed table, CAS revision+enabled, client TTL only, single revision source', async () => {
  const send = vi.fn().mockResolvedValue({ Item: { state: { S: JSON.stringify({ lastAt: 0, minute: [], hours: [] }) }, revision: { N: '0' }, enabled: { BOOL: true } } });
  const store = createDynamoGuardStore({ send } as never), before = await store.read('control', signal());
  expect(send.mock.calls[0][0].input).toMatchObject({ TableName: 'great-circle-prod-routing-guard', ConsistentRead: true });
  const next = { enabled: true, counter: advanceCounter(before!.counter, 100_000, 36, 1800).counter! };
  await store.compareAndSet('control', before, next, signal());
  const put = send.mock.calls[1][0].input; expect(put.ConditionExpression).toBe('#revision = :revision AND #enabled = :enabled'); expect(put.Item.expiresAt).toBeUndefined(); expect(JSON.parse(put.Item.state.S).revision).toBeUndefined();
  await store.compareAndSet(`client:${id}`, undefined, next, signal()); expect(send.mock.calls[2][0].input.Item.expiresAt.N).toBe('93700');
 });
 it('retries only known conditional failures; unknown writes/errors fail closed', async () => {
  const send = vi.fn().mockRejectedValue(Object.assign(new Error('private'), { name: 'ConditionalCheckFailedException' })), store = createDynamoGuardStore({ send } as never);
  expect(await store.compareAndSet('client:x', undefined, { counter: emptyCounter() }, signal())).toBe(false);
  send.mockRejectedValue(new Error('timeout')); await expect(store.compareAndSet('client:x', undefined, { counter: emptyCounter() }, signal())).rejects.toThrow('timeout');
 });
});
const event = (): FunctionUrlEvent => ({ version: '2.0', rawPath: '/api/loop', headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' }, requestContext: { http: { method: 'POST', sourceIp: '192.0.2.1' } }, body: JSON.stringify({ requestId: 'guard-test', settings: exampleSettings() }) });
it('unknown sourceIp ignores forwarded headers and never loads secret or guard', async () => {
 const start = vi.fn(), reserve = vi.fn(), loadSecret = vi.fn(), handler = createLambdaHandler({ guard: { start, reserve }, loadSecret }); const input = event(); delete input.requestContext!.http!.sourceIp; input.headers!['x-forwarded-for'] = '192.0.2.1';
 expect((await handler(input, { getRemainingTimeInMillis: () => 30000 })).statusCode).toBe(503); expect(loadSecret).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
});
it('client/global denial prevents upstream send and leaks no key/IP/identifier', async () => {
 for (const rejectStart of [true, false]) {
  const client = vi.fn(), log = vi.fn(), { store } = memory(); const realGuard = createRoutingGuard({ ...store, read: async () => { throw new Error('SECRET'); } }, Date.now, log);
  const guard = rejectStart ? realGuard : { start: async () => {}, reserve: realGuard.reserve };
  const handler = createLambdaHandler({ loadSecret: async () => 'SECRET', guard, client }); const result = await handler(event(), { getRemainingTimeInMillis: () => 30000 });
  expect(result.statusCode).toBe(503); expect(client).not.toHaveBeenCalled(); expect(result.body + JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|192\.0\.2\.1|client:/); expect(JSON.parse(result.body).providerRequests).toBe(0);
 }
});
it('global precheck denies before a client record write', async () => {
 const { rows, store } = memory(); rows.get('control')!.enabled = false; const cas = vi.fn(store.compareAndSet);
 const guard = createRoutingGuard({ ...store, compareAndSet: cas }, () => 100_000, () => {});
 await expect(guard.start(id, signal())).rejects.toThrow('paused'); expect(cas).not.toHaveBeenCalled(); expect(rows.size).toBe(1);
});
it('abort after an acquired reservation never refunds it or sends upstream', async () => {
 const { store, rows } = memory(), controller = new AbortController(), cas = store.compareAndSet;
 store.compareAndSet = async (...args) => { const result = await cas(...args); controller.abort(); return result; };
 await expect(createRoutingGuard(store, () => 100_000, () => {}).reserve(controller.signal)).rejects.toThrow('protection');
 expect(rows.get('control')!.counter.minute).toHaveLength(1);
});
it('rejects inconsistent counters and malformed DynamoDB encoding without a write', async () => {
 expect(validCounter({ ...emptyCounter(), lastAt: 100, minute: [100] }, 100, 36, 1800)).toBe(false);
 for (const Item of [
  { state: { S: '{bad' }, revision: { N: '0' }, enabled: { BOOL: true } },
  { state: { S: '{"revision":0}' }, revision: { N: '0' }, enabled: { BOOL: true } },
  { state: { S: '{}' }, revision: { N: 'NaN' }, enabled: { BOOL: true } },
  { state: { S: '{}' }, revision: { N: '0' }, enabled: { BOOL: true }, expiresAt: { N: '100' } }
 ]) {
  const send = vi.fn().mockResolvedValue({ Item });
  await expect(createDynamoGuardStore({ send } as never).read('control', signal())).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
 }
});
it('SDK timeout/throttle/unknown write outcome is not retried or refunded', async () => {
 const { store, rows } = memory(); const cas = vi.fn(async (...args: Parameters<GuardStore['compareAndSet']>) => { await store.compareAndSet(...args); throw Object.assign(new Error('private upstream details'), { name: 'TimeoutError' }); });
 const guard = createRoutingGuard({ ...store, compareAndSet: cas }, () => 100_000, () => {});
 await expect(guard.reserve(signal())).rejects.toThrow('protection'); expect(cas).toHaveBeenCalledTimes(1); expect(rows.get('control')!.counter.minute).toHaveLength(1);
 const send = vi.fn().mockRejectedValue(Object.assign(new Error('private'), { name: 'ProvisionedThroughputExceededException' }));
 await expect(createRoutingGuard(createDynamoGuardStore({ send } as never), () => 100_000, () => {}).reserve(signal())).rejects.toThrow('protection'); expect(send).toHaveBeenCalledTimes(1);
 expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
});
it('delayed CAS reservations retain 80 seconds and carry a recorded-time send lease', async () => {
 const { store, rows } = memory(); let now = 0; const cas = store.compareAndSet;
 store.compareAndSet = async (...args) => { now += 1000; return cas(...args); };
 const guard = createRoutingGuard(store, () => now, () => {});
 for (let i = 0; i < 36; i++) { now = 0; expect(await guard.reserve(signal())).toEqual({ expiresAt: 20_000 }); }
 expect(rows.get('control')!.counter.minute).toEqual(Array(36).fill(0));
 now = 60_000; await expect(guard.reserve(signal())).rejects.toThrow('budget');
 now = 79_999; await expect(guard.reserve(signal())).rejects.toThrow('budget');
 now = 80_000; expect(await guard.reserve(signal())).toEqual({ expiresAt: 100_000 });
});
it('hour bins include the send lease at expiry, including 26 bins in the first 20 seconds', () => {
 const c = { revision: 1800, lastAt: HOUR - 1, minute: [], hours: [[0, 1800]] as [number, number][] };
 expect(advanceCounter(c, 25 * HOUR + 19_999, 36, 1800, 20_000).counter).toBeUndefined();
 expect(advanceCounter(c, 25 * HOUR + 20_000, 36, 1800, 20_000).counter?.hours).toEqual([[25, 1]]);
 const bins = { revision: 26, lastAt: 25 * HOUR + 10, minute: [25 * HOUR + 10], hours: Array.from({ length: 26 }, (_, h): [number, number] => [h, 1]) };
 expect(validCounter(bins, bins.lastAt, 36, 1800, 20_000)).toBe(true);
 expect(advanceCounter(bins, bins.lastAt, 36, 1800, 20_000).counter!.hours).toHaveLength(26);
 expect(advanceCounter(bins, 25 * HOUR + 20_000, 36, 1800, 20_000).counter!.hours).toHaveLength(25);
});
it('disable then re-enable cannot accept an old revision or reset charged counters', async () => {
 const { rows, store } = memory(); const old = await store.read('control', signal());
 rows.set('control', { enabled: false, counter: { ...old!.counter, revision: 1 } });
 rows.set('control', { enabled: true, counter: { ...old!.counter, revision: 2 } });
 const stale = { enabled: true, counter: advanceCounter(old!.counter, 100_000, 36, 1800, 20_000).counter! };
 expect(await store.compareAndSet('control', old, stale, signal())).toBe(false);
 await createRoutingGuard(store, () => 100_000, () => {}).reserve(signal());
 expect(rows.get('control')!.counter.revision).toBe(3); expect(rows.get('control')!.counter.minute).toHaveLength(1);
});
it('independent concurrent workers admit at most three generations for one client', async () => {
 const { rows, store } = memory(); const workers = Array.from({ length: 40 }, () => createRoutingGuard(store, () => 100_000, () => {}));
 const results = await Promise.allSettled(workers.map(g => g.start(id, signal())));
 expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3); expect(rows.get(`client:${id}`)!.counter.minute).toHaveLength(3); expect(rows.get('control')!.counter.minute).toHaveLength(0);
});
it('elapsed wall-clock deadline after admission denies without waiting for an abort timer', async () => {
 vi.useFakeTimers(); vi.setSystemTime(100_000);
 try {
  const client = vi.fn(), reserve = vi.fn(async () => ({ expiresAt: Date.now() + 20_000 }));
  const handler = createLambdaHandler({ loadSecret: async () => 'fake-only', client, guard: { start: async () => { vi.setSystemTime(120_000); }, reserve } });
  const result = await handler(event(), { getRemainingTimeInMillis: () => 30000 });
  expect(result.statusCode).toBe(503); expect(result.body).toContain('time budget'); expect(client).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
 } finally { vi.useRealTimers(); }
});
it('aggregate deadline still blocks a later guard lease before actual fetch', async () => {
 vi.useFakeTimers(); vi.setSystemTime(100_000);
 try {
  const client = vi.fn(), handler = createLambdaHandler({ loadSecret: async () => 'fake-only', client, guard: { start: async () => {}, reserve: async () => { vi.setSystemTime(120_000); return { expiresAt: 140_000 }; } } });
  const result = await handler(event(), { getRemainingTimeInMillis: () => 30000 });
  expect(result.statusCode).toBe(503); expect(client).not.toHaveBeenCalled(); expect(JSON.parse(result.body).providerRequests).toBe(0);
 } finally { vi.useRealTimers(); }
});
it('a CAS crossing an hour boundary cannot release charged global daily usage early', async () => {
 const { store, rows } = memory(); let now = HOUR - 1;
 rows.set('control', { enabled: true, counter: { revision: 1799, lastAt: 0, minute: [], hours: [[0, 1799]] } });
 const cas = store.compareAndSet; store.compareAndSet = async (...args) => { now += 1000; return cas(...args); };
 const guard = createRoutingGuard(store, () => now, () => {});
 expect(await guard.reserve(signal())).toEqual({ expiresAt: HOUR + 19_999 });
 expect(rows.get('control')!.counter.hours).toEqual([[0, 1800]]);
 now = 25 * HOUR + 19_999; await expect(guard.reserve(signal())).rejects.toThrow('budget');
 now = 25 * HOUR + 20_000; await expect(guard.reserve(signal())).resolves.toEqual({ expiresAt: 25 * HOUR + 40_000 });
});
