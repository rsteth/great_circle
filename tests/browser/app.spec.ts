import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { circleFixture } from '../fixtures';
const endpoint = '**/overpass-api.de/api/interpreter';
const start = (page: Page) => page.getByRole('slider', { name: 'Start angle', exact: true });
const size = (page: Page) => page.getByRole('slider', { name: 'Circle radius', exact: true });
const radius = (page: Page) => size(page).getAttribute('aria-valuenow');
const angle = async (page: Page) => Number(await start(page).getAttribute('aria-valuenow'));
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#aab5b8"/><path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#c3cdd0"/><text x="12" y="24" font-size="11">Offline fixture map</text></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('**/tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: tile }));
});
async function frame(page: Page) {
  return page.locator('.map-shell').evaluate(element => {
    const center = element.querySelector('.target-center')!.getBoundingClientRect(), handle = element.querySelector('.start-handle')!.getBoundingClientRect();
    const x = center.x + center.width / 2, y = center.y + center.height / 2;
    return { x, y, radius: Math.hypot(handle.x + handle.width / 2 - x, handle.y + handle.height / 2 - y) };
  });
}
function point(f: {x:number;y:number;radius:number}, a: number, scale = 1) { return { x: f.x + Math.sin(a * Math.PI / 180) * f.radius * scale, y: f.y - Math.cos(a * Math.PI / 180) * f.radius * scale }; }
async function drag(page: Page, kind: 'start'|'size', target: {x:number;y:number}, release=true) {
  const handle = kind === 'start' ? start(page) : size(page); await handle.scrollIntoViewIfNeeded();
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down();
  await page.mouse.move(target.x,target.y,{steps:8}); if (release) await page.mouse.up();
}
async function fixtureSize(page: Page) { await size(page).press('Home'); for(let i=0;i<7;i++) await size(page).press('ArrowUp'); }

test('one radius line, on-ring size selection, safe start exclusion and independent rotation', async ({page}, info) => {
  await page.goto('/');
  await expect(page.locator('.size-radius')).toHaveCount(1); await expect(page.locator('.clock-hand')).toHaveCount(0);
  await expect(page.locator('.size-arrow-guide')).toHaveAttribute('marker-start', 'url(#size-arrow)');
  await expect(page.locator('.size-arrow-guide')).toHaveAttribute('marker-end', 'url(#size-arrow)');
  let f=await frame(page), b=(await size(page).boundingBox())!;
  expect(b.x+b.width/2).toBeGreaterThan(f.x); expect(b.y+b.height/2).toBeGreaterThan(f.y);
  // Geodesic/Mercator projection and integer layer pixels differ slightly by bearing.
  expect(Math.abs(Math.hypot(b.x+b.width/2-f.x,b.y+b.height/2-f.y)-f.radius)).toBeLessThan(1.5);
  const initialRadius=await radius(page);
  const p=point(f,270); await page.mouse.click(p.x,p.y);
  b=(await size(page).boundingBox())!; expect(Math.abs(b.x+b.width/2-p.x)).toBeLessThan(3); expect(Math.abs(b.y+b.height/2-p.y)).toBeLessThan(3);
  for(const a of [355,5,90,180,270,359,1]) { f=await frame(page); await drag(page,'start',point(f,a)); expect(Math.abs(Math.atan2(Math.sin((await angle(page)-a)*Math.PI/180),Math.cos((await angle(page)-a)*Math.PI/180))*180/Math.PI)).toBeLessThan(3); expect(await radius(page)).toBe(initialRadius); }
  f=await frame(page); const before=(await size(page).boundingBox())!, near=point(f,await angle(page)+8);
  await page.mouse.click(near.x,near.y); const after=(await size(page).boundingBox())!; expect(after.x).toBeCloseTo(before.x,0); expect(after.y).toBeCloseTo(before.y,0); expect(await radius(page)).toBe(initialRadius);
  await start(page).press('Home'); await start(page).press('ArrowLeft'); expect(await angle(page)).toBe(359);
  await page.screenshot({path:`/tmp/great-circle-perimeter-${info.project.name}.png`,fullPage:false});
});

test('resize captures pointer; escape, cancel and lost capture restore radius and angle',async({page})=>{
  await page.goto('/'); const original=await radius(page), originalAngle=await angle(page);
  let f=await frame(page); await drag(page,'size',point(f,135,1.25)); expect(Number(await radius(page))).toBeGreaterThan(Number(original)); expect(await angle(page)).toBe(originalAngle);
  const resized=await radius(page); f=await frame(page); await drag(page,'start',point(f,90),false); await page.keyboard.press('Escape'); await page.mouse.up(); await expect(size(page)).toHaveAttribute('aria-valuenow',resized!); expect(await angle(page)).toBe(originalAngle);
  await page.evaluate(()=>document.addEventListener('pointerdown',e=>{(window as unknown as {pointer:number}).pointer=e.pointerId;},{capture:true}));
  for(const mode of ['cancel','lost']) {
    f=await frame(page); await drag(page,'size',point(f,135,1.2),false);
    const id=await page.evaluate(()=>(window as unknown as {pointer:number}).pointer);
    if(mode==='cancel') await size(page).dispatchEvent('pointercancel',{pointerId:id,bubbles:true});
    else await size(page).evaluate((el,id)=>el.releasePointerCapture(id),id);
    await page.mouse.up(); await expect(size(page)).toHaveAttribute('aria-valuenow',resized!); expect(await angle(page)).toBe(originalAngle);
  }
  await size(page).press('Home'); expect(await radius(page)).toBe('500'); await size(page).press('ArrowUp'); expect(await radius(page)).toBe('550');
});

test('variation is unlabeled numerically, fixture regeneration uses cache and GPX stays closed', async({page})=>{
  let requests=0; await page.route(endpoint,r=>{requests++;return r.fulfill({json:circleFixture(64,850).data});});
  await page.goto('/'); await fixtureSize(page);
  const slider=page.getByRole('slider',{name:'Route variation',exact:true}); await expect(slider).toHaveAttribute('min','0.1'); await expect(slider).toHaveAttribute('max','0.3');
  await slider.fill('0.3'); expect(await radius(page)).toBe('850'); await expect(page.locator('.variation-control')).not.toContainText('%');
  await page.getByRole('button',{name:'Generate loop'}).click(); await expect(page.getByText('Loop found.',{exact:true})).toBeVisible();
  const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Download GPX'}).click(); const file=await pending;
  const xml=await readFile((await file.path())!,'utf8'); const pts=xml.match(/<trkpt[^>]*\/>/g)!; expect(pts).toHaveLength(65); expect(pts[0]).toBe(pts.at(-1)); expect(requests).toBe(1);
  await slider.fill('0.1'); await expect(page.getByRole('button',{name:'Download GPX'})).toHaveCount(0);
  await page.getByRole('button',{name:'Generate loop'}).click(); await expect(page.getByText('Loop found.',{exact:true})).toBeVisible(); expect(requests).toBe(1);
});

test('route errors and cancellation remain actionable',async({page})=>{
  await page.route(endpoint,r=>r.fulfill({status:429,body:'Busy'})); await page.goto('/');
  await page.getByRole('button',{name:'Generate loop'}).click(); await expect(page.getByRole('alert')).toContainText('rate-limited');
  await page.reload(); await page.unroute(endpoint); await page.route(endpoint,async r=>{await new Promise(resolve=>setTimeout(resolve,400));await r.fulfill({json:circleFixture().data}).catch(()=>{});});
  await page.getByRole('button',{name:'Generate loop'}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForTimeout(500);await expect(page.getByRole('status',{name:'Route status'})).toContainText('Cancelled.');
});

test('touch start drag plus second finger never changes radius; map pinch and pan remain enabled',async({page},info)=>{
  test.skip(info.project.name!=='mobile','Touch-only'); await page.goto('/');
  const f=await frame(page), b=(await start(page).boundingBox())!, before=await radius(page), cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+22,y:b.y+22,id:1}]}); await expect(start(page)).toBeFocused();
  for(const a of [165,150,135,120,105,90]) { const p=point(f,a);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:1}]});await page.evaluate(()=>new Promise(requestAnimationFrame)); }
  const p=point(f,90);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1},{x:f.x-20,y:f.y-20,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point(f,60),id:1},{x:f.x-40,y:f.y-40,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]}); expect(await radius(page)).toBe(before);
  await start(page).press('ArrowRight'); expect(await radius(page)).toBe(before);
  // A map-only pinch followed by pan must not mutate the selected circle.
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:f.x-30,y:f.y-20,id:1},{x:f.x+30,y:f.y+20,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:f.x-65,y:f.y-45,id:1},{x:f.x+65,y:f.y+45,id:2}]});await page.evaluate(()=>new Promise(requestAnimationFrame));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); expect(await radius(page)).toBe(before);
  await page.mouse.move(f.x,f.y);await page.mouse.down();await page.mouse.move(f.x+25,f.y+15,{steps:5});await page.mouse.up();expect(await radius(page)).toBe(before);
});

test('moving center and resizing preserve angle, invalidate export and regenerate',async({page})=>{
  await page.clock.install();let requests=0;await page.route(endpoint,r=>{requests++;return r.fulfill({json:circleFixture(64,850).data});});await page.goto('/');await fixtureSize(page);await start(page).press('Home');for(let i=0;i<6;i++)await start(page).press('PageUp');
  await page.getByRole('button',{name:'Generate loop'}).click();await expect(page.getByText('Loop found.',{exact:true})).toBeVisible();
  const settings=page.getByRole('button',{name:'Settings',exact:true});if(await settings.count())await settings.click();await page.getByText('Coordinates',{exact:true}).click();
  await page.getByRole('textbox',{name:'Latitude',exact:true}).fill('49.2991');await page.getByRole('button',{name:'Set pin'}).click();
  if(await settings.count())await page.getByRole('button',{name:'Done',exact:true}).click();expect(await angle(page)).toBe(90);expect(await radius(page)).toBe('850');await expect(page.getByRole('button',{name:'Download GPX'})).toHaveCount(0);
  await page.clock.fastForward(31000);await page.getByRole('button',{name:'Generate loop'}).click();await expect(page.getByText('Loop found.',{exact:true})).toBeVisible();expect(requests).toBe(2);
  await size(page).press('ArrowUp');expect(await angle(page)).toBe(90);await expect(page.getByRole('button',{name:'Download GPX'})).toHaveCount(0);await page.clock.fastForward(31000);await page.getByRole('button',{name:'Generate loop'}).click();await expect(page.getByText('Loop found.',{exact:true})).toBeVisible();expect(requests).toBe(3);
});

test('touch can relocate Size then resize without moving start',async({page},info)=>{
  test.skip(info.project.name!=='mobile','Touch-only');await page.goto('/');const originalAngle=await angle(page);let f=await frame(page);const p=point(f,270);await page.touchscreen.tap(p.x,p.y);
  let b=(await size(page).boundingBox())!;expect(Math.abs(b.x+22-p.x)).toBeLessThan(3);const before=Number(await radius(page));
  const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+22,y:b.y+22,id:1}]});await expect(size(page)).toBeFocused();
  for(const scale of [1.03,1.06,1.09,1.12]){const dest=point(f,270,scale);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...dest,id:1}]});await page.evaluate(()=>new Promise(requestAnimationFrame));}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});expect(Number(await radius(page))).toBeGreaterThan(before);expect(await angle(page)).toBe(originalAngle);
});

test('zooming far out preserves Start priority and Fit restores separated handles',async({page})=>{
  await page.goto('/');const before=await radius(page);for(let i=0;i<6&&(await frame(page)).radius>=34;i++){const beforeZoom=(await frame(page)).radius;await page.getByRole('button',{name:'Zoom out',exact:true}).click();await expect.poll(async()=>(await frame(page)).radius).toBeLessThan(beforeZoom);}
  await expect(page.locator('.size-handle')).toBeHidden();await expect(start(page)).toBeVisible();
  await start(page).press('ArrowRight');expect(await page.locator('.size-handle').getAttribute('aria-valuenow')).toBe(before);
  expect(await page.locator('.clock-lines').evaluate(el=>el.outerHTML.includes('NaN'))).toBe(false);
  await page.getByRole('button',{name:'Fit circle',exact:true}).click();await expect(size(page)).toBeVisible();
});
