import { circleFixture } from '../fixtures';
import {test,expect,type Page} from '@playwright/test';
const center=(page:Page)=>page.getByRole('button',{name:'Move circle',exact:true});
async function camera(page:Page){return page.locator('.map').evaluate(el=>({transform:(el.querySelector('.leaflet-map-pane')as HTMLElement).style.transform,tiles:[...el.querySelectorAll('.leaflet-tile')].map(t=>(t as HTMLImageElement).src)}));}
async function position(page:Page){const b=(await center(page).boundingBox())!;return{x:b.x+b.width/2,y:b.y+b.height/2};}
async function values(page:Page){return Promise.all(['Circle radius','Start angle'].map(name=>page.getByRole('slider',{name,exact:true}).getAttribute('aria-valuenow')));}
test.beforeEach(async({page})=>{await page.route('**/tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#aaa"/><text x="8" y="20">Offline center fixture</text></svg>'}));});
test('center mouse/keyboard movement preserves radius, start bearing, map camera and cancel restores center',async({page},info)=>{
 await page.goto('/');await page.waitForLoadState('networkidle');const original=await values(page),cam=await camera(page),p=await position(page);
 await page.mouse.move(p.x+5,p.y+3);await page.mouse.down();await page.mouse.move(p.x+65,p.y+33,{steps:8});await page.waitForTimeout(680);await page.mouse.up();const moved=await position(page);expect(moved.x-p.x).toBeCloseTo(60,0);expect(moved.y-p.y).toBeCloseTo(30,0);expect(await values(page)).toEqual(original);expect(await camera(page)).toEqual(cam);
 await page.mouse.move(moved.x,moved.y);await page.mouse.down();await page.mouse.move(moved.x-40,moved.y+20,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();expect(await position(page)).toEqual(moved);expect(await values(page)).toEqual(original);expect(await camera(page)).toEqual(cam);
 await page.mouse.move(moved.x,moved.y);await page.mouse.down();await page.mouse.move(moved.x+25,moved.y-20,{steps:4});await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();expect(await position(page)).toEqual(moved);expect(await values(page)).toEqual(original);expect(await camera(page)).toEqual(cam);
 await center(page).focus();await center(page).press('Enter');await center(page).press('ArrowRight');await center(page).press('Enter');const keyed=await position(page);expect(keyed.x-moved.x).toBeCloseTo(12,0);expect(keyed.y-moved.y).toBeCloseTo(0,0);expect(await values(page)).toEqual(original);expect(await camera(page)).toEqual(cam);
 await center(page).press('Enter');await center(page).press('Shift+ArrowUp');await center(page).press('Enter');expect((await position(page)).y-keyed.y).toBeCloseTo(-48,0);expect(await values(page)).toEqual(original);expect(await camera(page)).toEqual(cam);
 const readout=page.locator('.radius-readout');await expect(readout.getByText('Circle size',{exact:true})).toBeVisible();const label=(await readout.locator('.radius-label').boundingBox())!,numeric=(await readout.getByRole('button').boundingBox())!;expect(label.y+label.height).toBeLessThanOrEqual(numeric.y+1);await expect(page.getByRole('heading',{name:'Circle size',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Fit circle',exact:true}).click();
 await page.screenshot({path:`/tmp/great-circle-center-${info.project.name}.png`,fullPage:info.project.name==='desktop'});
});
test('touch center ignores extra pointers and cancellation/lost capture restores without resizing or panning',async({page},info)=>{
 test.skip(info.project.name!=='mobile','Touch-only');await page.goto('/');await page.waitForLoadState('networkidle');const p=await position(page),v=await values(page),cam=await camera(page),cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+45,y:p.y+20,id:1}]});const moved=await position(page);expect(moved.x-p.x).toBeCloseTo(0,0);expect(await values(page)).toEqual(v);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x+45,y:p.y+20,id:1},{x:p.x-70,y:p.y-40,id:2}]});expect(await values(page)).toEqual(v);await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});expect(await position(page)).toEqual(p);expect(await values(page)).toEqual(v);expect(await camera(page)).toEqual(cam);
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+25,p.y-20,{steps:4});await center(page).evaluate(el=>(el as HTMLElement).releasePointerCapture(1));await page.mouse.up();expect(await position(page)).toEqual(p);expect(await camera(page)).toEqual(cam);
});

test('network failure gives a retry action, respects cooldown, then recovers without reloading',async({page})=>{
 await page.clock.install();let calls=0;
 await page.route('**/overpass-api.de/api/interpreter',r=>{calls++;return calls===1?r.abort('internetdisconnected'):r.fulfill({json:circleFixture(64,10000/(2*Math.PI)).data});});
 await page.goto('/');await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('status',{name:'Route status'})).toContainText('Map download stopped.');await expect(page.getByRole('alert')).toContainText('wait 30 seconds');expect(calls).toBe(1);
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Please wait');expect(calls).toBe(1);
 await page.clock.fastForward(31000);await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('status',{name:'Route status'})).toContainText('Loop found.');expect(calls).toBe(2);await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();
});
