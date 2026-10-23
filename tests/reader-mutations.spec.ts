import {test,expect} from '@playwright/test';
const book={id:'mutation-spec',title:'수정 검증',author:'테스트',description:'',color:'#1d3b31',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',volumePolicy:'chapters-200-v1',pageLayoutVersion:5,pageCount:20,messages:[{role:'assistant',name:'화자',content:'처음문장. '+'책장을 넘겨 이야기를 읽었다. '.repeat(250)+' 마지막문장.'}]};
test('cloud bookmark changes never restart the reader',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 let saved=structuredClone(book),revision=1;let finishSave:(()=>void)|undefined;
 await page.route('**/library/books**',async route=>{
  if(route.request().method()==='PUT'){
   saved=route.request().postDataJSON().book;await new Promise<void>(resolve=>{finishSave=resolve;});
   await route.fulfill({json:{revision:++revision}});return;
  }
  if(new URL(route.request().url()).pathname.endsWith('/mutation-spec'))await route.fulfill({json:{book:saved,revision}});
  else await route.fulfill({json:{books:[{id:book.id,book:{...saved,messages:[]},revision,updatedAt:Date.now(),deleted:false}],nextCursor:null}});
 });
 await page.goto('http://127.0.0.1:5175/');
 await page.evaluate(async()=>{const auth=await import('/src/lib/auth.ts');auth.setAuthSession({token:'test-only',expiresAt:Date.now()+3600000,user:{id:'u_'+ 'a'.repeat(43)}});});
 await page.getByRole('button',{name:'수정 검증 읽기',exact:true}).click();
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 await page.evaluate(()=>{(window as any).rebuilds=0;new MutationObserver(records=>{for(const r of records)if(r.oldValue==='false')(window as any).rebuilds++;}).observe(document.querySelector('.reader-stage')!,{attributes:true,attributeFilter:['aria-busy'],attributeOldValue:true});});
 await page.getByRole('button',{name:'현재 위치에 책갈피',exact:true}).click();
 await expect(page.getByRole('button',{name:'책갈피 제거',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).rebuilds)).toBe(0);
 await expect.poll(()=>!!finishSave).toBe(true);finishSave!();
 await expect.poll(()=>revision).toBe(2);
 await page.getByRole('button',{name:'책갈피 제거',exact:true}).click();
 await expect(page.getByRole('button',{name:'현재 위치에 책갈피',exact:true})).toBeEnabled();
 await expect.poll(()=>!!saved.bookmarks?.length).toBe(false);finishSave!();
 expect(await page.evaluate(()=>(window as any).rebuilds)).toBe(0);
});
test('long paste is saved exactly once after page reflow',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:5175/');
 await page.evaluate(async book=>{const {saveBook}=await import('/src/lib/library.ts');await saveBook(book);},book);
 await page.reload();await page.getByRole('button',{name:'수정 검증 읽기',exact:true}).click();
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'본문 편집',exact:true}).click();
 const text='붙여넣기시작 '+Array.from({length:180},(_,i)=>`검증단어${i} 이야기가 이어집니다.`).join('\n\n')+'\n붙여넣기끝';
 await page.getByRole('textbox',{name:'페이지 본문 편집'}).first().evaluate((el,text)=>{
  (el as HTMLElement).focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(true);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  const data=new DataTransfer();data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },text);
 await expect.poll(async()=>Number(await page.locator('.reader-progress').getAttribute('max'))).toBeGreaterThan(10);
 await page.getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.getByRole('button',{name:'저장',exact:true})).toHaveCount(0);
 const content=await page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return (await loadBooks()).find(b=>b.id==='mutation-spec')!.messages.map(m=>m.content).join('');});
 expect(content.split('붙여넣기시작').length-1).toBe(1);expect(content.split('붙여넣기끝').length-1).toBe(1);
 expect(content===text+book.messages[0].content).toBe(true);expect(errors).toEqual([]);
});

for(const mobile of [false,true])test(`bookmark drop fades in place and leaves no copy (${mobile?'phone':'desktop'})`,async({browser})=>{
 test.setTimeout(20000);
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},screen:mobile?{width:390,height:844}:{width:1440,height:1000}});const page=await context.newPage();
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:5175/');await page.evaluate(async book=>{const {saveBook}=await import('/src/lib/library.ts');await saveBook(book);},book);await page.reload();await page.getByRole('button',{name:'수정 검증 읽기',exact:true}).click();
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 if(mobile)await page.getByRole('button',{name:'독서 메뉴',exact:true}).click();
 await page.getByRole('button',{name:'현재 위치에 책갈피',exact:true}).click();await expect(page.getByRole('button',{name:'책갈피 제거',exact:true})).toBeEnabled();
 if(mobile){
  await page.getByRole('button',{name:'메뉴 닫기',exact:true}).click();
  // The initial phone leaf is page 1: inserting here must remain visible.
  await expect(page.locator('.reader-phone-bookmark')).toHaveAttribute('data-current','true');
  const markedPosition=await page.locator('.reader-progress').inputValue();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.reader-progress')).not.toHaveValue(markedPosition);
  await expect(page.locator('.reader-phone-bookmark')).toHaveAttribute('data-current','false');
  expect(await page.locator('.reader-phone-bookmark').evaluate(el=>el.clientHeight)).toBeLessThan(20);
  await page.getByRole('button',{name:'책갈피로 이동',exact:true}).click({position:{x:10,y:5}});
  await expect(page.locator('.reader-phone-bookmark')).toHaveAttribute('data-current','true');
  expect(await page.locator('.reader-phone-bookmark').evaluate(el=>el.clientHeight)).toBeGreaterThan(100);
 }
 await page.evaluate(()=>{const animate=Element.prototype.animate;(window as any).dropFrames=[];(window as any).coastSamples=[];Element.prototype.animate=function(frames,options){if(this.classList.contains('reader-bookmark-loose')){(window as any).dropFrames.push(frames);if((frames as any[])[0]?.opacity===1){const el=this as HTMLElement;const sample=()=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top),opacity:Number(getComputedStyle(el).opacity)});(window as any).coastSamples.push(sample());setTimeout(()=>(window as any).coastSamples.push(sample()),150);setTimeout(()=>(window as any).coastSamples.push(sample()),400);}}return animate.call(this,frames,options);};});
 const ribbon=mobile?page.locator('.reader-phone-bookmark .reader-bookmark-slip'):page.locator('.reader-page-right .reader-bookmark-slip');
 const box=(await ribbon.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+30);await page.mouse.down();await page.mouse.move(box.x+box.width+160,box.y+200,{steps:12});await page.mouse.up();
 await expect(page.locator('.reader-bookmark-motion-plane')).toHaveCount(0);
 await expect(page.locator('.reader-phone-bookmark,.reader-bookmark-peek,.reader-page .reader-bookmark-slip')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).dropFrames)).toContainEqual([{opacity:1},{opacity:0}]);
 const samples=await page.evaluate(()=>(window as any).coastSamples);
 expect(samples.length).toBe(3);expect(samples[1].opacity).toBeGreaterThan(samples[2].opacity);
 expect(Math.hypot(samples[1].x-samples[0].x,samples[1].y-samples[0].y)).toBeGreaterThan(1);
 if(mobile)await page.getByRole('button',{name:'독서 메뉴',exact:true}).click();
 for(let i=0;i<2;i++){
  await page.evaluate(()=>(window as any).dropFrames=[]);
  await page.getByRole('button',{name:'현재 위치에 책갈피',exact:true}).click();
  await expect(page.getByRole('button',{name:'책갈피 제거',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).dropFrames.some((frames:any[])=>frames[0]?.top?.startsWith('-')&&parseFloat(frames[1]?.top)>=0))).toBe(true);
  await page.getByRole('button',{name:'책갈피 제거',exact:true}).click();
  await expect(page.getByRole('button',{name:'현재 위치에 책갈피',exact:true})).toBeEnabled();
 }

 await context.close();
});

test('bookmark save failure uses a toast instead of page error',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:5175/');await page.evaluate(async()=>{const {mountFailure}=await import('/tests/bookmark-failure-harness.tsx');mountFailure();});
 await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'현재 위치에 책갈피',exact:true}).click();
 await expect(page.locator('.reader .toast')).toContainText('책갈피를 저장하지 못했어요.');
 await expect(page.locator('.reader-error')).toHaveCount(0);
});
