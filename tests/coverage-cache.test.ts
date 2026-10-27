import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { circleFixture } from './fixtures';
import { offset } from '../src/routing/geo';
const { data, settings } = circleFixture();
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('complete bounded raw OSM coverage cache', () => {
  it('reuses containing coverage without trimming geometry/restrictions or issuing a request', async () => {
    const client = await import('../src/routing/overpass');
    const expanded = { ...data, elements: [...data.elements, { type: 'relation', id: 2000, tags: { type: 'restriction', restriction: 'no_left_turn' }, members: [] }] };
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(expanded))); vi.stubGlobal('fetch', fetch);
    const first = await client.loadNetwork(settings, new AbortController().signal);
    const smaller = { ...settings, center: offset(settings.center, 200, 0), radiusM: 1500 };
    const next = await client.loadNetwork(smaller, new AbortController().signal);
    expect(next.cached).toBe(true); expect(next.datasetId).toBe(first.datasetId); expect(next.data).toBe(first.data);
    expect(next.data.elements).toEqual(expanded.elements); expect(next.timing).toMatchObject({ cacheHit: true, bytes: 0, fetchMs: 0, parseMs: 0 }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects partial/tangent coverage and larger areas without bypassing cooldown', async () => {
    const client = await import('../src/routing/overpass'); const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(data))); vi.stubGlobal('fetch', fetch);
    await client.loadNetwork(settings, new AbortController().signal);
    for (const changed of [{ ...settings, radiusM: 2600 }, { ...settings, center: offset(settings.center, 1001, 0), radiusM: 1500 }]) await expect(client.loadNetwork(changed, new AbortController().signal)).rejects.toThrow('wait');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains three areas, evicts least recently used, and expires original fetch age', async () => {
    const client = await import('../src/routing/overpass'); const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(data))); vi.stubGlobal('fetch', fetch);
    const shifted = (i: number) => ({ ...settings, center: offset(settings.center, i * 10000, 0), start: offset(settings.start, i * 10000, 0) });
    const first = await client.loadNetwork(shifted(0), new AbortController().signal);
    for (const i of [1,2]) { vi.advanceTimersByTime(31000); await client.loadNetwork(shifted(i), new AbortController().signal); }
    expect((await client.loadNetwork(shifted(0), new AbortController().signal)).datasetId).toBe(first.datasetId);
    vi.advanceTimersByTime(31000); await client.loadNetwork(shifted(3), new AbortController().signal);
    expect((await client.loadNetwork(shifted(0), new AbortController().signal)).cached).toBe(true);
    await expect(client.loadNetwork(shifted(1), new AbortController().signal)).rejects.toThrow('wait');
    vi.advanceTimersByTime(900001); expect((await client.loadNetwork(shifted(0), new AbortController().signal)).cached).toBe(false); expect(fetch).toHaveBeenCalledTimes(5);
  });
});
