import {test,expect} from '@playwright/test';
test.use({viewport:{width:390,height:844}});
async function openBook(page:any){
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('/');await page.evaluate(async()=>{const {saveBook}=await import('/src/lib/library.ts');await saveBook({id:'inputs',title:'넘김 테스트',author:'검증',description:'',color:'#1d3b31',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:Array.from({length:12},(_,i)=>({role:'assistant',name:'화자',content:i+' '+('우리는 오래된 이야기를 읽고 바다로 향했다.\n').repeat(22)})),lastPage:0});});
 await page.goto('/#/book/inputs');await page.reload();await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');await page.evaluate(()=>document.fonts.ready);
}
for(const size of [{width:390,height:844},{width:1280,height:900}]){
test(`buttons, page click, drag and overflow ${size.width}`,async({page})=>{
 await page.setViewportSize(size);await openBook(page);
 await page.evaluate(()=>{(window as any).__inputStats={hosts:0,bars:0};const stage=document.querySelector('.reader-stage')!;new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node instanceof Element&&(node.matches('.reader-flip-host')||node.querySelector('.reader-flip-host')))(window as any).__inputStats.hosts++;}).observe(stage,{childList:true,subtree:true});(window as any).__watch=true;function frame(){if(!(window as any).__watch)return;const css=getComputedStyle(stage);if((stage.scrollWidth>stage.clientWidth&&/auto|scroll/.test(css.overflowX))||(stage.scrollHeight>stage.clientHeight&&/auto|scroll/.test(css.overflowY)))(window as any).__inputStats.bars++;requestAnimationFrame(frame);}requestAnimationFrame(frame);});
 const host=page.locator('.reader-flip-host');let b=(await host.boundingBox())!;
 await page.mouse.move(b.x+b.width-3,b.y+b.height-3);
 const start=await page.locator('.reader-progress').inputValue();
 await page.getByRole('button',{name:'다음 쪽',exact:true}).click();await expect(page.locator('.reader-progress')).not.toHaveValue(start);
 await page.getByRole('button',{name:'이전 쪽',exact:true}).click();await expect(page.locator('.reader-progress')).toHaveValue(start);
 b=(await host.boundingBox())!;await page.mouse.click(b.x+b.width*.82,b.y+b.height*.5);await expect(page.locator('.reader-progress')).not.toHaveValue(start);
 const beforeDrag=await page.locator('.reader-progress').inputValue();b=(await host.boundingBox())!;
 await page.mouse.move(b.x+b.width*.82,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.65,b.y+b.height*.5,{steps:8});
 await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('.reader-page')).some(el=>{const style=(el as HTMLElement).style;return style.display==='block'&&style.clipPath.startsWith('polygon')&&style.transform.includes('rotate');}))).toBe(true);
 await page.mouse.move(b.x+10,b.y+b.height*.5,{steps:18});await page.mouse.up();await expect(page.locator('.reader-progress')).not.toHaveValue(beforeDrag);
 const afterForward=await page.locator('.reader-progress').inputValue();b=(await host.boundingBox())!;
 await page.mouse.move(b.x+8,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width-10,b.y+b.height*.5,{steps:18});await page.mouse.up();await expect(page.locator('.reader-progress')).toHaveValue(beforeDrag);
 const keyBefore=await page.locator('.reader-progress').inputValue();
 await page.getByRole('button',{name:'다음 쪽',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.locator('.reader-progress')).not.toHaveValue(keyBefore);
 await page.keyboard.press('ArrowLeft');await expect(page.locator('.reader-progress')).toHaveValue(keyBefore);
 b=(await host.boundingBox())!;await page.mouse.move(b.x+b.width*.7,b.y+b.height*.5);await page.mouse.wheel(0,120);await expect(page.locator('.reader-progress')).not.toHaveValue(keyBefore);
 await page.waitForTimeout(500);await page.mouse.wheel(0,-120);await expect(page.locator('.reader-progress')).toHaveValue(keyBefore);
 const stats=await page.evaluate(()=>{(window as any).__watch=false;return (window as any).__inputStats;});
 expect(stats.hosts).toBe(0);expect(stats.bars).toBe(0);
});}
test('touch taps and swipes work without duplicate compatibility events',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();await openBook(page);
 const host=page.locator('.reader-flip-host');let b=(await host.boundingBox())!;const initial=await page.locator('.reader-progress').inputValue();
 await page.touchscreen.tap(b.x+b.width*.8,b.y+b.height*.5);await expect(page.locator('.reader-progress')).not.toHaveValue(initial);
 const next=await page.locator('.reader-progress').inputValue();b=(await host.boundingBox())!;
 await page.touchscreen.tap(b.x+b.width*.15,b.y+b.height*.5);await expect(page.locator('.reader-progress')).toHaveValue(initial);
 const cdp=await context.newCDPSession(page);b=(await host.boundingBox())!;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width-10,y:b.y+b.height*.65}]});
 for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width-10-(b.width-30)*i/12,y:b.y+b.height*.65}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('.reader-progress')).toHaveValue(next);await context.close();
});
