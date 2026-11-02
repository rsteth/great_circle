import { writeFile } from 'node:fs/promises';
import { circleFixture } from '../fixtures';
import { test, expect } from '@playwright/test';
const palettes = ['standard', 'red-green', 'blue-yellow', 'high-contrast'];
test.beforeEach(async ({page}) => {
  await page.route('**/tile.openstreetmap.org/**', r => r.fulfill({contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#deded5"/><path d="M0 64H256M0 192H256M64 0V256M192 0V256" stroke="#fffdf7" stroke-width="9"/><text x="8" y="22">Offline map fixture</text></svg>'}));
});
test('all eight appearance combinations retain circle state and meet rendered text contrast', async ({page}, info) => {
 await page.goto('/');
 for(const selector of ['.leaflet-control-zoom','.map-topline .map-button','.size-handle','.start-handle']) {const a=(await page.locator('.locate-button').boundingBox())!,b=(await page.locator(selector).boundingBox())!;expect(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y).toBe(false);}
 const report: unknown[] = [];
 const radius = await page.getByRole('slider',{name:'Circle radius',exact:true}).getAttribute('aria-valuenow');
 for (const theme of ['light','dark']) {
  if (await page.getByRole('button',{name:'Dark mode',exact:true}).getAttribute('aria-pressed') !== String(theme==='dark')) await page.getByRole('button',{name:'Dark mode',exact:true}).click();
  for (const palette of palettes) {
   await page.getByRole('button',{name:'Accessibility',exact:true}).click();
   await page.locator(`input[value="${palette}"]`).check();
   await expect(page.locator('html')).toHaveAttribute('data-palette',palette);
   const failures = await page.evaluate(() => {
    function rgb(s:string) {return (s.match(/[\d.]+/g)??[]).map(Number);}
    function l(c:number[]) {const a=c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*a[0]+.7152*a[1]+.0722*a[2];}
    const checks = [...document.querySelectorAll<HTMLElement>('body *')].flatMap(el=>{
     const style=getComputedStyle(el),color=rgb(style.color); if(!el.getClientRects().length || ['SVG','PATH'].includes(el.tagName) || ![...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim()) || el.closest('.leaflet-tile-pane,.center-lock-announcement') || style.opacity==='0') return []; let p:HTMLElement|null=el,bg:number[]=[];
     while(p){bg=rgb(getComputedStyle(p).backgroundColor);if(bg.length===3||bg[3]>0.99)break;p=p.parentElement;}
     const ratio=(Math.max(l(color),l(bg))+.05)/(Math.min(l(color),l(bg))+.05);return [{text:el.textContent?.trim().slice(0,100),selector:el.tagName.toLowerCase()+'.'+el.className,ratio,required:parseFloat(style.fontSize)>=24 || parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700?3:4.5}];
    });
    for(const el of document.querySelectorAll<HTMLInputElement>('input:not([type=radio]):not([type=range]),select')){
     if(!el.getClientRects().length)continue;
     let p:HTMLElement|null=el,bg:number[]=[];while(p){bg=rgb(getComputedStyle(p).backgroundColor);if(bg.length===3||bg[3]>.99)break;p=p.parentElement;}
     for(const part of el.getAttribute('placeholder')?['text','placeholder']:['text']){
      const color=rgb(getComputedStyle(el,part==='placeholder'?'::placeholder':null).color);
      const ratio=(Math.max(l(color),l(bg))+.05)/(Math.min(l(color),l(bg))+.05);checks.push({text:part,selector:el.tagName.toLowerCase()+'.'+el.className,ratio,required:4.5});
     }
    }
    for(const el of document.querySelectorAll<HTMLElement>('.appearance-button,.palette-option,.circle-handle')){
     if(!el.getClientRects().length)continue;const style=getComputedStyle(el),a=l(rgb(style.borderTopColor));let p:HTMLElement|null=el,bg:number[]=[];while(p){bg=rgb(getComputedStyle(p).backgroundColor);if(bg.length===3||bg[3]>.99)break;p=p.parentElement;}const b=l(bg);
     const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);checks.push({text:'control boundary',selector:el.tagName.toLowerCase()+'.'+el.className,ratio,required:3});
    }
    return checks;
   });
   report.push({theme,palette,text:failures});expect(failures.filter(item=>item.ratio<item.required)).toEqual([]);
   await page.getByRole('button',{name:'Close accessibility'}).click();
   await expect(page.getByRole('button',{name:'Accessibility',exact:true})).toBeFocused();
   await expect(page.getByRole('slider',{name:'Circle radius',exact:true})).toHaveAttribute('aria-valuenow',radius!);
   if(palette==='standard'||palette==='high-contrast') await page.screenshot({path:`review/appearance-${theme}-${palette}-${info.project.name}.png`,fullPage:true});
  }
 }
 await writeFile(`review/contrast-${info.project.name}.json`,JSON.stringify(report,null,2));
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('html')).toHaveAttribute('data-palette','high-contrast');
});
test('system preference, explicit override, denied storage and keyboard modal focus',async({page})=>{
 await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.goto('/');
 await expect(page.getByRole('button',{name:'Dark mode'})).toHaveAttribute('aria-pressed','true');
 await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('button',{name:'Dark mode'}).click();await page.emulateMedia({colorScheme:'dark'});await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 const trigger=page.getByRole('button',{name:'Accessibility',exact:true});await trigger.focus();await trigger.press('Enter');await expect(page.locator('.appearance-dialog')).toBeVisible();await expect(page.locator('.appearance-dialog input:checked')).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Close accessibility'})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Use device theme'})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Close accessibility'})).toBeFocused();await page.getByRole('button',{name:'Use device theme'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('Storage denied');};Storage.prototype.setItem=()=>{throw new Error('Storage denied');};});await page.reload();await page.getByRole('button',{name:'Dark mode'}).click();await trigger.click();await page.locator('input[value="red-green"]').check();await page.keyboard.press('Escape');await expect(page.locator('html')).toHaveAttribute('data-palette','red-green');
});
test('mobile 390px, text zoom and forced colors keep appearance controls usable',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.evaluate(()=>{const sizes=[...document.querySelectorAll<HTMLElement>('body *')].filter(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim())).map(el=>[el,parseFloat(getComputedStyle(el).fontSize)] as const);sizes.forEach(([el,size])=>el.style.fontSize=`${size*2}px`);});
 await expect(page.getByRole('button',{name:'Dark mode'})).toBeVisible();await page.getByRole('button',{name:'Accessibility',exact:true}).click();await expect(page.getByRole('button',{name:'Close accessibility'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('.appearance-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:`review/text-enlargement-${info.project.name}.png`});
 await page.emulateMedia({forcedColors:'active'});await page.locator('input[value="high-contrast"]').check();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Accessibility',exact:true})).toBeFocused();
});

test('generated route survives every palette with contrasting casing and GPX available',async({page},info)=>{
 await page.route('**/api/interpreter',r=>r.fulfill({json:circleFixture(64,850).data}));
 await page.goto('/');const size=page.getByRole('slider',{name:'Circle radius',exact:true});await size.press('Home');for(let i=0;i<7;i++)await size.press('ArrowUp');
 await page.getByRole('button',{name:'Generate loop'}).click();await expect(page.getByText('Loop found.',{exact:true})).toBeVisible();
 const report: unknown[]=[];const path=await page.locator('.route-line').getAttribute('d');
 for(const theme of ['light','dark'])for(const palette of palettes){
  if(await page.getByRole('button',{name:'Dark mode'}).getAttribute('aria-pressed')!==String(theme==='dark'))await page.getByRole('button',{name:'Dark mode'}).click();
  await page.getByRole('button',{name:'Accessibility',exact:true}).click();await page.locator(`input[value="${palette}"]`).check();
  if(theme==='light'&&palette==='red-green')await page.screenshot({path:`review/accessibility-dialog-${info.project.name}.png`});await page.keyboard.press('Escape');
  await expect(page.locator('.route-line')).toHaveAttribute('d',path!);await expect(page.getByRole('button',{name:'Download GPX'})).toBeVisible();
  const contrast=await page.locator('.route-line').evaluate(el=>{
   const rgb=(s:string)=>(s.match(/[\d.]+/g)??[]).map(Number).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
   const lum=(s:string)=>{const a=rgb(s);return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
   const a=lum(getComputedStyle(el).stroke),b=lum(getComputedStyle(document.querySelector('.route-halo')!).stroke);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });report.push({theme,palette,routeCasingContrast:contrast,required:3});expect(contrast).toBeGreaterThanOrEqual(3);
  if(theme==='light'&&palette==='red-green')await page.screenshot({path:`review/route-red-green-${info.project.name}.png`,fullPage:true});
 }
 await writeFile(`review/route-contrast-${info.project.name}.json`,JSON.stringify(report,null,2));
});

test('default circle handles clear disabled locate, Fit and zoom before any radius editing',async({page},info)=>{
 for(const [width,height] of [[390,844],[320,568],[844,390]]){
  await page.setViewportSize({width,height});await page.goto('/');await page.evaluate(()=>localStorage.clear());await page.reload();
  await expect(page.getByRole('slider',{name:'Circle radius',exact:true})).toBeVisible();
  const locate=page.locator('.locate-button');await expect(locate).toBeDisabled();await expect(locate).toHaveCSS('pointer-events','none');
  const a=(await locate.boundingBox())!;
  for(const selector of ['.size-handle','.start-handle','.center-lock','.map-topline .map-button','.leaflet-control-zoom']){
   const b=(await page.locator(selector).boundingBox())!;
   expect(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y,JSON.stringify({width,height,selector,locate:a,other:b})).toBe(false);
  }
  if(width===390){await page.getByRole('button',{name:'Dark mode'}).click();await page.screenshot({path:`review/default-control-clearance-${info.project.name}.png`,fullPage:true});}
 }
});

test('theme and palette transitions retain primary contrast in the same event task',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'light'});await page.goto('/');
 const immediate = async(selector:string) => page.evaluate(selector=>{
  const primary=document.querySelector<HTMLElement>('.primary')!;getComputedStyle(primary).backgroundColor;
  document.querySelector<HTMLElement>(selector)!.click();
  const style=getComputedStyle(primary);
  const luminance=(value:string)=>{const channels=(value.match(/[\d.]+/g)??[]).map(Number).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
  const a=luminance(style.color),b=luminance(style.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 },selector);
 for(const palette of palettes){
  await page.getByRole('button',{name:'Accessibility',exact:true}).click();expect(await immediate(`input[value="${palette}"]`)).toBeGreaterThanOrEqual(4.5);await page.keyboard.press('Escape');
  expect(await immediate('button[aria-label="Dark mode"]')).toBeGreaterThanOrEqual(4.5);
  expect(await immediate('button[aria-label="Dark mode"]')).toBeGreaterThanOrEqual(4.5);
 }
});
