import {test,expect,type Page} from '@playwright/test';
async function frame(page:Page){return page.locator('.circle-layer').evaluate(el=>{const c=el.querySelector('.target-center')!.getBoundingClientRect(),s=el.querySelector('.start-handle')!.getBoundingClientRect();const x=c.x+c.width/2,y=c.y+c.height/2;return{x,y,r:Math.hypot(s.x+s.width/2-x,s.y+s.height/2-y)};});}
function point(f:{x:number;y:number;r:number},angle:number,scale=1){return{x:f.x+Math.sin(angle*Math.PI/180)*f.r*scale,y:f.y-Math.cos(angle*Math.PI/180)*f.r*scale};}
const size=(p:Page)=>p.getByRole('slider',{name:'Circle radius',exact:true}),start=(p:Page)=>p.getByRole('slider',{name:'Start angle',exact:true});
async function camera(page:Page){return page.locator('.map').evaluate(el=>({pane:(el.querySelector('.leaflet-map-pane') as HTMLElement).style.transform,tiles:[...el.querySelectorAll('.leaflet-tile')].map(x=>({src:(x as HTMLImageElement).src,transform:(x as HTMLElement).style.transform,width:x.getBoundingClientRect().width,x:x.getBoundingClientRect().x,y:x.getBoundingClientRect().y})),scale:el.querySelector('.leaflet-control-scale-line')?.textContent}));}
async function begin(page:Page){const b=(await size(page).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();}
test.beforeEach(async({page})=>{await page.route('**/tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#aaa"/><text x="8" y="20">Offline fixture map</text></svg>'}));});

test('radius readout edits km, validates, commits Enter/blur and cancels Escape up to 100 km radius',async({page})=>{
 let requests=0;await page.route('**/overpass-api.de/**',r=>{requests++;return r.abort();});await page.goto('/');await page.waitForLoadState('networkidle');const before=await camera(page);
 await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();let input=page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true});await expect(input).toBeFocused();
 for(const value of ['101','0.49','-2','']){await input.fill(value);await input.press('Enter');await expect(input).toHaveAttribute('aria-invalid','true');await expect(page.getByText('Enter a radius from 0.5 to 100 km.')).toBeVisible();}
 await input.press('Escape');await expect(page.getByRole('button',{name:'Edit circle radius',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();input=page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true});await input.fill('100');await input.press('Enter');
 await expect(size(page)).toHaveAttribute('aria-valuemax','100000');await expect(size(page)).toHaveAttribute('aria-valuenow','100000');await expect(page.getByRole('button',{name:'Edit circle radius',exact:true})).toContainText('100.00');expect(await camera(page)).toEqual(before);
 await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('alert')).toContainText('too large for the shared map service');expect(requests).toBe(0);
 await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();input=page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true});await input.fill('1.25');await input.press('Tab');await expect(size(page)).toHaveAttribute('aria-valuenow','1250');
 await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();input=page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true});await input.fill('2');await input.press('Escape');await expect(size(page)).toHaveAttribute('aria-valuenow','1250');
 await size(page).press('End');await expect(size(page)).toHaveAttribute('aria-valuenow','100000');await size(page).press('ArrowUp');await expect(size(page)).toHaveAttribute('aria-valuenow','100000');
});

test('Size follows pointer around Start both directions without camera changes or Start rotation',async({page})=>{
 await page.goto('/');await page.waitForLoadState('networkidle');const f=await frame(page),before=await camera(page),bearing=await start(page).getAttribute('aria-valuenow');
 for(const angles of [[145,165,179,180,181,195,215],[215,195,181,180,179,165,145]]){
  await begin(page);
  for(const a of angles){const p=point(f,a,1.04);await page.mouse.move(p.x,p.y,{steps:3});
   const positions=await page.locator('.circle-layer').evaluate(el=>{const a=el.querySelector('.start-handle')!.getBoundingClientRect(),b=el.querySelector('.size-handle')!.getBoundingClientRect();return{distance:Math.hypot(a.x-b.x,a.y-b.y)};});expect(positions.distance).toBeGreaterThanOrEqual(59);await expect(start(page)).toHaveAttribute('aria-valuenow',bearing!);
  }
  await page.mouse.up();expect(await camera(page)).toEqual(before);
 }
 await page.screenshot({path:`/tmp/great-circle-radius-${test.info().project.name}.png`,fullPage:false});
});

test('circle, radial guide and handles share the same transform through pan/zoom/resize',async({page})=>{
 await page.goto('/');
 async function synchronized(){expect(await page.locator('.circle-layer').evaluate(el=>{
  const svg=el.querySelector('svg')!,line=el.querySelector('.size-radius')!,center=el.querySelector('.target-center')!,handle=el.querySelector('.size-handle')!.getBoundingClientRect();
  const matrix=svg.getScreenCTM()!,p=svg.createSVGPoint();p.x=Number(line.getAttribute('x2'));p.y=Number(line.getAttribute('y2'));const screen=p.matrixTransform(matrix);
  return el.contains(el.querySelector('.target-ring'))&&Math.hypot(screen.x-handle.x-handle.width/2,screen.y-handle.y-handle.height/2)<1&&Number(center.getAttribute('cx'))===Number(line.getAttribute('x1'));
 })).toBe(true);}
 expect(await page.locator('.circle-layer').evaluate(el=>Number(getComputedStyle(el.querySelector('svg')!).zIndex)<Number(getComputedStyle(el.querySelector('.start-handle')!).zIndex))).toBe(true);
 await synchronized();await page.getByRole('button',{name:'Zoom in',exact:true}).click();await synchronized();
 const f=await frame(page);await page.mouse.move(f.x-30,f.y-25);await page.mouse.down();await page.mouse.move(f.x+35,f.y+15,{steps:7});await page.mouse.up();await synchronized();
 for(const [width,height]of[[390,844],[844,390],[1280,900]]){await page.setViewportSize({width,height});await expect.poll(async()=>Math.round((await page.locator('.map').boundingBox())!.width)).toBeGreaterThan(200);await synchronized();}
 const scale=page.locator('.leaflet-control-scale-line');await expect(scale).toHaveCSS('border-top-width','0px');expect(await scale.evaluate(el=>getComputedStyle(el).fontFamily.includes('monospace'))).toBe(false);
});

test('touch Size moves around safe Start zone and touch cancel restores geometry',async({page},info)=>{
 test.skip(info.project.name!=='mobile','Touch-only');await page.goto('/');await page.waitForLoadState('networkidle');const before=await camera(page),f=await frame(page),r=await size(page).getAttribute('aria-valuenow'),a=await start(page).getAttribute('aria-valuenow'),b=(await size(page).boundingBox())!,cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+22,y:b.y+22,id:1}]});await expect(size(page)).toBeFocused();
 for(const angle of[150,170,179,180,181,195,220]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point(f,angle,1.08),id:1}]});await page.evaluate(()=>new Promise(requestAnimationFrame));await expect(start(page)).toHaveAttribute('aria-valuenow',a!);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point(f,220,1.08),id:1},{x:f.x,y:f.y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await expect(size(page)).toHaveAttribute('aria-valuenow',r!);await expect(start(page)).toHaveAttribute('aria-valuenow',a!);expect(await camera(page)).toEqual(before);
});
