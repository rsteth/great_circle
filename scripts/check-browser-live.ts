// Explicit opt-in; run only after build + starting the local production preview.
// Exactly one real browser POST, normal browser UA/Referer, no retry/failover.
import { chromium } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
const baseURL = process.env.GREAT_CIRCLE_PREVIEW_URL ?? 'http://127.0.0.1:4181';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(baseURL)) throw new Error('Use a localhost production preview URL.');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage();
  const network: Record<string, unknown>[] = [];
  let requests = 0;
  await context.route('https://overpass-api.de/api/interpreter', async route => {
    requests++;
    if (requests > 1) { await route.abort(); throw new Error('Refusing a second Overpass request.'); }
    network.push({ request: { url: route.request().url(), method: route.request().method(), headers: await route.request().allHeaders(), body: route.request().postData() } });
    await route.continue(); // Does not modify headers, identity, Origin, or Referer.
  });
  page.on('response', response => {
    if (response.url() === 'https://overpass-api.de/api/interpreter') network.push({ response: { status: response.status(), headers: response.headers() } });
  });
  page.on('requestfailed', request => {
    if (request.url() === 'https://overpass-api.de/api/interpreter') network.push({ failure: request.failure() });
  });
  await page.goto(baseURL);
  await page.getByText('Coordinates', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Latitude' }).fill('49.289');
  await page.getByRole('textbox', { name: 'Longitude' }).fill('-123.128');
  await page.getByRole('button', { name: 'Set pin' }).click();
  await page.getByText('Coordinates', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Radius (km)', exact: true }).fill('0.5');
  await page.getByRole('spinbutton', { name: 'Radius (km)', exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Start S', exact: true }).click();
  await page.getByRole('button', { name: 'Generate loop' }).click();
  await page.waitForFunction(() => /Loop found|No loop found|Map download stopped|Search stopped/.test(document.querySelector('.status-bar')?.textContent ?? ''), null, { timeout: 65000 });
  const status = await page.locator('.status-bar').innerText();
  const error = await page.getByRole('alert').allTextContents();
  let gpx: unknown;
  if (status.includes('Loop found')) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download GPX' }).click();
    const download = await downloadPromise;
    const text = await readFile((await download.path())!, 'utf8');
    await writeFile('/tmp/great-circle-browser-live.gpx', text);
    gpx = await page.evaluate(xmlText => {
      const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
      const points = [...xml.getElementsByTagName('trkpt')];
      return { parserErrors: xml.getElementsByTagName('parsererror').length, points: points.length, closed: points[0]?.outerHTML === points.at(-1)?.outerHTML, namespace: xml.documentElement.namespaceURI };
    }, text);
  }
  await page.screenshot({ path: '/tmp/great-circle-browser-live-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/great-circle-browser-live-mobile.png', fullPage: false });
  const summary = { baseURL, source: 'Actual browser request from local production app; no fixture or identity override', requests, network, status, error, metrics: await page.locator('.metrics').innerText(), gpx, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
  await writeFile('/tmp/great-circle-browser-live-summary.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!status.includes('Loop found')) process.exitCode = 1;
} finally { await browser.close(); }
