import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { circleFixture } from '../fixtures';
const endpoint = '**/overpass-api.de/api/interpreter';
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dce3e5"/><path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#c3cdd0"/><text x="12" y="24" font-size="11" fill="#839195">Offline fixture map</text></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('**/tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: tile }));
});
async function openSettings(page: Page) {
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  if (await trigger.count() && !(await page.getByRole('dialog', { name: 'Route settings', exact: true }).count())) await trigger.click();
}
async function closeSettings(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Route settings', exact: true });
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}
async function coordinates(page: Page) {
  await openSettings(page);
  await page.getByText('Coordinates', { exact: true }).click();
}
async function number(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  if (!(await input.isVisible())) await openSettings(page);
  await input.fill(value); await input.press('Tab');
  if (!(await input.getAttribute('aria-invalid') === 'true')) await closeSettings(page);
}
async function frame(page: Page) {
  return page.locator('.map-shell').evaluate(element => {
    const box = element.getBoundingClientRect(), line = element.querySelector('.clock-hand')!;
    const x = Number(line.getAttribute('x1')), y = Number(line.getAttribute('y1'));
    const radius = Math.hypot(Number(line.getAttribute('x2')) - x, Number(line.getAttribute('y2')) - y);
    return { x: box.left + x, y: box.top + y, radius };
  });
}
async function dragStart(page: Page, angle: number, release = true) {
  const handle = page.getByRole('slider', { name: 'Start angle', exact: true });
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!, f = await frame(page), radians = angle * Math.PI / 180;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(f.x + Math.sin(radians) * f.radius, f.y - Math.cos(radians) * f.radius, { steps: 8 });
  if (release) await page.mouse.up();
}
const radiusInput = (page: Page) => page.getByLabel('Radius (km)', { exact: true });
const angleInput = (page: Page) => page.getByLabel('Start angle (° clockwise from north)', { exact: true });

test('circle controls generate a fixture loop and download full GPX geometry', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let requests = 0;
  await page.route(endpoint, async route => { requests++; await route.fulfill({ json: circleFixture(64, 850).data }); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Circle size', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Start angle', exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await number(page, 'Target distance (km)', '5');
  await page.getByRole('button', { name: 'Generate loop' }).click();
  await expect(page.getByText('Loop found.', { exact: true })).toBeVisible();
  await expect(page.locator('.metrics')).toContainText('5.34');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download GPX' }).click();
  const download = await downloadPromise;
  const text = await readFile((await download.path())!, 'utf8');
  const result = await page.evaluate(gpx => {
    const xml = new DOMParser().parseFromString(gpx, 'application/xml'), points = [...xml.getElementsByTagName('trkpt')];
    return { count: points.length, closed: points[0].outerHTML === points.at(-1)!.outerHTML, errors: xml.getElementsByTagName('parsererror').length };
  }, text);
  expect(result).toEqual({ count: 65, closed: true, errors: 0 });
  expect(requests).toBe(1); expect(errors).toEqual([]);
  await radiusInput(page).focus(); await radiusInput(page).press('Tab');
  await expect(page.getByRole('button', { name: 'Download again' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `/tmp/great-circle-hand-${info.project.name}.png`, fullPage: info.project.name !== 'mobile' });
  await page.getByRole('slider', { name: 'Start angle', exact: true }).press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Download GPX' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate loop' }).click();
  await expect(page.getByText('Loop found.', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('repeated clock drags wrap north without changing size or center', async ({ page }) => {
  await page.goto('/');
  const originalRadius = await radiusInput(page).inputValue();
  const target = await page.getByLabel('Target distance (km)', { exact: true }).inputValue();
  for (const angle of [355, 5, 90, 180, 270, 359, 1]) {
    await dragStart(page, angle);
    const actual = Number(await angleInput(page).inputValue());
    expect(Math.abs(Math.atan2(Math.sin((actual - angle) * Math.PI / 180), Math.cos((actual - angle) * Math.PI / 180)) * 180 / Math.PI)).toBeLessThan(3);
    await expect(radiusInput(page)).toHaveValue(originalRadius);
  }
  await expect(page.getByLabel('Target distance (km)', { exact: true })).toHaveValue(target);
  const handle = page.getByRole('slider', { name: 'Start angle', exact: true });
  await handle.press('Home'); await handle.press('ArrowLeft');
  await expect(angleInput(page)).toHaveValue('359');
  await handle.press('ArrowRight'); await expect(angleInput(page)).toHaveValue('0');
  await coordinates(page);
  await expect(page.getByRole('textbox', { name: 'Latitude', exact: true })).toHaveValue('49.29900');
  await expect(page.getByRole('textbox', { name: 'Longitude', exact: true })).toHaveValue('-123.13300');
});

test('resize is independent, captured outside the handle, and cancellation restores the circle', async ({ page }) => {
  await page.goto('/');
  await number(page, 'Start angle (° clockwise from north)', '37');
  const size = page.getByRole('slider', { name: 'Circle radius', exact: true });
  await size.scrollIntoViewIfNeeded();
  const original = Number(await radiusInput(page).inputValue()), box = (await size.boundingBox())!;
  await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + 55, { steps: 6 });
  expect(Number(await radiusInput(page).inputValue())).toBeGreaterThan(original);
  await expect(angleInput(page)).toHaveValue('37');
  await page.mouse.up();
  const resized = await radiusInput(page).inputValue();
  await dragStart(page, 140, false); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(angleInput(page)).toHaveValue('37'); await expect(radiusInput(page)).toHaveValue(resized);
  await page.evaluate(() => document.addEventListener('pointerdown', event => { (window as unknown as { pointer: number }).pointer = event.pointerId; }, { capture: true }));
  await dragStart(page, 210, false);
  const pointerId = await page.evaluate(() => (window as unknown as { pointer: number }).pointer);
  await page.getByRole('slider', { name: 'Start angle', exact: true }).dispatchEvent('pointercancel', { pointerId, bubbles: true });
  await page.mouse.up(); await expect(angleInput(page)).toHaveValue('37');
  await dragStart(page, 145, false);
  const captured = await page.evaluate(() => (window as unknown as { pointer: number }).pointer);
  await page.getByRole('slider', { name: 'Start angle', exact: true }).evaluate((element, id) => element.releasePointerCapture(id), captured);
  await page.mouse.up(); await expect(angleInput(page)).toHaveValue('37');
  const cancelBox = (await size.boundingBox())!;
  await page.mouse.move(cancelBox.x + 22, cancelBox.y + 22); await page.mouse.down();
  await page.mouse.move(cancelBox.x + 45, cancelBox.y + 45, { steps: 3 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(radiusInput(page)).toHaveValue(resized); await expect(angleInput(page)).toHaveValue('37');
  await dragStart(page, 90); expect(Number(await angleInput(page).inputValue())).toBeCloseTo(90, 0);
  await size.focus(); await size.press('Home'); await expect(radiusInput(page)).toHaveValue('0.5');
  await size.press('ArrowUp'); await expect(radiusInput(page)).toHaveValue('0.55');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('center and size changes preserve the hand angle and allow regeneration', async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  await page.route(endpoint, route => { requests++; return route.fulfill({ json: circleFixture(64, 850).data }); });
  await page.goto('/'); await number(page, 'Radius (km)', '0.85');
  await number(page, 'Start angle (° clockwise from north)', '90');
  await page.getByRole('button', { name: 'Generate loop' }).click();
  await expect(page.getByText('Loop found.', { exact: true })).toBeVisible();
  await coordinates(page);
  await page.getByRole('textbox', { name: 'Latitude', exact: true }).fill('49.2991');
  await page.getByRole('button', { name: 'Set pin' }).click();
  await expect(angleInput(page)).toHaveValue('90'); await expect(radiusInput(page)).toHaveValue('0.85');
  await closeSettings(page);
  await expect(page.getByRole('button', { name: 'Download GPX' })).toHaveCount(0);
  await page.clock.fastForward(31000);
  await page.getByRole('button', { name: 'Generate loop' }).click();
  await expect(page.getByText('Loop found.', { exact: true })).toBeVisible();
  expect(requests).toBe(2);
  await number(page, 'Radius (km)', '0.9'); await expect(angleInput(page)).toHaveValue('90');
  await expect(page.getByRole('button', { name: 'Download GPX' })).toHaveCount(0);
  await page.clock.fastForward(31000); await page.getByRole('button', { name: 'Generate loop' }).click();
  await expect(page.getByText('Loop found.', { exact: true })).toBeVisible(); expect(requests).toBe(3);
});

test('network errors, search cancellation and numeric fallbacks remain actionable', async ({ page }) => {
  await page.route(endpoint, route => route.fulfill({ status: 429, body: 'Busy' }));
  await page.goto('/');
  await number(page, 'Radius (km)', '0.1'); await expect(page.getByRole('alert')).toContainText('0.5–4.5');
  await number(page, 'Radius (km)', '1');
  await page.getByRole('button', { name: 'Generate loop' }).click(); await expect(page.getByRole('alert')).toContainText('rate-limited');
  await page.reload(); await page.unroute(endpoint);
  await page.route(endpoint, async route => { await new Promise(resolve => setTimeout(resolve, 1000)); await route.fulfill({ json: circleFixture().data }).catch(() => {}); });
  await page.getByRole('button', { name: 'Generate loop' }).click(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Route status' })).toContainText('Cancelled.');
  await page.waitForTimeout(1200); await expect(page.getByRole('status', { name: 'Route status' })).toContainText('Cancelled.');
  await coordinates(page);
  await page.getByRole('textbox', { name: 'Latitude', exact: true }).fill('91'); await page.getByRole('button', { name: 'Set pin' }).click();
  await expect(page.getByRole('alert')).toContainText('latitude');
});

test('touch rotates the hand without scrolling or moving the center', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Touch viewport check');
  await page.goto('/');
  const handle = page.getByRole('slider', { name: 'Start angle', exact: true }); await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!, f = await frame(page), before = await radiusInput(page).inputValue();
  const scrollY = await page.evaluate(() => window.scrollY), cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 22, y: box.y + 22 }] });
  await expect(handle).toBeFocused();
  for (const angle of [165, 150, 135, 120, 105, 90]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: f.x + Math.sin(angle * Math.PI / 180) * f.radius, y: f.y - Math.cos(angle * Math.PI / 180) * f.radius }] });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(Math.abs(Number(await angleInput(page).inputValue()) - 90)).toBeLessThan(1.5);
  await expect(radiusInput(page)).toHaveValue(before); expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
});
