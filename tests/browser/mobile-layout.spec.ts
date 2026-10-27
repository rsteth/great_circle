import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { circleFixture } from '../fixtures';
const endpoint = '**/overpass-api.de/api/interpreter';
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dce3e5"/><path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#c3cdd0"/><text x="12" y="24" font-size="11" fill="#839195">Offline fixture map</text></svg>';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Route settings', exact: true });
const trigger = (page: Page) => page.getByRole('button', { name: 'Settings', exact: true });
async function center(page: Page) { return page.locator('.coordinate-inputs input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)); }
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Phone-specific drawer/layout checks');
  await page.route('**/tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: tile }));
});

test('full-width map with reachable controls at narrow, portrait and landscape widths', async ({ page }) => {
  await page.goto('/');
  for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect(trigger(page)).toBeVisible();
    await expect.poll(async () => Math.round((await page.locator('.map').boundingBox())!.width)).toBe(width);
    const map = (await page.locator('.map').boundingBox())!, generate = (await page.getByRole('button', { name: 'Generate loop' }).boundingBox())!;
    expect(map.x).toBe(0); expect(generate.y + generate.height).toBeLessThanOrEqual(height + 1);
    const attribution = (await page.locator('.leaflet-control-attribution').boundingBox())!;
    expect(attribution.y + attribution.height).toBeLessThanOrEqual(map.y + map.height + 1);
    const top = await page.locator('.leaflet-control-attribution').evaluate(element => {
      const b = element.getBoundingClientRect(); return !!document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.leaflet-control-attribution');
    });
    expect(top).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const before = await center(page);
    await page.getByRole('slider', { name: 'Circle radius', exact: true }).press('Home'); for (let i=0;i<7;i++) await page.getByRole('slider', { name: 'Circle radius', exact: true }).press('ArrowUp');
    expect(await center(page)).toEqual(before);
    for (const name of ['Start angle', 'Circle radius']) {
      const handle = page.getByRole('slider', { name, exact: true });
      await expect(handle).toBeVisible();
      const b = (await handle.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(-1); expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
      expect(b.y).toBeGreaterThanOrEqual(map.y - 1); expect(b.y + b.height).toBeLessThanOrEqual(map.y + map.height + 1);
      for (const overlay of await page.locator('.place-search,.map-button,.map-hint,.ideal-toggle').all()) {
        const other = await overlay.boundingBox();
        if (other) expect(b.x < other.x + other.width && b.x + b.width > other.x && b.y < other.y + other.height && b.y + b.height > other.y).toBe(false);
      }
    }
  }
  await page.screenshot({ path: '/tmp/great-circle-mobile-landscape.png', fullPage: false });
});

test('drawer traps focus, locks scroll, dismisses repeatedly and returns focus without map clicks', async ({ page }) => {
  await page.goto('/'); await trigger(page).scrollIntoViewIfNeeded();
  const before = await center(page), position = await page.evaluate(() => scrollY);
  for (const method of ['done', 'escape', 'close', 'backdrop']) {
    await trigger(page).click(); await expect(dialog(page)).toBeVisible();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
    const close = dialog(page).getByRole('button', { name: 'Close settings', exact: true });
    const done = dialog(page).getByRole('button', { name: 'Done', exact: true });
    await expect(close).toBeFocused();
    expect(await page.evaluate(() => document.body.style.position)).toBe('fixed');
    await done.focus(); await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(done).toBeFocused();
    if (method === 'done') await done.click();
    if (method === 'escape') { await dialog(page).getByLabel('Start angle (° clockwise from north)', { exact: true }).focus(); await page.keyboard.press('Escape'); }
    if (method === 'close') await close.click();
    if (method === 'backdrop') {
      const map = (await page.locator('.map').boundingBox())!, panel = (await dialog(page).boundingBox())!;
      await page.mouse.click(map.x + map.width / 2, Math.min(map.y + 10, panel.y - 5));
    }
    await expect(dialog(page)).toHaveCount(0); await expect(trigger(page)).toBeFocused();
    expect(await page.evaluate(() => document.body.style.position)).toBe('');
    expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(2);
    expect(await center(page)).toEqual(before);
  }
  await trigger(page).click();
  const content = page.locator('.drawer-content'); await content.hover({ position: { x: 5, y: 20 } });
  await page.screenshot({ path: '/tmp/great-circle-mobile-settings.png', fullPage: false });
  await page.mouse.wheel(0, 350); await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.keyboard.press('Escape'); await expect(trigger(page)).toBeFocused();
});

test('drawer responds to rotation/breakpoints and brings invalid hidden fields into focus', async ({ page }) => {
  await page.goto('/'); await trigger(page).click();
  await page.setViewportSize({ width: 844, height: 390 }); await expect(dialog(page)).toBeVisible();
  await dialog(page).getByLabel('Start angle (° clockwise from north)', { exact: true }).fill('361');
  await dialog(page).getByLabel('Start angle (° clockwise from north)', { exact: true }).press('Tab');
  await dialog(page).getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Generate loop' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('Start angle (° clockwise from north)', { exact: true })).toBeFocused();
  await dialog(page).getByLabel('Start angle (° clockwise from north)', { exact: true }).fill('45');
  await dialog(page).getByLabel('Start angle (° clockwise from north)', { exact: true }).press('Tab');
  await dialog(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate loop' })).toBeFocused();
  await trigger(page).click();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(dialog(page)).toHaveCount(0); await expect(page.locator('.planner')).toBeVisible();
  expect(await page.evaluate(() => document.body.style.position)).toBe('');
  await page.setViewportSize({ width: 320, height: 568 }); await trigger(page).click();
  await expect(dialog(page).getByLabel('Start angle (° clockwise from north)', { exact: true })).toHaveValue('45');
  await page.keyboard.press('Escape'); await expect(trigger(page)).toBeFocused();
});

test('loading, errors, successful result and GPX remain outside the drawer', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(endpoint, async route => { await gate; await route.fulfill({ json: circleFixture(64, 850).data }); });
  await page.goto('/'); await page.getByRole('slider', { name: 'Circle radius', exact: true }).press('Home'); for (let i=0;i<7;i++) await page.getByRole('slider', { name: 'Circle radius', exact: true }).press('ArrowUp');
  await page.getByRole('button', { name: 'Generate loop' }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await expect(trigger(page)).toBeDisabled(); await expect(page.getByRole('slider', { name: 'Circle radius', exact: true })).toBeDisabled();
  await expect(page.getByRole('status', { name: 'Route status' })).toContainText('Loading');
  release(); await expect(page.getByText('Loop found.', { exact: true })).toBeVisible();
  const download = page.getByRole('button', { name: 'Download GPX', exact: true });
  await expect(download).toBeInViewport(); expect(await download.count()).toBe(1);
  const pending = page.waitForEvent('download'); await download.click(); const file = await pending;
  const xml = await readFile((await file.path())!, 'utf8'); expect(xml.match(/<trkpt /g)).toHaveLength(65);
  await page.screenshot({ path: '/tmp/great-circle-mobile-map-dock.png', fullPage: false });
  await page.reload(); await page.unroute(endpoint); await page.route(endpoint, route => route.fulfill({ status: 429, body: 'busy' }));
  await page.getByRole('button', { name: 'Generate loop' }).click();
  await expect(page.getByRole('alert')).toContainText('rate-limited'); await expect(page.getByRole('alert')).toBeInViewport();
  await expect(trigger(page)).toBeEnabled(); await expect(dialog(page)).toHaveCount(0);
});
