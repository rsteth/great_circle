import { test, expect, type Page } from '@playwright/test';
import { createLoopPlanner } from '../../server/loop';
import { pointOnCircle, bearingTo } from '../../src/circle';
import { trackLength } from '../../src/routing/geo';
import type { LoopRequest } from '../../src/loop/types';
const edit=(page:Page)=>page.getByRole('button',{name:'Edit circle radius',exact:true});
const input=(page:Page)=>page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true});
const radius=(page:Page)=>page.getByRole('slider',{name:'Circle radius',exact:true});
async function accepted(body:LoopRequest){return createLoopPlanner({route:async()=>{
 const {settings:s}=body,r=s.circleRadiusM!,a=bearingTo(s.center,s.start),points=Array.from({length:65},(_,i)=>pointOnCircle(s.center,r,a+i*360/64));points[64]={...points[0]};
 return{points,distanceM:trackLength(points),waypoints:Array.from({length:9},(_,i)=>i*8),surface:[[0,64,3]]};
}})(body,new AbortController().signal);}
test.beforeEach(async({page})=>{await page.route('**/*',async route=>{
 const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();
 if(u.hostname==='tile.openstreetmap.org')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#26262a"/><text fill="#777" x="8" y="20">Offline fixture map</text></svg>'});
 return route.abort();});});
test('ordered prepared-route contract, licensed native GPX, controls and drawer',async({page},info)=>{
 let calls=0;await page.route('**/api/loop',async route=>{calls++;return route.fulfill({json:await accepted(route.request().postDataJSON())});});await page.goto('/');
 if(info.project.name==='phone'){const action=(await page.getByRole('button',{name:'Generate loop',exact:true}).boundingBox())!,scale=(await page.getByRole('slider',{name:'Route variation',exact:true}).boundingBox())!;expect(action.y+action.height).toBeLessThan(scale.y);await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();}
 else{expect((await page.getByRole('button',{name:'Generate loop',exact:true}).boundingBox())!.y).toBeLessThan((await edit(page).boundingBox())!.y);}
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('status',{name:'Route status',exact:true})).toContainText('Loop found.');expect(calls).toBe(1);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Download GPX',exact:true}).click();const download=await dl;const stream=await download.createReadStream();let xml='';for await(const chunk of stream!)xml+=chunk.toString();expect(xml).toContain('CC BY-SA 4.0');expect(xml.match(/<trkpt /g)).toHaveLength(65);
 await expect(page.getByRole('link',{name:'Routing © openrouteservice.org by HeiGIT',exact:true})).toBeVisible();await page.screenshot({path:`/tmp/great-circle-ors-${info.project.name}.png`,fullPage:true});
});
test('explicit Done and Cancel, invalid/empty drafts recover on center/size drag, no accidental Generate',async({page})=>{
 let calls=0;await page.route('**/api/loop',r=>{calls++;return r.abort();});await page.goto('/');await edit(page).click();await expect(input(page)).toHaveAttribute('enterkeyhint','done');await input(page).fill('1.25');await page.getByRole('button',{name:'Done editing radius'}).click();await expect(edit(page)).toContainText('1.25');
 await edit(page).click();await input(page).fill('');await page.getByRole('button',{name:'Done editing radius'}).click();await expect(input(page)).toHaveAttribute('aria-invalid','true');await page.getByRole('button',{name:'Cancel radius edit'}).click();await expect(edit(page)).toContainText('1.25');
 await edit(page).click();await input(page).fill('1.5');await page.getByRole('button',{name:'Generate loop',exact:true}).click();expect(calls).toBe(0);await expect(edit(page)).toContainText('1.50');
 await edit(page).click();await input(page).fill('');const center=page.getByRole('button',{name:'Move circle',exact:true}),b=(await center.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+15,b.y+b.height/2+12,{steps:4});await page.mouse.up();await expect(edit(page)).toContainText('1.50');await expect(radius(page)).toHaveAttribute('aria-valuenow','1500');
 await edit(page).click();await input(page).fill('0.6');await page.getByRole('button',{name:'Done editing radius'}).click();await page.getByRole('button',{name:'Fit circle',exact:true}).click();await edit(page).click();await input(page).fill('');const sb=(await radius(page).boundingBox())!;await page.mouse.move(sb.x+sb.width/2,sb.y+sb.height/2);await page.mouse.down();await page.mouse.move(sb.x+sb.width/2+15,sb.y+sb.height/2+15,{steps:4});await page.mouse.up();await expect(edit(page)).toBeVisible();expect(await edit(page).innerText()).toMatch(/0\.\d{2}/);expect(Number(await radius(page).getAttribute('aria-valuenow'))).toBeGreaterThan(600);expect(calls).toBe(0);
});
test('unavailable, quota, unroutable and shape errors stay distinct; no partial route or GPX',async({page})=>{
 let n=0;const cases=[['unavailable','Routing service unavailable (HTTP 502). Try later.'],['unavailable','Routing quota exceeded.'],['unroutable','No cycling route connects these circle waypoints.'],['shape-tolerance','Roads connect, but the route is too far from this circle.']];
 await page.route('**/api/loop',r=>{const [status,message]=cases[n++],body=r.request().postDataJSON();return r.fulfill({json:{requestId:body.requestId,status,message,requests:1,providerRequests:1,retryAfterSeconds:status==='unavailable'?30:undefined}});});await page.goto('/');
 for(const[,message]of cases){await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('alert')).toContainText(message);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toHaveCount(0);}expect(n).toBe(4);
});
test('cancelled delayed result cannot overwrite the next generation; stale IDs and network failure are actionable',async({page})=>{
 let release!:()=>void,n=0;const gate=new Promise<void>(r=>release=r);await page.route('**/api/loop',async r=>{const body=r.request().postDataJSON();if(++n===1){await gate;try{await r.fulfill({json:await accepted(body)});}catch{}return;}if(n===2)return r.fulfill({json:await accepted(body)});if(n===3)return r.fulfill({json:{requestId:'stale',status:'unavailable',message:'stale',requests:0}});return r.abort();});await page.goto('/');
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect.poll(()=>n).toBe(1);await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('status',{name:'Route status',exact:true})).toContainText('Cancelled.');await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('status',{name:'Route status',exact:true})).toContainText('Loop found.');release();await page.waitForTimeout(30);await expect(page.getByRole('status',{name:'Route status',exact:true})).toContainText('Loop found.');
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('alert')).toContainText('invalid or stale response');await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Routing unavailable.');expect(n).toBe(4);
});
test('narrow and landscape editor remains usable without horizontal overflow',async({page},info)=>{await page.goto('/');for(const [width,height]of[[320,740],[390,844],[844,390],[1440,1100]]){await page.setViewportSize({width,height});await edit(page).click();await input(page).fill('10');await expect(page.getByRole('button',{name:'Done editing radius'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Done editing radius'}).click();await expect(edit(page)).toContainText('10.00');}await page.screenshot({path:`/tmp/great-circle-radius-done-${info.project.name}.png`,fullPage:true});});

test('touch editing and cancelled center drag keep a populated committed radius',async({page},info)=>{
 test.skip(info.project.name!=='phone','Touch-only');await page.goto('/');await edit(page).tap();await input(page).fill('0.75');await page.getByRole('button',{name:'Done editing radius'}).tap();await expect(edit(page)).toContainText('0.75');await edit(page).tap();await input(page).fill('');
 const handle=page.getByRole('button',{name:'Move circle',exact:true}),b=(await handle.boundingBox())!,x=b.x+b.width/2,y=b.y+b.height/2,cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+20,y:y+15,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await expect(edit(page)).toContainText('0.75');await expect(radius(page)).toHaveAttribute('aria-valuenow','750');
 await edit(page).tap();await input(page).fill('0.8');await page.screenshot({path:'/tmp/great-circle-radius-edit-phone.png',fullPage:true});await input(page).evaluate(el=>(el as HTMLInputElement).blur());await expect(edit(page)).toContainText('0.80');
});

test('actual loopback backend through Vite proxy fails gracefully without any configured key or provider send',async({page})=>{
 await page.goto('/');expect(await page.evaluate(async()=>await(await fetch('/api/health')).json())).toEqual({ok:true,configured:false,provider:'openrouteservice'});
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Routing service is not configured.');expect(await page.evaluate(()=>performance.getEntriesByName('great-circle-generation').map(e=>(e as PerformanceMeasure).detail).at(-1).providerRequests)).toBe(0);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toHaveCount(0);
});
