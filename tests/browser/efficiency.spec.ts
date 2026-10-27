import { test, expect, type Page } from '@playwright/test';
import { circleFixture } from '../fixtures';
const endpoint = '**/overpass-api.de/api/interpreter';
const size = (page: Page) => page.getByRole('slider', { name: 'Circle radius', exact: true });
async function setRadius(page: Page, radius: number) { await size(page).press('Home'); for (let r = 500; r < radius; r += 50) await size(page).press('ArrowUp'); }
async function generate(page: Page) { await page.getByRole('button', { name: 'Generate loop', exact: true }).click(); await expect(page.getByText('Loop found.', { exact: true })).toBeVisible(); }
async function timing(page: Page) { return page.evaluate(() => (performance.getEntriesByName('great-circle-generation').at(-1) as PerformanceMeasure).detail); }
async function observeWorkers(page: Page, delay = 0, failFirst = false) {
  await page.addInitScript(({ delay, failFirst }) => {
    const RealWorker = window.Worker;
    const stats = { created: 0, terminated: 0, sends: [] as { id: number; dataset: boolean }[] };
    (window as unknown as { workerStats: typeof stats }).workerStats = stats;
    class ObservedWorker {
      inner: Worker;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      constructor(url: string | URL, options?: WorkerOptions) {
        stats.created++; this.inner = new RealWorker(url, options);
        this.inner.onmessage = event => setTimeout(() => this.onmessage?.(event), delay);
        this.inner.onerror = event => this.onerror?.(event);
      }
      postMessage(message: { id: number; data?: unknown }) {
        stats.sends.push({ id: message.id, dataset: !!message.data });
        if (failFirst && stats.sends.length === 1) setTimeout(() => this.onerror?.(new ErrorEvent('error')), 20);
        else this.inner.postMessage(message);
      }
      terminate() { stats.terminated++; this.inner.terminate(); }
    }
    Object.defineProperty(window, 'Worker', { value: ObservedWorker });
  }, { delay, failFirst });
}
const stats = (page: Page) => page.evaluate(() => (window as unknown as { workerStats: { created: number; terminated: number; sends: { id: number; dataset: boolean }[] } }).workerStats);
test.beforeEach(async ({ page }) => {
  await page.route('**/tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><text x="8" y="20">Offline map fixture</text></svg>' }));
});

test('warm generations reuse worker/dataset/graph; contained bounds reclip without re-fetching', async ({ page }) => {
  await observeWorkers(page); let requests = 0;
  await page.route(endpoint, route => { requests++; return route.fulfill({ json: circleFixture(64, 850).data }); });
  await page.goto('/'); await setRadius(page, 1000); await page.getByRole('slider', { name: 'Route variation', exact: true }).fill('0.3');
  await generate(page); expect((await timing(page)).worker.graphCached).toBe(false);
  await page.getByRole('slider', { name: 'Start angle', exact: true }).press('ArrowRight'); await generate(page);
  const warm = await timing(page); expect(warm.worker.graphCached).toBe(true); expect(warm.network).toMatchObject({ cacheHit: true, bytes: 0 });
  await setRadius(page, 850); await generate(page); const smaller = await timing(page);
  expect(smaller.network.cacheHit).toBe(true); expect(smaller.worker.graphCached).toBe(false); expect(requests).toBe(1);
  const observed = await stats(page); expect(observed.created).toBe(1); expect(observed.terminated).toBe(0); expect(observed.sends.map(send => send.dataset)).toEqual([true, false, false]);
  expect(await page.evaluate(() => performance.getEntriesByName('great-circle-generation').length)).toBe(1);
});

test('cancel terminates retained worker, rejects delayed replies and resends data to replacement', async ({ page }) => {
  await observeWorkers(page, 250); let requests = 0;
  await page.route(endpoint, route => { requests++; return route.fulfill({ json: circleFixture(64, 850).data }); });
  await page.goto('/'); await setRadius(page, 850);
  await page.getByRole('button', { name: 'Generate loop', exact: true }).click();
  await expect.poll(async () => (await stats(page)).sends.length).toBe(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('status', { name: 'Route status' })).toContainText('Cancelled.');
  await generate(page); await page.waitForTimeout(300); await expect(page.getByRole('status', { name: 'Route status' })).toContainText('Loop found.');
  const observed = await stats(page); expect(observed.created).toBe(2); expect(observed.terminated).toBe(1); expect(observed.sends.map(send => send.dataset)).toEqual([true, true]); expect(requests).toBe(1);
  expect((await timing(page)).worker.graphCached).toBe(false);
});

test('worker failure resets dataset ownership and cached map can recover on a fresh worker', async ({ page }) => {
  await observeWorkers(page, 0, true); let requests = 0;
  await page.route(endpoint, route => { requests++; return route.fulfill({ json: circleFixture(64, 850).data }); });
  await page.goto('/'); await setRadius(page, 850); await page.getByRole('button', { name: 'Generate loop', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Search stopped.'); await generate(page);
  const observed = await stats(page); expect(observed.created).toBe(2); expect(observed.terminated).toBe(1); expect(observed.sends.map(send => send.dataset)).toEqual([true, true]); expect(requests).toBe(1);
});
