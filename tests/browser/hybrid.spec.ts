import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { changeCircle } from '../../src/circle';
import { SELECTION_KEY } from '../../src/selection';
import { initialCoverage } from '../../src/routing/coverage';
import { circleFixture } from '../fixtures';
import { denseGrid, selectCompleteWays } from '../corridor-fixtures';
import type { OsmData } from '../../src/routing/types';
test.use({ storageState: { cookies: [], origins: [] } });
const ring = circleFixture(), selected = changeCircle(ring.settings, { radiusM: 1000, bearing: 90 }), coverage = initialCoverage(selected);
const fixtures: Record<string, OsmData> = {
 fast: ring.data,
 fallback: selectCompleteWays(denseGrid(), coverage),
 failure: { elements: [...ring.data.elements.map(element => element.type === 'way' ? { ...element, tags: { ...element.tags, oneway: 'yes' } } : element), { type: 'relation', id: 9000, tags: { type: 'restriction', 'restriction:bicycle': 'no_straight_on' }, members: [{ type: 'way', role: 'from', ref: 1000 }, { type: 'node', role: 'via', ref: 1 }, { type: 'way', role: 'to', ref: 1000 }] }] },
};
for (const kind of ['fast', 'fallback', 'failure']) test(`default hybrid Generate ${kind}, one mocked road request, honest result and stages`, async ({ page }, info) => {
 await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })), { key: SELECTION_KEY, settings: selected });
 await page.addInitScript(`(() => { window.__routeMessages = []; const Original = window.Worker; window.Worker = class extends Original { constructor(...args) { super(...args); this.addEventListener('message', event => window.__routeMessages.push(event.data)); } }; })();`);
 let requests = 0;
 await page.route('**/*', route => {
  const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1') return route.continue();
  if (url.hostname === 'overpass-api.de') { expect(++requests).toBe(1); return route.fulfill({ json: fixtures[kind] }); }
  return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#aaa"/><text x="8" y="20">Offline hybrid test</text></svg>' });
 });
 await page.goto('/'); await page.getByRole('button', { name: 'Generate loop', exact: true }).click();
 await expect(page.getByRole('status', { name: 'Route status' })).toHaveText(kind === 'failure' ? 'No loop found.' : 'Loop found.');
 expect(requests).toBe(1);
 const messages = await page.evaluate(() => (window as unknown as { __routeMessages: { type: string; message?: string }[] }).__routeMessages);
 expect(messages.some(message => message.message === 'Finding a loop…')).toBe(true);
 expect(messages.some(message => message.message === 'Trying a more flexible loop on the same roads…')).toBe(kind !== 'fast');
 const metric = await page.evaluate(() => (performance.getEntriesByName('great-circle-generation').at(-1) as PerformanceMeasure).detail);
 expect(metric.requests).toBe(1); expect(metric.searchWork.expansions).toBeLessThanOrEqual(1800000); expect(metric.searchWork.localElapsedMs).toBeLessThan(14000);
 expect(metric.searchAttempts[0].stages.map((stage: { strategy: string }) => stage.strategy)).toEqual(kind === 'fast' ? ['nearest'] : ['nearest', 'joint']);
 if (kind === 'failure') {
  await expect(page.getByRole('alert')).toContainText('No sufficiently circular'); await expect(page.getByRole('button', { name: 'Download GPX', exact: true })).toHaveCount(0);
 } else {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download GPX', exact: true }).click(); const path = await (await pending).path();
  const points = [...readFileSync(path!, 'utf8').matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map(match => match.slice(1)); expect(points[0]).toEqual(points.at(-1)); expect(points).toHaveLength(kind === 'fast' ? 65 : 27);
 }
 await page.screenshot({ path: `/tmp/great-circle-hybrid-${kind}-${info.project.name}.png`, fullPage: info.project.name === 'desktop' });
});
for (const cancelStage of ['nearest', 'joint']) test(`actual worker cancel during ${cancelStage}, then supersede with a different pinned Start`, async ({ page }) => {
 await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>' }));
 await page.goto('/');
 const result = await page.evaluate(async ({ data, settings, coverage, ringData, recoverySettings, cancelStage }) => {
  const modulePath = '/src/routing/searchClient.ts', { SearchClient } = await import(modulePath);
  const client = new SearchClient(), controller = new AbortController(), progress: string[] = [];
  const network = { data, sourceCoverage: coverage, coverage, datasetId: 'grid', cached: false, timing: { fetchMs: 0, parseMs: 0, bytes: 0, cacheHit: false, elements: 0, queryAreaM2: 0, queryVertices: 0 } };
  let outcome = '', cancelled = false;
  try {
   await client.search(network, settings, controller.signal, (message: string) => { progress.push(message); if (message === (cancelStage === 'nearest' ? 'Finding a loop…' : 'Trying a more flexible loop on the same roads…')) { cancelled = true; controller.abort(); } }); outcome = 'unexpected result';
  } catch (error) { outcome = (error as Error).name; }
  const atCancel = progress.length;
  const current = await client.search({ ...network, data: ringData, datasetId: 'ring' }, recoverySettings, new AbortController().signal, () => {});
  await new Promise(resolve => setTimeout(resolve, 20)); client.cancel();
  return { cancelled, outcome, oldProgressAfterCancel: progress.length - atCancel, first: current.route.points[0], last: current.route.points.at(-1), startNodeId: current.route.startNodeId, stages: current.timing.stages.map((stage: { strategy: string }) => stage.strategy) };
 }, { data: fixtures.fallback, settings: selected, coverage, ringData: fixtures.fast, recoverySettings: changeCircle(selected, { bearing: 270 }), cancelStage });
 expect(result.cancelled).toBe(true); expect(result.outcome).toBe('AbortError'); expect(result.oldProgressAfterCancel).toBe(0); expect(result.startNodeId).toBe(33); expect(result.first).toEqual(result.last); expect(result.stages).toEqual(['nearest']);
});
