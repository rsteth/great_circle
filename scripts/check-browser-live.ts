// Explicit opt-in: exactly one small real Overpass request from the local
// production app. Tiles are fixtures. No location, retries, failover or large query.
import { chromium } from '@playwright/test';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { changeCircle } from '../src/circle';
import { initialCoverage, coverageCost, type Corridor } from '../src/routing/coverage';
import { buildGraph, turnAllowed } from '../src/routing/graph';
import { roundness, trackLength } from '../src/routing/geo';
import type { Edge, OsmData, Point, Settings } from '../src/routing/types';
const baseURL = process.env.GREAT_CIRCLE_PREVIEW_URL ?? 'http://127.0.0.1:4181';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(baseURL)) throw new Error('Use a localhost production preview URL.');
const selected: Settings = changeCircle({ center: { lat: 49.289, lon: -123.128 }, start: { lat: 49.289, lon: -123.128 }, radiusM: 1000, targetKm: 3, tolerance: 0.3, surface: 'mixed', style: 'quiet' }, { radiusM: 500, bearing: 180 });
let coverage = initialCoverage(selected);
const reusePath = process.env.GREAT_CIRCLE_REUSE_INITIAL;
let reusedData: OsmData | undefined;
if (reusePath) {
  if (Date.now() - (await stat(reusePath)).mtimeMs > 900000) throw new Error('Saved initial response is older than the cache policy.');
  reusedData = JSON.parse(await readFile(reusePath, 'utf8')) as OsmData;
  if (!Array.isArray(reusedData.elements) || reusedData.remark) throw new Error('Saved initial response is incomplete.');
}
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage(); let sent = 0, blocked = 0, replayed = false;
  await page.addInitScript(() => Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition() { throw new Error('Unexpected geolocation request'); } } }));
  await page.route('**/tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#aaa"/><text x="8" y="20">Offline map · live corridor data</text></svg>' }));
  await page.route('https://overpass-api.de/api/interpreter', async route => {
    const query = new URLSearchParams(route.request().postData()!).get('data')!;
    if (reusedData && !replayed && !query.includes('way(around:1025')) { replayed = true; await route.fulfill({ json: reusedData }); return; }
    if (sent) { blocked++; await route.abort(); } else { sent++; await route.continue(); }
  });
  await page.goto(baseURL);
  await page.getByText('Coordinates', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Latitude', exact: true }).fill('49.289'); await page.getByRole('textbox', { name: 'Longitude', exact: true }).fill('-123.128');
  await page.getByRole('button', { name: 'Set pin', exact: true }).click(); await page.getByText('Coordinates', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit circle radius', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Circle radius (km)', exact: true }).fill('0.5'); await page.getByRole('spinbutton', { name: 'Circle radius (km)', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Start S', exact: true }).click(); await page.getByRole('slider', { name: 'Route variation', exact: true }).fill('0.3');
  const pending = page.waitForResponse(response => response.url() === 'https://overpass-api.de/api/interpreter' && (!reusedData || new URLSearchParams(response.request().postData()!).get('data')!.includes('way(around:1025')), { timeout: 90000 }).catch(() => undefined);
  await page.getByRole('button', { name: 'Generate loop', exact: true }).click();
  const response = await pending;
  if (response) {
    const query = new URLSearchParams(response.request().postData()!).get('data')!;
    const terms = [...query.matchAll(/way\(around:([^)]+)\)/g)].map(match => match[1].split(',').map(Number));
    const [halfWidthM, ...coordinates] = terms[0], line = []; for (let i = 0; i < coordinates.length; i += 2) line.push({ lat: coordinates[i], lon: coordinates[i + 1] });
    coverage = { kind: 'corridor', center: selected.center, line, halfWidthM, clipMarginM: 25, patches: terms.slice(1).map(([radiusM, lat, lon]) => ({ kind: 'disk', center: { lat, lon }, radiusM })) } as Corridor;
  }
  let data: OsmData | undefined;
  try { if (response?.status() === 200) data = await response.json() as OsmData; } catch { /* evidence records the real failure */ }
  await page.waitForFunction(allowWaiting => (allowWaiting ? /Loop found|No loop found|Map download stopped|Search stopped|Planning stopped|Waiting/ : /Loop found|No loop found|Map download stopped|Search stopped|Planning stopped/).test(document.querySelector('.status-bar')?.textContent ?? ''), !reusedData, { timeout: 65000 });
  const statusBeforeCancel = await page.locator('.status-bar').innerText();
  if (!reusedData && statusBeforeCancel.includes('Waiting')) await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const errors = await page.getByRole('alert').allTextContents();
  let validated: Record<string, unknown> | undefined;
  if (statusBeforeCancel.includes('Loop found') && data) {
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download GPX', exact: true }).click(); const download = await downloadPromise;
    const gpx = await readFile((await download.path())!, 'utf8'); await writeFile('/tmp/great-circle-corridor-live.gpx', gpx);
    const points = await page.evaluate(xmlText => { const xml = new DOMParser().parseFromString(xmlText, 'application/xml'); if (xml.querySelector('parsererror')) throw new Error('Invalid GPX XML'); return [...xml.getElementsByTagName('trkpt')].map(point => ({ lat: Number(point.getAttribute('lat')), lon: Number(point.getAttribute('lon')) })); }, gpx);
    if (points.length < 4 || JSON.stringify(points[0]) !== JSON.stringify(points.at(-1))) throw new Error('GPX is not closed.');
    const graph = buildGraph(data, selected, coverage), key = (p: Point) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
    const choices = new Map<string, Edge[]>();
    for (const edges of graph.edges.values()) for (const edge of edges) { const k = `${key(graph.nodes.get(edge.from)!)}>${key(graph.nodes.get(edge.to)!)}`; const list = choices.get(k) ?? []; list.push(edge); choices.set(k, list); }
    let states: { first: Edge; previous: Edge }[] = [];
    for (let i = 1; i < points.length; i++) {
      const available = choices.get(`${key(points[i - 1])}>${key(points[i])}`) ?? [];
      const next: typeof states = [];
      for (const edge of available) {
        if (i === 1) next.push({ first: edge, previous: edge });
        else for (const state of states) if (turnAllowed(graph, state.previous, edge)) next.push({ first: state.first, previous: edge });
      }
      states = [...new Map(next.map(state => [`${state.first.from}/${state.first.to}/${state.first.way}:${state.previous.from}/${state.previous.to}/${state.previous.way}`, state])).values()];
      if (!states.length || states.length > 10000) throw new Error('GPX contains an unmapped, directionally invalid or ambiguous segment.');
    }
    if (!states.some(state => state.previous.to === state.first.from && turnAllowed(graph, state.previous, state.first))) throw new Error('GPX closing turn is invalid.');
    const lengthM = trackLength(points), error = Math.abs(lengthM - selected.targetKm * 1000) / (selected.targetKm * 1000), round = roundness(points);
    if (error > 0.3001 || round < 0.2999) throw new Error('GPX does not meet its stated route objective.');
    validated = { points: points.length, closed: true, everyDirectedEdgeAndClosingTurnChecked: true, lengthM, distanceError: error, roundness: round };
  }
  if (data) await writeFile('/tmp/great-circle-corridor-live-osm.json', JSON.stringify(data));
  const headers = response ? await response.allHeaders() : {}, requestHeaders = response ? await response.request().allHeaders() : {};
  await page.screenshot({ path: '/tmp/great-circle-corridor-live-desktop.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '/tmp/great-circle-corridor-live-mobile.png', fullPage: false });
  const evidence = { source: reusedData ? 'One actual small consolidated expansion, reusing the fresh initial actual response; fixture tiles, no location or endpoint change' : 'One actual small browser corridor request; fixture tiles; no actual location, retry or failover', baseURL, reusedInitialResponse: !!reusedData, replayed, sent, blocked, status: response?.status(), cors: headers['access-control-allow-origin'], identity: { userAgent: requestHeaders['user-agent'], origin: requestHeaders.origin, referer: requestHeaders.referer }, circleRadiusM: 500, queryCostProxy: coverageCost(coverage), receivedElements: data?.elements?.length, hasRemark: !!data?.remark, statusBeforeCancel, errors, validated };
  await writeFile('/tmp/great-circle-corridor-live-summary.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
  if (!validated || sent !== 1 || blocked) process.exitCode = 1;
} finally { await browser.close(); }
