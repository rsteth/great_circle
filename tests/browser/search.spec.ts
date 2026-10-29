import {test,expect} from '@playwright/test';
const photon='**/photon.komoot.io/api/**';
const data=(name:string,lat=52.52,lon=13.405)=>({features:[{geometry:{type:'Point',coordinates:[lon,lat]},properties:{name,country:'Test'}}]});
test.beforeEach(async({page})=>{
  await page.route('**/tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#858585"/></svg>'}));
});
test('manual global search, stale response suppression, cache, keyboard and center selection',async({page})=>{
  let queries:string[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  await page.route(photon,async r=>{const url=new URL(r.request().url());queries.push(url.searchParams.get('q')!);expect([...url.searchParams.keys()].sort()).toEqual(['limit','q']);if(queries.length===1){await gate;await r.fulfill({json:data('Old result')}).catch(()=>{});}else await r.fulfill({json:data('Berlin')});});
  await page.goto('/');const input=page.getByRole('searchbox',{name:'Search here'});await input.fill('Old place');expect(queries).toHaveLength(0);await input.press('Enter');await expect(page.getByText('Searching…',{exact:true})).toBeVisible();
  await input.fill('Berlin');await page.waitForTimeout(1100);await input.press('Enter');await expect(page.getByRole('button',{name:'Berlin, Test',exact:true})).toBeVisible();release();await page.waitForTimeout(100);await expect(page.getByText('Old result')).toHaveCount(0);
  const sizeBefore=await page.getByRole('slider',{name:'Circle radius',exact:true}).getAttribute('aria-valuenow');await page.getByRole('button',{name:'Berlin, Test',exact:true}).click();
  await expect(page.locator('.coordinate-inputs input').first()).toHaveValue('52.52000');await expect(page.locator('.coordinate-inputs input').last()).toHaveValue('13.40500');await expect(page.getByRole('slider',{name:'Circle radius',exact:true})).toHaveAttribute('aria-valuenow',sizeBefore!);
  await input.fill('Berlin');await input.press('Enter');await expect(page.getByRole('button',{name:'Berlin, Test',exact:true})).toBeVisible();expect(queries).toHaveLength(2);await input.press('Escape');await expect(page.getByRole('button',{name:'Berlin, Test',exact:true})).toHaveCount(0);await expect(input).toBeFocused();
});
test('search errors, empty response, cancel and no accidental map changes',async({page})=>{
  let mode='empty';await page.route(photon,async r=>{if(mode==='error')await r.fulfill({status:503,body:'busy',headers:{'Retry-After':'30'}});else if(mode==='wait'){await new Promise(resolve=>setTimeout(resolve,500));await r.fulfill({json:data('Late')}).catch(()=>{});}else await r.fulfill({json:{features:[]}});});
  await page.goto('/');const input=page.getByRole('searchbox',{name:'Search here'}), before=await page.locator('.coordinate-inputs input').evaluateAll(inputs=>inputs.map(x=>(x as HTMLInputElement).value));
  await input.fill('Nowhere');await input.press('Enter');await expect(page.getByText('No places found. Try another name.')).toBeVisible();await input.press('Escape');
  mode='wait';await page.waitForTimeout(1100);await input.fill('Delayed');await input.press('Enter');await page.getByRole('button',{name:'Cancel place search'}).click();await page.waitForTimeout(550);await expect(page.getByText('Late')).toHaveCount(0);
  mode='error';await page.waitForTimeout(1100);await input.fill('Failure');await input.press('Enter');await expect(page.getByText('Place search unavailable (503). Try later.')).toBeVisible();
  expect(await page.locator('.coordinate-inputs input').evaluateAll(inputs=>inputs.map(x=>(x as HTMLInputElement).value))).toEqual(before);
});
test('location control remains disabled and cannot disclose device coordinates',async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(navigator,'geolocation',{configurable:true,get(){throw new Error('Unexpected location access');}});});
  await page.goto('/');const locate=page.getByRole('button',{name:'Locate me (temporarily unavailable)',exact:true});await expect(locate).toBeDisabled();
  const zoom=(await page.getByRole('button',{name:'Zoom in',exact:true}).boundingBox())!,b=(await locate.boundingBox())!;expect(b.y+b.height).toBeLessThanOrEqual(zoom.y);
});
