import {test,expect} from '@playwright/test';

for(const mobile of [false,true])test(`reader readiness and duplicate font events (${mobile?'phone':'desktop'})`,async({browser})=>{
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},screen:mobile?{width:390,height:844}:{width:1440,height:1000}});
 const page=await context.newPage();const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 await page.route('https://fonts.gstatic.com/**',route=>route.abort());
 try{
  await page.goto('http://127.0.0.1:5175/');
  await page.evaluate(async()=>{
   const {saveBook}=await import('/src/lib/library.ts');
   await saveBook({id:'reader-ready-spec',title:'초기화 검증',author:'테스트',description:'',color:'#1d3b31',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',volumePolicy:'chapters-200-v1',pageLayoutVersion:5,pageCount:20,messages:Array.from({length:12},(_,index)=>({role:'assistant',name:'화자',content:`${index} `+'바람이 불었다. 책장을 넘겨 이야기를 읽었다. '.repeat(35)}))});
  });
  await page.reload();
  await expect(page.getByRole('button',{name:'초기화 검증 읽기',exact:true})).toBeVisible();
  await page.evaluate(async()=>{
   const {PageFlip}=await import('/src/vendor/page-flip/PageFlip.ts');
   const original=PageFlip.prototype.loadFromHTML;
   (window as any).readerInitializations=0;
   (window as any).initWhileLoading=[];
   PageFlip.prototype.loadFromHTML=function(items:any){
    (window as any).readerInitializations++;
    this.on('init',()=>{(window as any).initWhileLoading.push(document.querySelector('.reader-stage')?.getAttribute('aria-busy'));});
    original.call(this,items);
   };
   location.hash='/book/reader-ready-spec';
  });
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.reader-progress')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).initWhileLoading)).toEqual(['true']);
  const initializations=await page.evaluate(()=>(window as any).readerInitializations);
  await page.evaluate(async()=>{
   document.fonts.dispatchEvent(new Event('loadingdone'));
   document.fonts.dispatchEvent(new Event('loadingdone'));
   await new Promise(resolve=>setTimeout(resolve,250));
  });
  expect(await page.evaluate(()=>(window as any).readerInitializations)).toBe(initializations);
  await expect(page.locator('.reader-loading')).toHaveCount(0);
  const before=await page.locator('.reader-progress').inputValue();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.reader-progress')).not.toHaveValue(before);
  if(mobile)await page.getByRole('button',{name:'독서 메뉴',exact:true}).click();
  await page.evaluate(()=>{
   (window as any).bookmarkSkeletons=0;
   const stage=document.querySelector('.reader-stage')!;
   new MutationObserver(records=>{for(const record of records)if(record.attributeName==='aria-busy'&&stage.getAttribute('aria-busy')==='true')(window as any).bookmarkSkeletons++;}).observe(stage,{attributes:true,attributeFilter:['aria-busy']});
  });
  const bookmarkInitializations=await page.evaluate(()=>(window as any).readerInitializations);
  await page.getByRole('button',{name:'현재 위치에 책갈피',exact:true}).click();
  await expect(page.getByRole('button',{name:'책갈피 제거',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'책갈피 제거',exact:true}).click();
  await expect(page.getByRole('button',{name:'현재 위치에 책갈피',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).bookmarkSkeletons)).toBe(0);
  expect(await page.evaluate(()=>(window as any).readerInitializations)).toBe(bookmarkInitializations);
  // A late toolbar/UI font must not invalidate the prose pagination.
  await page.evaluate(async()=>{
   const original=CanvasRenderingContext2D.prototype.measureText;
   CanvasRenderingContext2D.prototype.measureText=function(text){const result=original.call(this,text);return this.font.includes('Noto Sans KR')?{width:result.width+10} as TextMetrics:result;};
   document.fonts.dispatchEvent(new Event('loadingdone'));
   await new Promise(resolve=>setTimeout(resolve,150));
   CanvasRenderingContext2D.prototype.measureText=original;
  });
  expect(await page.evaluate(()=>(window as any).readerInitializations)).toBe(bookmarkInitializations);

  if(!mobile){
   const enter=await page.getByRole('button',{name:'전체창',exact:true}).evaluate(async button=>{
    const count=(window as any).readerInitializations;
    (button as HTMLButtonElement).click();
    const rect=()=>{const r=document.querySelector('.skeleton-paper-stack')!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const firstRect=rect();
    const immediate=!!document.querySelector('.reading-skeleton-embedded')&&document.querySelector('.reader-stage')?.getAttribute('aria-busy')==='true';
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    const nextRect=rect();
    if(!document.querySelector('.reader-stage')!.getAnimations().length)throw new Error('Missing fullwindow growth animation');
    return {immediate,beforeCalculation:(window as any).readerInitializations===count,full:!!document.querySelector('.reader-fullscreen'),topAnimation:getComputedStyle(document.querySelector('.reader-drawer')!).animationName,bottomAnimation:getComputedStyle(document.querySelector('.reader-footer')!).animationName};
   });
   expect(enter).toEqual({immediate:true,beforeCalculation:true,full:true,topAnimation:'reader-chrome-hide-top',bottomAnimation:'reader-chrome-hide-bottom'});
   await expect(page.locator('.reader-drawer')).toBeHidden();
   await expect(page.locator('.reader-footer')).toBeHidden();
   const handleWidth=await page.locator('.reader-drawer-handle>span').evaluate(node=>node.getBoundingClientRect().width);
   expect(handleWidth).toBeCloseTo(1440*.12,0);
   await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
   await page.getByRole('button',{name:'독서 메뉴',exact:true}).click();
   await expect(page.locator('.reader-footer')).toHaveCSS('animation-name','reader-chrome-show-bottom');
   await page.getByRole('button',{name:'독서 메뉴 닫기',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
   await expect(page.locator('.reader-drawer')).toHaveCSS('animation-name','reader-chrome-hide-top');
   await expect(page.locator('.reader-footer')).toHaveCSS('animation-name','reader-chrome-hide-bottom');
   await expect(page.locator('.reader-drawer')).toBeHidden();
   await expect(page.locator('.reader-footer')).toBeHidden();
   await page.getByRole('button',{name:'독서 메뉴',exact:true}).click();
   const exit=await page.getByRole('button',{name:'전체창 해제',exact:true}).evaluate(button=>{
    (button as HTMLButtonElement).click();
    return {skeleton:!!document.querySelector('.reading-skeleton-embedded'),full:!!document.querySelector('.reader-fullscreen')};
   });
   expect(exit).toEqual({skeleton:true,full:false});
   await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
   await expect(page.locator('.reader-progress')).toBeEnabled();
   await expect(page.locator('.reader-loading')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
 }finally{await context.close();}
});

