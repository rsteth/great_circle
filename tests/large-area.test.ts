import { afterEach, expect, it, vi } from 'vitest';
import { changeCircle } from '../src/circle';
import { validateSettings } from '../src/routing/solve';
import { coverageCost, initialCoverage, type Corridor } from '../src/routing/coverage';
import { loadNetwork, queryFor } from '../src/routing/overpass';
import { circleFixture } from './fixtures';
afterEach(() => vi.unstubAllGlobals());
it('caps planning at 10 km radius and replaces the old disk guard with bounded corridor cost', () => {
  const selected=changeCircle(circleFixture().settings,{radiusM:10000});validateSettings(selected);
  expect(selected.circleRadiusM).toBe(10000);expect(selected.targetKm).toBeCloseTo(62.8318530718);
  const coverage=initialCoverage(selected);expect(coverage.kind).toBe('corridor');expect(coverageCost(coverage).areaM2).toBeLessThan(110000000);expect(queryFor(selected)).toContain('around:775,');
  expect(()=>queryFor(selected,{kind:'disk',center:selected.center,radiusM:selected.radiusM+50})).toThrow('6 km');
});
it('rejects excessive corridor width/config before any live request', async () => {
  const selected=changeCircle(circleFixture().settings,{radiusM:10000}),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(loadNetwork({...selected,circleRadiusM:10001},new AbortController().signal)).rejects.toThrow();
  await expect(loadNetwork(selected,new AbortController().signal,undefined,{coverage:{...initialCoverage(selected) as Corridor,halfWidthM:5000}})).rejects.toThrow('budget');expect(fetch).not.toHaveBeenCalled();
});
