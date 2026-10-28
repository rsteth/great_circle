import { afterEach, expect, it, vi } from 'vitest';
import { changeCircle } from '../src/circle';
import { validateSettings } from '../src/routing/solve';
import { loadNetwork, queryFor } from '../src/routing/overpass';
import { circleFixture } from './fixtures';
afterEach(() => vi.unstubAllGlobals());
it('accepts 100 km planning geometry but never issues an oversized shared-service query', async () => {
  const large = changeCircle(circleFixture().settings, { radiusM: 100000 });
  expect(() => validateSettings(large)).not.toThrow(); expect(() => queryFor(large)).toThrow('too large for the shared map service');
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(loadNetwork(large, new AbortController().signal)).rejects.toThrow('4.5 km'); expect(fetch).not.toHaveBeenCalled();
});

it('preserves the previous 4.5 km circle download limit', () => {
  const largest = changeCircle(circleFixture().settings, { radiusM: 4500 });
  expect(largest.radiusM).toBe(6000); expect(() => queryFor(largest)).not.toThrow();
  expect(() => queryFor(changeCircle(largest, { radiusM: 4501 }))).toThrow('too large');
});
