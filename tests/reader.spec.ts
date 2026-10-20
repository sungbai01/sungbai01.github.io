import {test,expect} from '@playwright/test';
import fs from 'node:fs';

const phrase='바람이 불었다. 우리는 오래된 책장을 따라 걸으며 지나간 대화를 한 장씩 다시 읽었다. 별과 바다와 먼 여행을 이야기했다.\n\n';
function fixture(count:number,id='large-book'){
 return {id,title:'긴 이야기',author:'테스트',description:'검증 전용',color:'#1d3b31',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',messages:Array.from({length:count},(_,i)=>({role:i%2?'assistant':'user',name:'화자'+i%2,content:i+' '+phrase.repeat(11)})),lastPage:0};
}
test.beforeEach(async({page})=>{
 await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 await page.route('https://fonts.gstatic.com/**',route=>route.abort());
});
async function seed(page:any,book:any){
 await page.goto('/');
 await page.evaluate(async book=>{
  const {saveBook}=await import('/src/lib/library.ts');await saveBook(book);localStorage.setItem('galpi:initialized','yes');
 },book);
 await page.reload();
}
test('large logs split without text loss; shelves group volumes and consolidate controls',async({page})=>{
 const book=fixture(800);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await seed(page,book);
 await page.goto('/#/book/'+book.id);await page.reload();await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false',{timeout:120000});await page.getByRole('button',{name:'책을 닫고 서재로 돌아가기',exact:true}).click();
 await expect(page.locator('[data-series-id="large-book"]')).toBeVisible({timeout:120000});
 const volumes=await page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return (await loadBooks()).filter((b:any)=>b.seriesId==='large-book').sort((a:any,b:any)=>a.volumeNumber-b.volumeNumber);});
 expect(volumes.length).toBeGreaterThan(1);
 expect(volumes.flatMap((v:any)=>v.messages).map((m:any)=>m.content).join('')).toBe(book.messages.map(m=>m.content).join(''));
 expect(await page.getByRole('button',{name:'RisuAI 로그 가져오기',exact:true}).count()).toBe(1);
 expect(await page.getByRole('button',{name:'저장 및 백업',exact:true}).count()).toBe(1);
 await page.goto('/#/book/'+volumes[0].id);await page.reload();
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false',{timeout:120000});
 expect(await page.locator('.reader-page:not([data-flip-copy])').count()).toBeLessThanOrEqual(100);
 expect(await page.locator('.reader-page:not([data-flip-copy]) .reader-paper-shell').count()).toBeLessThanOrEqual(9);
 const before=await page.locator('.reader-progress').inputValue();
 await page.getByRole('button',{name:'다음 쪽',exact:true}).click();
 await expect(page.locator('.reader-progress')).not.toHaveValue(before);
 await page.locator('.reader-progress').press('End');
 await expect(page.getByRole('button',{name:'다음 권',exact:true})).toBeEnabled();
 const oldURL=page.url();await page.getByRole('button',{name:'다음 권',exact:true}).click();await expect(page).not.toHaveURL(oldURL);
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 expect(await page.locator('.reader-page:not([data-flip-copy])').count()).toBeLessThanOrEqual(100);
 expect(errors).toEqual([]);
});
test('reader keeps bounded DOM during turns and font changes; captures internal frame metrics',async({page})=>{
 const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await seed(page,fixture(200,'performance-book'));
 await page.goto('/#/book/performance-book');await page.reload();
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false',{timeout:120000});
 await page.evaluate(()=>{(window as any).__frames=[];(window as any).__record=true;let last=performance.now();function frame(t:number){if(!(window as any).__record)return;(window as any).__frames.push(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);});
 const flips=[];
 for(let i=0;i<6;i++){const before=await page.locator('.reader-progress').inputValue();const t=Date.now();await page.getByRole('button',{name:'다음 쪽',exact:true}).click();await expect(page.locator('.reader-progress')).not.toHaveValue(before);flips.push(Date.now()-t);expect(await page.locator('.reader-page:not([data-flip-copy]) .reader-paper-shell').count()).toBeLessThanOrEqual(9);}
 const metrics=await page.evaluate(()=>{(window as any).__record=false;const frames=(window as any).__frames.sort((a:number,b:number)=>a-b);return {pages:document.querySelectorAll('.reader-page:not([data-flip-copy])').length,mounted:document.querySelectorAll('.reader-page:not([data-flip-copy]) .reader-paper-shell').length,nodes:document.querySelectorAll('*').length,p95:frames[Math.floor(frames.length*.95)],max:Math.max(...frames),longFrames:frames.filter((t:number)=>t>50).length};});
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/reader-performance.json',JSON.stringify({...metrics,flips},null,2));
 expect(metrics.pages).toBeLessThanOrEqual(100);expect(metrics.mounted).toBeLessThanOrEqual(9);expect(metrics.nodes).toBeLessThan(1000);
 await page.getByRole('button',{name:'독서 화면 설정',exact:true}).click();
 for(let i=0;i<10;i++)await page.getByRole('button',{name:'글자 크게',exact:true}).click();
 await page.getByRole('button',{name:'패널 닫기',exact:true}).click();
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 expect(await page.locator('.reader-page:not([data-flip-copy])').count()).toBeLessThanOrEqual(100);
 expect(errors).toEqual([]);
});
test('dialogs are centered and import has a single entry point on desktop and mobile',async({page})=>{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto('/');
  await page.getByRole('button',{name:'RisuAI 로그 가져오기',exact:true}).click();
  const dialog=page.locator('dialog[open]');await expect(dialog).toBeVisible();const b=await dialog.boundingBox();
  expect(Math.abs(b!.x+b!.width/2-viewport.width/2)).toBeLessThan(3);expect(Math.abs(b!.y+b!.height/2-viewport.height/2)).toBeLessThan(3);
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'저장 및 백업',exact:true}).click();await expect(dialog).toBeVisible();
  const c=await dialog.boundingBox();expect(Math.abs(c!.x+c!.width/2-viewport.width/2)).toBeLessThan(3);expect(Math.abs(c!.y+c!.height/2-viewport.height/2)).toBeLessThan(3);
  await page.getByRole('button',{name:'닫기',exact:true}).click();
 }
});
test('desktop spread, search, bookmark, reload and grouped shelf stay usable',async({page})=>{
 await page.setViewportSize({width:1280,height:900});const book=fixture(80,'desktop-book');await seed(page,book);
 await page.goto('/#/book/'+book.id);await page.reload();await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false',{timeout:120000});await page.getByRole('button',{name:'책을 닫고 서재로 돌아가기',exact:true}).click();
 await expect(page.locator('[data-series-id="desktop-book"]')).toBeVisible();
 await page.getByRole('button',{name:'긴 이야기 · 1권 책갈피 꽂기',exact:true}).click();
 await page.getByRole('button',{name:'책갈피 01',exact:true}).click();
 await expect(page.getByRole('button',{name:'긴 이야기 · 1권 읽기',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'긴 이야기 · 1권 읽기',exact:true}).click();
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('.reader-progress-label')).toContainText('1–2쪽');
 await page.getByRole('button',{name:'책 속에서 검색',exact:true}).click();
 await page.getByRole('searchbox',{name:'검색할 단어나 문장',exact:true}).fill('바람');
 await expect(page.locator('.reader-search-result').first()).toBeVisible();
 await page.locator('.reader-search-result').nth(2).click();
 await page.getByRole('button',{name:'다음 쪽',exact:true}).click();
 const position=await page.locator('.reader-progress').inputValue();
 await expect.poll(()=>page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return String((await loadBooks()).find((b:any)=>b.id==='desktop-book')?.lastPage);})).toBe(position);
 await page.reload();await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('.reader-progress')).toHaveValue(position);
 await page.getByRole('button',{name:'책을 닫고 서재로 돌아가기',exact:true}).click();
 await expect(page.locator('[data-series-id="desktop-book"]')).toBeVisible();
 expect(await page.locator('body').evaluate(element=>element.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/shelf-desktop.png',fullPage:true});
});


