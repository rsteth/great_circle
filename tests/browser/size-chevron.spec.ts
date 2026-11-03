import {test,expect,type Page} from '@playwright/test';
const size=(page:Page)=>page.getByRole('slider',{name:'Circle radius',exact:true});
async function geometry(page:Page){return page.locator('.circle-layer').evaluate(el=>{
 const line=el.querySelector<SVGLineElement>('.size-radius')!,guide=el.querySelector<SVGLineElement>('.size-arrow-guide'),marker=el.querySelector<SVGMarkerElement>('#size-arrow')!;
 const x=line.x2.baseVal.value-line.x1.baseVal.value,y=line.y2.baseVal.value-line.y1.baseVal.value;
 const angle=marker.orientAngle.baseVal.value*Math.PI/180;
 return {dx:x,dy:y,radius:Math.hypot(x,y),dot:(x*Math.cos(angle)+y*Math.sin(angle))/Math.hypot(x,y),guideStart:guide?Math.hypot(guide.x1.baseVal.value-line.x1.baseVal.value,guide.y1.baseVal.value-line.y1.baseVal.value):null,guideForward:guide?((guide.x2.baseVal.value-guide.x1.baseVal.value)*x+(guide.y2.baseVal.value-guide.y1.baseVal.value)*y):null};
});}
test.beforeEach(async({page})=>{
 await page.route('**/tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#deded5"/><path d="M0 64H256M0 192H256M64 0V256M192 0V256" stroke="#fffdf7" stroke-width="9"/></svg>'}));
 await page.route('**/overpass-api.de/**',r=>r.abort());await page.route('**/api/loop',r=>r.abort());
});
test('circular Size retains identity and palette color in all eight presentations',async({page})=>{
 await page.goto('/');const value=await size(page).getAttribute('aria-valuenow');
 for(const theme of['light','dark'])for(const palette of['standard','red-green','blue-yellow','high-contrast']){
  const toggle=page.getByRole('button',{name:'Dark mode'});if(await toggle.getAttribute('aria-pressed')!==String(theme==='dark'))await toggle.click();
  await page.getByRole('button',{name:'Accessibility',exact:true}).click();await page.locator(`input[value="${palette}"]`).check();await page.keyboard.press('Escape');
  const styles=await size(page).evaluate(el=>{const s=getComputedStyle(el),start=getComputedStyle(document.querySelector('.start-handle')!),accent=getComputedStyle(document.querySelector('.primary')!);return{radius:s.borderRadius,width:s.width,height:s.height,color:s.color,border:s.borderTopColor,accent:accent.backgroundColor,start:start.borderTopColor,startStyle:start.borderTopStyle,text:el.textContent};});
  expect(styles.radius).toBe('50%');expect(styles.width).toBe('44px');expect(styles.height).toBe('44px');expect(styles.color).toBe(styles.accent);expect(styles.border).toBe(styles.accent);expect(styles.startStyle).toBe('double');if(palette!=='high-contrast')expect(styles.color).not.toBe(styles.start);expect(styles.text).toBe('Size');await expect(size(page).locator('span,svg')).toHaveCount(0);await expect(page.locator('.start-handle>span')).toHaveText('S');expect(styles.text).not.toMatch(/[↔←→↑↓‹›<>]/);await expect(size(page)).toHaveAttribute('aria-valuenow',value!);
 }
});
test('one center-side chevron points outward toward Size at every cardinal angle',async({page},info)=>{
 await page.goto('/');const start=page.getByRole('slider',{name:'Start angle',exact:true});await start.press('Home');for(let i=0;i<3;i++)await start.press('PageUp');
 const value=await size(page).getAttribute('aria-valuenow');
 for(const [name,degrees]of[['up',0],['right',90],['down',180],['left',270]]as const){
  const point=await page.locator('.size-radius').evaluate((el,degrees)=>{const line=el as SVGLineElement,m=line.getScreenCTM()!,radius=Math.hypot(line.x2.baseVal.value-line.x1.baseVal.value,line.y2.baseVal.value-line.y1.baseVal.value),angle=degrees*Math.PI/180;const p=new DOMPoint(line.x1.baseVal.value+Math.sin(angle)*radius,line.y1.baseVal.value-Math.cos(angle)*radius).matrixTransform(m);return{x:p.x,y:p.y};},degrees);
  await page.mouse.click(point.x,point.y);await expect(page.locator('.size-arrow-guide')).toHaveAttribute('marker-start','url(#size-arrow)');expect(await page.locator('.size-arrow-guide').getAttribute('marker-end')).toBeNull();await expect(page.locator('#size-arrow path')).toHaveCount(1);
  const result=await geometry(page);expect(result.dx/result.radius).toBeCloseTo(Math.sin(degrees*Math.PI/180),1);expect(result.dy/result.radius).toBeCloseTo(-Math.cos(degrees*Math.PI/180),1);expect(result.dot).toBeGreaterThan(.9999);expect(result.guideStart).toBeCloseTo(28,4);await expect(size(page)).toHaveAttribute('aria-valuenow',value!);
  await page.locator('.map-shell').screenshot({path:`review/size-chevron-${name}-${info.project.name}.png`});
 }
});
test('chevron still points outward when a small projected circle reverses trimmed guide endpoints',async({page},info)=>{
 await page.goto('/');
 // Keyboard resizing preserves camera, permitting an exact projected radius in the 34–53px overlap range.
 const initial=await geometry(page),value=Number(await size(page).getAttribute('aria-valuenow'));
 await page.getByRole('button',{name:'Edit circle radius',exact:true}).click();const input=page.getByRole('spinbutton',{name:'Circle radius (km)',exact:true});await input.fill(String(Math.max(.5,value*43/initial.radius/1000)));await input.press('Enter');
 // If the minimum physical radius remains large on this camera, one zoom step reaches the overlap band.
 let result=await geometry(page);for(let i=0;i<5&&result.radius>53;i++){await page.getByRole('button',{name:'Zoom out',exact:true}).click();result=await geometry(page);}
 expect(result.radius).toBeGreaterThanOrEqual(34);expect(result.radius).toBeLessThan(53);expect(result.guideForward).toBeLessThan(0);expect(result.dot).toBeGreaterThan(.9999);expect(result.guideStart).toBeCloseTo(28,4);await page.locator('.map-shell').screenshot({path:`review/size-chevron-small-${info.project.name}.png`});
});
