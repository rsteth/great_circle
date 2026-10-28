import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { ringRoads, selectCompleteWays } from '../corridor-fixtures';
import { center } from '../fixtures';
import type { Corridor } from '../../src/routing/coverage';
function coverageFromQuery(query: string): Corridor {
  const matches=[...query.matchAll(/way\(around:([^)]+)\)/g)].map(match=>match[1].split(',').map(Number));
  const [width,...points]=matches[0],line=[];for(let i=0;i<points.length;i+=2)line.push({lat:points[i],lon:points[i+1]});
  return{kind:'corridor',center,line,halfWidthM:width,clipMarginM:25,patches:matches.slice(1).map(([radiusM,lat,lon])=>({kind:'disk',center:{lat,lon},radiusM}))};
}
test.beforeEach(async({page})=>{await page.route('**/tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#aaa"/><text x="8" y="20">Offline corridor fixture</text></svg>'}));});
test('adaptive bridge check waits politely, returns complete geometry and exports the real fixture loop',async({page},info)=>{
 await page.clock.install();
 await page.addInitScript(() => { const original = performance.measure.bind(performance); Object.defineProperty(performance, 'measure', { configurable: true, value: (name: string, options?: string | PerformanceMeasureOptions, end?: string) => { if (name === 'great-circle-generation' && typeof options === 'object') (window as unknown as { routeTiming: unknown }).routeTiming = options.detail; return original(name, options, end); } }); });
 let requests=0;const shapes:Corridor[]=[];
 await page.route('**/overpass-api.de/api/interpreter',r=>{requests++;const q=new URLSearchParams(r.request().postData()!).get('data')!,coverage=coverageFromQuery(q);shapes.push(coverage);return r.fulfill({json:selectCompleteWays(ringRoads(true),coverage)});});
 await page.goto('/');await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();await page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true}).fill('2');await page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true}).press('Enter');
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('status',{name:'Route status'})).toContainText('Waiting');expect(requests).toBe(1);
 await page.clock.fastForward(31000);await expect(page.getByText('Loop found.',{exact:true})).toBeVisible();expect(requests).toBe(2);expect(shapes.map(shape=>shape.patches.length)).toEqual([0,2]);
 const result=await page.evaluate(()=> (window as unknown as { routeTiming: { requests: number; networkAttempts: unknown[] } }).routeTiming);expect(result.requests).toBe(2);expect(result.networkAttempts).toHaveLength(2);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download GPX',exact:true}).click();const file=await download;expect(file.suggestedFilename()).toContain('13.6km');
 await page.screenshot({path:`/tmp/great-circle-corridor-${info.project.name}.png`,fullPage:info.project.name==='desktop'});
});
test('cancel during expansion cooldown prevents another request and stale updates',async({page})=>{
 await page.clock.install();let requests=0;
 await page.route('**/overpass-api.de/api/interpreter',r=>{requests++;const query=new URLSearchParams(r.request().postData()!).get('data')!;return r.fulfill({json:selectCompleteWays(ringRoads(true),coverageFromQuery(query))});});
 await page.goto('/');await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();await page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true}).fill('2');await page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true}).press('Enter');
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('status',{name:'Route status'})).toContainText('Waiting');await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.clock.fastForward(40000);expect(requests).toBe(1);await expect(page.getByRole('status',{name:'Route status'})).toContainText('Cancelled.');await expect(page.getByRole('button',{name:'Download GPX'})).toHaveCount(0);
});
test('empty returned corridor is an honest one-request failure',async({page})=>{
 let requests=0;await page.route('**/overpass-api.de/api/interpreter',r=>{requests++;return r.fulfill({json:{elements:[]}});});await page.goto('/');await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('alert')).toContainText('No usable cycling network');await expect(page.getByRole('status',{name:'Route status'})).toContainText('No loop found.');expect(requests).toBe(1);await expect(page.getByRole('button',{name:'Download GPX'})).toHaveCount(0);
});

test('replayed actual Vancouver data recovers a valid loop with junction-anchor fallback',async({page},info)=>{
 await page.clock.install();let requests=0;
 const snapshots=['initial','expanded'].map(phase=>JSON.parse(gunzipSync(readFileSync(new URL(`../data/vancouver-corridor-${phase}-2026-10-28.osm.json.gz`,import.meta.url))).toString()));
 await page.route('**/overpass-api.de/api/interpreter',r=>r.fulfill({json:snapshots[requests++]}));await page.goto('/');
 const trigger=page.getByRole('button',{name:'Settings',exact:true});if(await trigger.count())await trigger.click();await page.getByText('Coordinates',{exact:true}).click();
 await page.getByRole('textbox',{name:'Latitude',exact:true}).fill('49.289');await page.getByRole('textbox',{name:'Longitude',exact:true}).fill('-123.128');await page.getByRole('button',{name:'Set pin',exact:true}).click();if(await trigger.count())await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();await page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true}).fill('0.5');await page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true}).press('Enter');await page.getByRole('slider',{name:'Route variation',exact:true}).fill('0.3');
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('status',{name:'Route status'})).toContainText('Waiting');await page.clock.fastForward(31000);
 await expect(page.getByRole('status',{name:'Route status'})).toContainText('Loop found.');expect(requests).toBe(2);await expect(page.getByRole('alert')).toHaveCount(0);const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download GPX',exact:true}).click();const download=await pending;expect(download.suggestedFilename()).toContain('3.7km');
 await page.screenshot({path:`/tmp/great-circle-corridor-actual-replay-${info.project.name}.png`,fullPage:info.project.name==='desktop'});
});
