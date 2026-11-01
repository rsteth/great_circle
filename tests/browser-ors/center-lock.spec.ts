import {test,expect,type Page} from '@playwright/test';
import {createLoopPlanner} from '../../server/loop';
import {pointOnCircle,bearingTo} from '../../src/circle';
import {trackLength} from '../../src/routing/geo';
const center=(page:Page)=>page.getByRole('button',{name:'Move circle',exact:true});
const position=async(page:Page)=>{const b=(await center(page).boundingBox())!;return{x:b.x+b.width/2,y:b.y+b.height/2};};
const selection=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('great-circle.selection.v1')??'null')?.settings);
const geometry=(page:Page)=>Promise.all(['Circle radius','Start angle'].map(name=>page.getByRole('slider',{name,exact:true}).getAttribute('aria-valuenow')));
const ghost=(page:Page)=>page.locator('.center-lock-preview');
const camera=(page:Page)=>page.locator('.leaflet-map-pane').evaluate(el=>(el as HTMLElement).style.transform);
async function generate(page:Page){await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();}
test.beforeEach(async({page})=>{
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='127.0.0.1')return r.continue();if(u.hostname==='tile.openstreetmap.org')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#26262a"/></svg>'});return r.abort();});
 await page.route('**/api/loop',async r=>{const request=r.request().postDataJSON();const result=await createLoopPlanner({route:async()=>{const s=request.settings,points=Array.from({length:65},(_,i)=>pointOnCircle(s.center,s.circleRadiusM,bearingTo(s.center,s.start)+i*360/64));points[64]={...points[0]};return{points,distanceM:trackLength(points),waypoints:Array.from({length:9},(_,i)=>i*8),surface:[[0,64,3]]};}})(request,new AbortController().signal);await r.fulfill({json:result});});
});
test('variation has fine real values, persists and reaches planner without snapping or rounding',async({page})=>{
 await page.goto('/');const slider=page.getByRole('slider',{name:'Route variation',exact:true});await expect(slider).toHaveAttribute('min','0.1');await expect(slider).toHaveAttribute('max','0.3');await expect(slider).toHaveAttribute('step','0.001');await slider.press('Home');for(let i=0;i<7;i++)await slider.press('ArrowRight');await expect(slider).toHaveValue('0.107');await expect(slider).toHaveAttribute('aria-valuetext','10.7% distance variation');expect((await selection(page)).tolerance).toBe(.107);await page.reload();await expect(slider).toHaveValue('0.107');let sent:number|undefined;page.on('request',r=>{if(r.url().endsWith('/api/loop'))sent=r.postDataJSON().settings.tolerance;});await generate(page);expect(sent).toBe(.107);await slider.press('End');await expect(slider).toHaveValue('0.3');
});
test('locked taps, fast drags and map clicks preserve generated route; unlocked drag previews the circle before release commits without camera jump',async({page},info)=>{
 await page.goto('/');await generate(page);const before=await position(page),values=await geometry(page),cam=await camera(page);await center(page).click();await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();expect(await position(page)).toEqual(before);
 await page.mouse.move(before.x,before.y);await page.mouse.down();await page.mouse.move(before.x+50,before.y+25,{steps:4});await expect(ghost(page)).toHaveAttribute('data-unlocked','false');await page.mouse.up();expect(await position(page)).toEqual(before);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();
 const map=(await page.locator('.map').boundingBox())!;await page.mouse.click(map.x+45,map.y+map.height*.6);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();expect(await position(page)).toEqual(before);
 await page.mouse.move(before.x,before.y);await page.mouse.down();await page.mouse.move(before.x+60,before.y+25,{steps:4});await page.waitForTimeout(200);expect(Number(await ghost(page).evaluate(el=>getComputedStyle(el).opacity))).toBeLessThan(.8);await page.screenshot({path:`/tmp/great-circle-center-hold-progress-${info.project.name}.png`});await page.waitForTimeout(480);await expect(ghost(page)).toHaveAttribute('data-unlocked','true');expect((await position(page)).x-before.x).toBeCloseTo(60,0);expect((await position(page)).y-before.y).toBeCloseTo(25,0);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();await page.screenshot({path:`/tmp/great-circle-center-unlocking-${info.project.name}.png`});await page.mouse.up();await expect(ghost(page)).toHaveCount(0);const moved=await position(page);expect(moved.x-before.x).toBeCloseTo(60,0);expect(moved.y-before.y).toBeCloseTo(25,0);expect(await geometry(page)).toEqual(values);expect(await camera(page)).toEqual(cam);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toHaveCount(0);await expect(center(page)).toHaveAttribute('aria-pressed','false');
});
test('keyboard unlock is untimed and transactional, Escape/blur preserve route and Enter commits then relocks',async({page})=>{
 await page.goto('/');await generate(page);const before=await position(page);await center(page).press('ArrowRight');expect(await position(page)).toEqual(before);await center(page).press('Enter');await center(page).press('ArrowRight');expect(await position(page)).toEqual(before);await page.keyboard.press('Escape');await expect(ghost(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();
 await center(page).press('Enter');await center(page).press('Shift+ArrowRight');await center(page).press('Enter');expect((await position(page)).x-before.x).toBeCloseTo(48,0);await expect(center(page)).toHaveAttribute('aria-pressed','false');const after=await position(page);await center(page).press('ArrowRight');expect(await position(page)).toEqual(after);await generate(page);await center(page).press('Enter');await center(page).press('ArrowLeft');await page.getByRole('button',{name:'Generate loop',exact:true}).focus();await expect(ghost(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();
});
test('pending unlock cancels on Escape, blur, wheel and lost capture without clearing a route',async({page})=>{
 await page.goto('/');await generate(page);const originalSelection=await selection(page);
 for(const action of ['escape','blur','wheel','lost']){
  const p=await position(page);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(350);await page.mouse.move(p.x+35,p.y+10);await page.waitForTimeout(350);await expect(ghost(page)).toHaveAttribute('data-unlocked','false');
  if(action==='escape')await page.keyboard.press('Escape');else if(action==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else if(action==='wheel')await page.mouse.wheel(0,1);else await center(page).evaluate(el=>{for(let id=1;id<4;id++)if(el.hasPointerCapture(id))el.releasePointerCapture(id)});
  await page.mouse.up();await expect(ghost(page)).toHaveCount(0);expect(await selection(page)).toEqual(originalSelection);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();
 }
});
test('touch long-press elsewhere commits only after unlock; pan and extra pointers cancel without losing a route',async({page},info)=>{
 test.skip(info.project.name!=='phone','Touch-only');await page.goto('/');await generate(page);const cdp=await page.context().newCDPSession(page),map=(await page.locator('.map').boundingBox())!,p={x:map.x+map.width*.23,y:map.y+map.height*.52},original=await geometry(page);const before=await position(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await page.waitForTimeout(680);await expect(ghost(page)).toHaveAttribute('data-unlocked','true');expect(await position(page)).toEqual(before);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const moved=await position(page);expect(moved.x).toBeCloseTo(p.x,0);expect(moved.y).toBeCloseTo(p.y,0);expect(await geometry(page)).toEqual(original);await generate(page);const selected=await selection(page);
 // Map pan is allowed; the circle stays geographically fixed and its route survives.
 const q={x:map.x+map.width*.75,y:map.y+map.height*.45};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...q,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:q.x+30,y:q.y+15,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(ghost(page)).toHaveCount(0);expect(await selection(page)).toEqual(selected);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();
 const handle=await position(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...handle,id:3}]});await page.waitForTimeout(200);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...handle,id:3},{x:handle.x+65,y:handle.y-40,id:4}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await expect(ghost(page)).toHaveCount(0);expect(await selection(page)).toEqual(selected);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();
});
test('preview cancels on breakpoint/zoom and generating overlay, remains usable at 320px and landscape',async({page})=>{
 await page.goto('/');for(const [width,height]of[[320,568],[844,390]]){await page.setViewportSize({width,height});await page.getByRole('button',{name:'Fit circle',exact:true}).click();await center(page).focus();await page.waitForTimeout(100);await center(page).press('Enter');await center(page).press('ArrowLeft');await expect(ghost(page)).toHaveAttribute('data-unlocked','true');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(ghost(page)).toHaveCount(0);await center(page).press('Enter');await page.setViewportSize({width:width+5,height});await expect(ghost(page)).toHaveCount(0);}
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);await page.route('**/api/loop',async r=>{await gate;await r.abort()});await center(page).press('Enter');await page.getByRole('button',{name:'Generate loop',exact:true}).click();await expect(page.getByRole('dialog',{name:'Generating loop',exact:true})).toBeVisible();await expect(ghost(page)).toHaveCount(0);await page.getByRole('button',{name:'Cancel generation',exact:true}).click();release();
});

test('releasing an unlocked handle outside the map cancels; Start/Size holds cannot start center relocation',async({page})=>{
 await page.goto('/');await generate(page);const before=await position(page),saved=await selection(page),map=(await page.locator('.map').boundingBox())!;await page.mouse.move(before.x,before.y);await page.mouse.down();await page.mouse.move(map.x+map.width+20,before.y);await page.waitForTimeout(680);await page.mouse.up();await expect(ghost(page)).toHaveCount(0);expect(await selection(page)).toEqual(saved);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();
 for(const name of ['Start angle','Circle radius']){const b=(await page.getByRole('slider',{name,exact:true}).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(650);await expect(ghost(page)).toHaveCount(0);await page.mouse.up();}
 expect((await position(page)).x).toBeCloseTo(before.x,0);expect((await position(page)).y).toBeCloseTo(before.y,0);
});
test('touch map hold cancels after unlock on lost capture or pointer cancellation, retaining generated route',async({page},info)=>{
 test.skip(info.project.name!=='phone','Touch-only');await page.addInitScript(()=>document.addEventListener('pointerdown',event=>{(window as unknown as {lastPointer:number}).lastPointer=event.pointerId},true));await page.goto('/');await generate(page);const original=await selection(page),cdp=await page.context().newCDPSession(page),map=(await page.locator('.map').boundingBox())!,p={x:map.x+map.width*.25,y:map.y+map.height*.5};
 for(const mode of ['lost','cancel']){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await page.waitForTimeout(680);await expect(ghost(page)).toHaveAttribute('data-unlocked','true');if(mode==='lost')await page.locator('.map').evaluate(el=>el.releasePointerCapture((window as unknown as {lastPointer:number}).lastPointer));await cdp.send('Input.dispatchTouchEvent',{type:mode==='lost'?'touchEnd':'touchCancel',touchPoints:[]});await expect(ghost(page)).toHaveCount(0);expect(await selection(page)).toEqual(original);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();}
});

test('countdown drains full to empty with outward-only elasticity, stable hit area and reduced-motion fallback',async({page},info)=>{
 await page.goto('/');const p=await position(page),initial=await center(page).boundingBox(),ring=center(page).locator('.center-countdown'),circle=ring.locator('circle');
 await expect(ring).toHaveAttribute('data-active','false');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(650);await expect(ring).toHaveAttribute('data-active','false');await page.mouse.move(p.x+40,p.y);await expect(ring).toHaveAttribute('data-active','true');const start=Number(await circle.getAttribute('stroke-dashoffset'));expect(start).toBeLessThanOrEqual(0);expect(start).toBeGreaterThan(-.25);await expect(circle).toHaveAttribute('stroke-dasharray','1 1');await expect(circle).toHaveAttribute('pathLength','1');
 await page.waitForTimeout(180);const mid=Number(await circle.getAttribute('stroke-dashoffset'));expect(mid).toBeLessThan(start);expect(mid).toBeGreaterThan(-1);const geometry=await circle.evaluate(el=>{const style=getComputedStyle(el);return{r:parseFloat(style.getPropertyValue('r')),width:parseFloat(style.strokeWidth)}});expect(geometry.width).toBeGreaterThan(2);expect(geometry.r-geometry.width/2).toBeCloseTo(20,3);expect(await center(page).boundingBox()).toEqual(initial);expect(Number(await ghost(page).evaluate(el=>getComputedStyle(el).opacity))).toBeGreaterThan(.25);await page.screenshot({path:`/tmp/great-circle-countdown-elastic-${info.project.name}.png`});
 await page.waitForTimeout(480);await expect(ring).toHaveAttribute('data-unlocked','true');await expect(circle).toHaveAttribute('stroke-dashoffset','-1');await expect(center(page)).toHaveAttribute('aria-pressed','true');await page.mouse.up();await page.waitForTimeout(200);await expect(ring).toHaveAttribute('data-active','false');expect(Number(await ring.evaluate(el=>getComputedStyle(el).opacity))).toBe(0);expect((await position(page)).x-p.x).toBeCloseTo(40,0);
 const after=await position(page);await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.move(after.x,after.y);await page.mouse.down();await page.mouse.move(after.x+40,after.y);await page.waitForTimeout(200);const reduced=await circle.evaluate(el=>{const s=getComputedStyle(el);return{animation:s.animationName,r:parseFloat(s.getPropertyValue('r')),width:parseFloat(s.strokeWidth)}});expect(reduced.animation).toBe('none');expect(reduced.width).toBeLessThanOrEqual(5);expect(reduced.r-reduced.width/2).toBeCloseTo(20,3);await page.mouse.up();expect(await position(page)).toEqual(after);await expect(ghost(page)).toHaveCount(0);
});

// Genuine input and the real animation-frame clock exercise the pending phase.
// Movement continues past the original deadline, so a restarted timer cannot pass.
test('continuous center drag unlocks once, catches up and carries all controls with grab offset',async({page},info)=>{
 await page.goto('/');await generate(page);
 const before=await position(page),saved=await selection(page),cam=await camera(page),values=await geometry(page);
 const controls=async()=>Promise.all(['Start angle','Circle radius'].map(async name=>{const b=(await page.getByRole('slider',{name,exact:true}).boundingBox())!;return{x:b.x+b.width/2,y:b.y+b.height/2};}));
 const original=await controls();
 const touch=info.project.name==='phone',cdp=touch?await page.context().newCDPSession(page):undefined;
 const input=async(type:'start'|'move'|'end'|'cancel',x:number,y:number)=>{
  if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:({start:'touchStart',move:'touchMove',end:'touchEnd',cancel:'touchCancel'} as const)[type],touchPoints:type==='end'||type==='cancel'?[]:[{x,y,id:1}]});
  else if(type==='start'){await page.mouse.move(x,y);await page.mouse.down();}else if(type==='move')await page.mouse.move(x,y);else if(type==='end')await page.mouse.up();else await page.keyboard.press('Escape');
 };
 // Normal taps and motion within the face must never arm an unlock.
 await input('start',before.x+8,before.y+5);await input('move',before.x+12,before.y+5);await page.waitForTimeout(650);await expect(ghost(page)).toHaveCount(0);await input('end',0,0);expect(await selection(page)).toEqual(saved);
 for(const pendingEnd of ['cancel','end'] as const){await input('start',before.x,before.y);await input('move',before.x+40,before.y);await page.waitForTimeout(200);await input(pendingEnd,before.x+40,before.y);if(!touch&&pendingEnd==='cancel')await page.mouse.up();await page.waitForTimeout(650);await expect(ghost(page)).toHaveCount(0);expect(await position(page)).toEqual(before);expect(await selection(page)).toEqual(saved);}
 for(const outcome of ['cancel','end']){
  await input('start',before.x+8,before.y+5);
  await input('move',before.x+40,before.y+10);
  for(let i=0;i<9;i++){await page.waitForTimeout(90);await input('move',before.x+45+i*7,before.y+15+i*2);}
  await expect(ghost(page)).toHaveAttribute('data-unlocked','true');
  // Latest pointer minus the initial grab offset; catches up without another event.
  await expect.poll(async()=>(await position(page)).x-before.x).toBeCloseTo(93,0);const moved=await position(page);expect(moved.x-before.x).toBeCloseTo(93,0);expect(moved.y-before.y).toBeCloseTo(26,0);
  const followed=await controls();for(let i=0;i<2;i++){expect(followed[i].x-original[i].x).toBeCloseTo(93,0);expect(followed[i].y-original[i].y).toBeCloseTo(26,0);}
  expect(await geometry(page)).toEqual(values);expect(await camera(page)).toEqual(cam);expect(await selection(page)).toEqual(saved);
  await page.screenshot({path:`/tmp/great-circle-continuous-center-${info.project.name}.png`});
  await input(outcome as 'cancel'|'end',before.x+101,before.y+31);await expect(ghost(page)).toHaveCount(0);await expect(center(page)).toHaveAttribute('aria-pressed','false');
  if(outcome==='cancel'){expect(await position(page)).toEqual(before);expect(await selection(page)).toEqual(saved);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toBeVisible();}
  else{expect((await position(page)).x-before.x).toBeCloseTo(93,0);await expect(page.getByRole('button',{name:'Download GPX',exact:true})).toHaveCount(0);}
 }
});

test('release and cancellation before the deadline cannot unlock later; next drag uses its latest pending position',async({page})=>{
 await page.goto('/');const before=await position(page),saved=await selection(page);
 for(const cancel of [false,true]){await page.mouse.move(before.x,before.y);await page.mouse.down();await page.mouse.move(before.x+40,before.y);await page.waitForTimeout(200);if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(650);await expect(ghost(page)).toHaveCount(0);expect(await position(page)).toEqual(before);expect(await selection(page)).toEqual(saved);}
 await page.mouse.move(before.x,before.y);await page.mouse.down();await page.mouse.move(before.x+40,before.y);await page.waitForTimeout(300);await page.mouse.move(before.x+80,before.y+30);await expect(ghost(page)).toHaveAttribute('data-unlocked','true');expect((await position(page)).x-before.x).toBeCloseTo(80,0);expect((await position(page)).y-before.y).toBeCloseTo(30,0);await page.mouse.up();
});
