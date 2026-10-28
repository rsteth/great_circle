import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
test.use({ storageState: { cookies: [], origins: [] } });
for (const search of ['nearest', 'joint']) test(`independent ${search}/small-disk arm uses one request and exports closed GPX`, async ({ page }, info) => {
  const data = JSON.parse(gunzipSync(readFileSync(new URL('../data/vancouver-west-end-2026-10-25.osm.json.gz', import.meta.url))).toString());
  let requests = 0;
  // All non-local traffic is intercepted; no live provider, location or tile use.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'overpass-api.de') {
      requests++; expect(requests).toBe(1); expect(new URLSearchParams(route.request().postData()!).get('data')).toContain('way(around:1050,49.289000,-123.128000)');
      return route.fulfill({ json: data });
    }
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#aaa"/><text x="5" y="20">Offline strategy replay</text></svg>' });
  });
  await page.goto(`/?routeSearch=${search}&roadCoverage=hybrid-small`);
  await page.getByRole('button', { name: 'Generate loop', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Route status' })).toHaveText('Loop found.');
  expect(requests).toBe(1);
  const metric = await page.evaluate(() => performance.getEntriesByName('great-circle-generation').map(entry => (entry as PerformanceMeasure).detail).at(-1));
  expect(metric.searchStrategy).toBe(search); expect(metric.coverage).toBe('disk'); expect(metric.requests).toBe(1);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download GPX', exact: true }).click();
  const xml = readFileSync((await (await pending).path())!, 'utf8'), points = [...xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map(match => match.slice(1));
  expect(points.length).toBeGreaterThan(100); expect(points[0]).toEqual(points.at(-1));
  await page.getByText('Route details', { exact: true }).click(); await expect(page.getByText('The circle is a guide.', { exact: false })).toBeVisible();
  await expect(page.getByText('Distance from center:', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/great-circle-comparison-${search}-${info.project.name}.png`, fullPage: info.project.name === 'desktop' });
});
