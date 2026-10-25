import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { circleFixture } from './fixtures';
const { settings, data } = circleFixture();
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T12:00:00Z')); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('polite Overpass requests (mocked; no external network)', () => {
  it('uses the documented form encoding and a truthful CLI identity', async () => {
    const client = await import('../src/routing/overpass');
    const fetch = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal('fetch', fetch);
    await client.loadNetwork(settings, new AbortController().signal, { userAgent: client.CLIENT_USER_AGENT });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect(init.body.get('data')).toBe(client.queryFor(settings));
    expect(init.headers['User-Agent']).toBe(client.CLIENT_USER_AGENT);
    expect(client.CLIENT_USER_AGENT).toContain('https://github.com/rsteth/great_circle');
    expect(init.referrer).toBeUndefined();
  });
  it('lets the browser supply its real identity/referrer and reuses the area cache', async () => {
    const client = await import('../src/routing/overpass');
    const fetch = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal('fetch', fetch);
    const first = await client.loadNetwork(settings, new AbortController().signal);
    expect(first.cached).toBe(false);
    const second = await client.loadNetwork({ ...settings, targetKm: 8 }, new AbortController().signal);
    expect(second.cached).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    expect(fetch.mock.calls[0][1].referrer).toBeUndefined();
  });
  it('enforces a full 30-second pause after a 406 response without retrying', async () => {
    const client = await import('../src/routing/overpass');
    const fetch = vi.fn().mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 10000); return new Response('<h1>406 Not Acceptable</h1>', { status: 406 }); }).mockImplementation(() => Promise.resolve(Response.json(data))); vi.stubGlobal('fetch', fetch);
    await expect(client.loadNetwork(settings, new AbortController().signal)).rejects.toThrow('HTTP 406');
    await expect(client.loadNetwork(settings, new AbortController().signal)).rejects.toThrow('wait 30 seconds');
    vi.setSystemTime(Date.now() + 29000);
    await expect(client.loadNetwork(settings, new AbortController().signal)).rejects.toThrow('wait 1 seconds');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1000);
    await expect(client.loadNetwork(settings, new AbortController().signal)).resolves.toMatchObject({ cached: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a cancelled signal before requesting or returning cached data', async () => {
    const client = await import('../src/routing/overpass');
    const fetch = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal('fetch', fetch);
    const aborted = new AbortController(); aborted.abort();
    await expect(client.loadNetwork(settings, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    await client.loadNetwork(settings, new AbortController().signal);
    await expect(client.loadNetwork(settings, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('propagates mid-download cancellation without retrying', async () => {
    const client = await import('../src/routing/overpass');
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }); })); vi.stubGlobal('fetch', fetch);
    const pending = client.loadNetwork(settings, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('honors a longer Retry-After response instead of issuing an automatic retry', async () => {
    const client = await import('../src/routing/overpass');
    const fetch = vi.fn().mockResolvedValue(new Response('busy', { status: 429, headers: { 'Retry-After': '120' } })); vi.stubGlobal('fetch', fetch);
    await expect(client.loadNetwork(settings, new AbortController().signal)).rejects.toThrow('rate-limited');
    vi.setSystemTime(Date.now() + 30000);
    await expect(client.loadNetwork(settings, new AbortController().signal)).rejects.toThrow('wait 90 seconds');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
