import {test,expect,type Page} from '@playwright/test';
const size=(page:Page)=>page.getByRole('slider',{name:'Circle radius',exact:true});
async function geometry(page:Page){return page.locator('.circle-layer').evaluate(el=>{
 const line=el.querySelector<SVGLineElement>('.size-radius')!,icon=el.querySelector<SVGSVGElement>('.size-chevron')!,button=el.querySelector('.size-handle')!,matrix=icon.getScreenCTM()!;
 const x=line.x2.baseVal.value-line.x1.baseVal.value,y=line.y2.baseVal.value-line.y1.baseVal.value,radius=Math.hypot(x,y),a=new DOMPoint(12,12).matrixTransform(matrix),b=new DOMPoint(16,12).matrixTransform(matrix),length=Math.hypot(b.x-a.x,b.y-a.y);
 const rect=button.getBoundingClientRect(),iconRect=icon.getBoundingClientRect();
 return {dx:x,dy:y,radius,dot:(x*(b.x-a.x)+y*(b.y-a.y))/radius/length,centerError:Math.hypot(a.x-rect.x-rect.width/2,a.y-rect.y-rect.height/2),boundsError:Math.hypot(iconRect.x+iconRect.width/2-rect.x-rect.width/2,iconRect.y+iconRect.height/2-rect.y-rect.height/2),fits:iconRect.width<=rect.width&&iconRect.height<=rect.height};
});}
async function verify(page:Page){const result=await geometry(page);expect(result.dot).toBeGreaterThan(.9999);expect(result.centerError).toBeLessThan(.01);expect(result.boundsError).toBeLessThan(.01);expect(result.fits).toBe(true);await expect(page.locator('.size-chevron path')).toHaveCount(1);await expect(page.locator('marker,.size-arrow-guide,[marker-start],[marker-end]')).toHaveCount(0);return result;}
async function point(page:Page,degrees:number){return page.locator('.size-radius').evaluate((el,degrees)=>{const line=el as SVGLineElement,m=line.getScreenCTM()!,radius=Math.hypot(line.x2.baseVal.value-line.x1.baseVal.value,line.y2.baseVal.value-line.y1.baseVal.value),angle=degrees*Math.PI/180;const p=new DOMPoint(line.x1.baseVal.value+Math.sin(angle)*radius,line.y1.baseVal.value-Math.cos(angle)*radius).matrixTransform(m);return{x:p.x,y:p.y};},degrees);}
test.beforeEach(async({page})=>{await page.route('**/tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#deded5"/><path d="M0 64H256M0 192H256M64 0V256M192 0V256" stroke="#fffdf7" stroke-width="9"/></svg>'}));await page.route('**/overpass-api.de/**',r=>r.abort());await page.route('**/api/loop',r=>r.abort());});
test('centered chevron retains 44px Size identity and contrasting currentColor in all eight palettes',async({page})=>{
 await page.goto('/');const value=await size(page).getAttribute('aria-valuenow');
 for(const theme of['light','dark'])for(const palette of['standard','red-green','blue-yellow','high-contrast']){
  const toggle=page.getByRole('button',{name:'Dark mode'});if(await toggle.getAttribute('aria-pressed')!==String(theme==='dark'))await toggle.click();await page.getByRole('button',{name:'Accessibility',exact:true}).click();await page.locator(`input[value="${palette}"]`).check();await page.keyboard.press('Escape');
  const styles=await size(page).evaluate(el=>{const s=getComputedStyle(el),start=getComputedStyle(document.querySelector('.start-handle')!),path=getComputedStyle(el.querySelector('path')!);const lum=(v:string)=>{const c=(v.match(/[\d.]+/g)??[]).map(Number).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};const a=lum(s.color),b=lum(s.backgroundColor);return{radius:s.borderRadius,width:s.width,height:s.height,color:s.color,border:s.borderTopColor,start:start.color,startStyle:start.borderTopStyle,stroke:path.stroke,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  expect(styles.radius).toBe('50%');expect(styles.width).toBe('44px');expect(styles.height).toBe('44px');expect(styles.stroke).toBe(styles.color);expect(styles.border).toBe(styles.color);expect(styles.contrast).toBeGreaterThanOrEqual(3);expect(styles.startStyle).toBe('double');if(palette!=='high-contrast')expect(styles.color).not.toBe(styles.start);await expect(size(page).locator('small')).toHaveText('Size');await expect(page.locator('.start-handle>span')).toHaveText('S');await expect(size(page)).toHaveAttribute('aria-valuenow',value!);await expect(page.locator('.size-chevron')).toHaveAttribute('aria-hidden','true');await expect(page.locator('.size-chevron')).toHaveCSS('pointer-events','none');await verify(page);
 }
 await size(page).press('ArrowUp');expect(Number(await size(page).getAttribute('aria-valuenow'))).toBe(Number(value)+50);await verify(page);
});
test('chevron is centered and points outward through eight pointer-drag directions',async({page},info)=>{
 await page.goto('/');const start=page.getByRole('slider',{name:'Start angle',exact:true});
 for(const degrees of[0,45,90,135,180,225,270,315]){
  await start.press('Home');for(let i=0;i<((degrees+180)%360)/15;i++)await start.press('PageUp');
  const target=await point(page,degrees),b=(await size(page).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:8});await page.mouse.up();const result=await verify(page);expect(result.dx/result.radius).toBeCloseTo(Math.sin(degrees*Math.PI/180),1);expect(result.dy/result.radius).toBeCloseTo(-Math.cos(degrees*Math.PI/180),1);await size(page).evaluate(el=>(el as HTMLElement).blur());await page.locator('.map-shell').screenshot({path:`review/size-chevron-overlay-${degrees}-${info.project.name}.png`});
 }
});
test('continuous drag, center preview and camera changes keep chevron aligned without drift',async({page})=>{
 await page.goto('/');const b=(await size(page).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
 for(const degrees of[120,105,90,75,60,45,30,15,0,-15,-30,-45]){const target=await point(page,degrees);await page.mouse.move(target.x,target.y,{steps:3});await verify(page);}await page.mouse.up();
 const center=page.getByRole('button',{name:'Move circle',exact:true}),c=(await center.boundingBox())!;await page.mouse.move(c.x+c.width/2,c.y+c.height/2);await page.mouse.down();await page.mouse.move(c.x+c.width/2+45,c.y+c.height/2+20,{steps:5});await page.waitForTimeout(680);await expect(center).toHaveAttribute('aria-pressed','true');await verify(page);await page.mouse.move(c.x+c.width/2+60,c.y+c.height/2+30,{steps:3});await verify(page);await page.mouse.up();await verify(page);
 await page.getByRole('button',{name:'Zoom out',exact:true}).click();await verify(page);await page.getByRole('button',{name:'Fit circle',exact:true}).click();await verify(page);await page.setViewportSize({width:900,height:650});await verify(page);
});

test('touch drag continuously rotates the overlay while preserving its centered bounds',async({page,context},info)=>{
 test.skip(info.project.name!=='mobile','Touch-only');await page.goto('/');const session=await context.newCDPSession(page),b=(await size(page).boundingBox())!;
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:1}]});
 for(const degrees of[120,90,60,30,0,-30,-60,-90]){const target=await point(page,degrees);await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...target,id:1}]});await expect.poll(async()=>{const current=await geometry(page);return Math.hypot(current.dx/current.radius-Math.sin(degrees*Math.PI/180),current.dy/current.radius+Math.cos(degrees*Math.PI/180));}).toBeLessThan(.05);const result=await verify(page);expect(result.dx/result.radius).toBeCloseTo(Math.sin(degrees*Math.PI/180),1);expect(result.dy/result.radius).toBeCloseTo(-Math.cos(degrees*Math.PI/180),1);}
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await verify(page);await session.detach();
});
test('overlay remains centered and visible at small projected radii',async({page},info)=>{
 await page.goto('/');const initial=await geometry(page),value=Number(await size(page).getAttribute('aria-valuenow'));
 await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();const input=page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true});await input.fill(String(Math.max(.5,value*43/initial.radius/1000)));await input.press('Enter');
 let result=await geometry(page);for(let i=0;i<5&&result.radius>53;i++){await page.getByRole('button',{name:'Zoom out',exact:true}).click();result=await geometry(page);}
 expect(result.radius).toBeGreaterThanOrEqual(34);expect(result.radius).toBeLessThan(53);await expect(page.locator('.size-chevron')).toBeVisible();await verify(page);await size(page).evaluate(el=>(el as HTMLElement).blur());await page.locator('.map-shell').screenshot({path:`review/size-chevron-overlay-small-${info.project.name}.png`});
});
