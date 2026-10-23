import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`share ticket opens before book fetch (${width})`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5175/');
 await page.evaluate(async()=>{
  const {mountTicket}=await import('/tests/share-ticket-harness.tsx');mountTicket();
 });
 await expect(page.getByRole('dialog',{name:'책 공유'})).toBeVisible();
 await expect(page.locator('.share-interactive-ticket')).toContainText('티켓 테스트');
 await expect(page.getByRole('button',{name:'공유할 대사 선택',exact:true})).toBeDisabled();
 expect(await page.locator('.share-ticket-workspace').evaluate(el=>getComputedStyle(el).animationName)).toBe('share-dialog-enter');
 const motion=await page.evaluate(()=>{
  const el=document.querySelector<HTMLElement>('.share-ticket-workspace')!,dialog=document.querySelector<HTMLElement>('.share-ticket-dialog')!;
  const animation=el.getAnimations()[0];animation.pause();
  const samples=[0,180,350,460].map(time=>{animation.currentTime=time;const box=el.getBoundingClientRect(),matrix=new DOMMatrixReadOnly(getComputedStyle(el).transform);dialog.scrollTo(500,500);return {top:box.top,tilt:matrix.b,scrollX:dialog.scrollLeft,scrollY:dialog.scrollTop,gutter:dialog.offsetWidth-dialog.clientWidth};});
  animation.finish();return {samples,height:innerHeight,filter:getComputedStyle(document.querySelector('.share-interactive-ticket')!).filter};
 });
 expect(motion.samples[0].top).toBeGreaterThan(motion.height);
 expect(Math.abs(motion.samples[1].tilt)).toBeGreaterThan(.0001);
 expect(Math.abs(motion.samples[3].tilt)).toBeLessThan(.0001);
 for(const sample of motion.samples)expect([sample.scrollX,sample.scrollY,sample.gutter]).toEqual([0,0,0]);
 expect(motion.filter).toBe('none');
 await expect(page.locator('.share-ticket-placeholder')).toHaveCSS('mask-mode','luminance');
 const before=await page.locator('.share-interactive-ticket').boundingBox();
 const fits=await page.locator('.share-ticket-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth);
 expect(fits).toBe(true);
 await page.evaluate(()=>(window as any).finishBook());
 await expect(page.getByRole('button',{name:'공유할 대사 선택',exact:true})).toBeEnabled();
 await expect(page.locator('.share-ticket-quote-target')).toContainText('대사 선택');
 await expect(page.locator('.share-ticket-quote-target')).toHaveCSS('border-color','rgba(0, 0, 0, 0)');
 await page.locator('.share-ticket-quote-target').hover();
 await expect(page.locator('.share-ticket-quote-target')).not.toHaveCSS('border-color','rgba(0, 0, 0, 0)');
 await page.mouse.move(0,0);
 await expect(page.getByRole('button',{name:'카드 이미지 저장',exact:true})).toBeEnabled();
 await expect(page.locator('.share-ticket-render')).toBeVisible();
 expect(await page.locator('.share-interactive-ticket').boundingBox()).toEqual(before);
 await expect(page.locator('.share-ticket-info,.share-ticket-message')).toHaveCount(0);
 await expect(page.locator('.share-ticket-tools button').first()).toHaveCSS('border-radius','6px');
 const aligned=await page.evaluate(()=>Math.abs(document.querySelector('.share-interactive-ticket')!.getBoundingClientRect().top-document.querySelector('.share-ticket-close')!.getBoundingClientRect().top)<1);expect(aligned).toBe(true);
 await page.getByRole('button',{name:'닫기',exact:true}).hover();
 await expect(page.locator('.share-ticket-close')).toHaveCSS('background-color','rgb(251, 231, 231)');
 for(const name of ['대사 제거','로그인','공유 만들기','공유 링크 복사','공유 내용 갱신','공유 종료','URL로 공유','카드로 공유'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(page.getByRole('checkbox')).toHaveCount(0);
 expect(await page.locator('.share-interactive-ticket').evaluate(el=>Math.abs(el.clientWidth/el.clientHeight-2)<.03)).toBe(true);
 expect(await page.locator('.share-interactive-ticket button').count()).toBe(1);
 const preview=await page.locator('.share-ticket-render').evaluate(async(el:HTMLImageElement)=>Array.from(new Uint8Array(await (await fetch(el.src)).arrayBuffer())));
 const downloading=page.waitForEvent('download');
 await page.getByRole('button',{name:'카드 이미지 저장',exact:true}).click();
 const file=await downloading;
 expect(file.suggestedFilename()).toMatch(/\.(webp|png)$/);
 const stream=await file.createReadStream();const chunks=[];for await(const chunk of stream!)chunks.push(chunk);
 expect(Array.from(Buffer.concat(chunks))).toEqual(preview);
 await page.getByRole('button',{name:'공유',exact:true}).click();
 await expect(page.getByRole('group',{name:'공유 형식',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('.share-ticket-actions')).toHaveAttribute('data-closing','true');
 expect(await page.locator('.share-ticket-actions').evaluate(el=>getComputedStyle(el).animationName)).toBe('share-actions-exit');
 await expect(page.locator('.share-ticket-actions')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'공유',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'닫기',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'책 공유'})).toHaveAttribute('data-closing','true');
 expect(await page.locator('.share-ticket-workspace').evaluate(el=>getComputedStyle(el).animationName)).toBe('share-dialog-exit');
 await expect(page.getByRole('dialog',{name:'책 공유'})).toHaveCount(0);
 expect(errors).toEqual([]);
});


for(const format of ['HTML','URL'])test(`${format} share creates its link and includes body images without extra options`,async({page})=>{
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 const calls:{method:string;path:string;role:string|null}[]=[];
 await page.route('**/library/books/ticket-test/share**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  calls.push({method:request.method(),path,role:request.headers()['x-image-role']??null});
  if(path.endsWith('/images'))await route.fulfill({json:{url:'https://example.com/card.webp'}});
  else await route.fulfill({json:{share:request.method()==='GET'?null:{id:'a'.repeat(43),updatedAt:Date.now()}}});
 });
 await page.goto('http://127.0.0.1:5175/');
 await page.evaluate(async()=>{
  const auth=await import('/src/lib/auth.ts');auth.setAuthSession({token:'mock',expiresAt:Date.now()+3600000,user:{id:'u_'+'a'.repeat(43)}});
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as any).copied=text;}}});
  const {mountTicket}=await import('/tests/share-ticket-harness.tsx');mountTicket(true);
 });
 await expect(page.getByRole('dialog',{name:'책 공유'})).toBeVisible();await page.evaluate(()=>(window as any).finishBook());
 await expect(page.getByRole('button',{name:'공유',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'공유',exact:true}).click();
 await expect(page.getByRole('button',{name:'공유',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'URL로 공유',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'HTML로 공유',exact:true})).toBeVisible();
 expect(await page.getByRole('button',{name:'URL로 공유',exact:true}).innerText()).toBe('');
 expect(await page.getByRole('button',{name:'HTML로 공유',exact:true}).innerText()).toBe('');
 const flyoutFits=await page.locator('.share-ticket-actions').evaluate(el=>{const r=el.getBoundingClientRect(),button=el.parentElement!.querySelector('button')!.getBoundingClientRect();return r.left>=button.right&&r.right<=innerWidth;});expect(flyoutFits).toBe(true);
 expect(calls).toEqual([]);
 await page.getByRole('button',{name:format+'로 공유',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'복사했어요.'})).toBeVisible();
 expect(calls.map(call=>[call.method,call.role])).toEqual([['GET',null],['POST',null],['POST','asset'],...(format==='HTML'?[['POST','card']]:[])]);
 expect(await page.evaluate(()=>(window as any).copied)).toContain('#/share/'+'a'.repeat(43));
 await page.getByRole('button',{name:format+'로 공유',exact:true}).click();
 expect(calls.length).toBe(format==='HTML'?4:3);
});
test('empty quote draws no quotation mark and selection can confirm empty',async({page})=>{
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:5175/');
 const result=await page.evaluate(async()=>{
  const {makeTicketCard}=await import('/src/lib/shareTicket.ts');
  const original=CanvasRenderingContext2D.prototype.fillText,drawn:string[]=[];
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){drawn.push(text);return original.call(this,text,...args);};
  const book={id:'empty',title:'빈 대사',author:'',description:'',color:'#1d3b31',createdAt:'',updatedAt:'',messages:[]};
  try{await makeTicketCard(book,'');const empty=drawn.includes('“');drawn.length=0;await makeTicketCard(book,'대사');return {empty,quote:drawn.includes('“')};}finally{CanvasRenderingContext2D.prototype.fillText=original;}
 });
 expect(result).toEqual({empty:false,quote:true});
 await page.evaluate(async()=>{const {mountEmptySelection}=await import('/tests/share-ticket-harness.tsx');mountEmptySelection();});
 await expect(page.getByRole('button',{name:'대사 없이 공유',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'대사 없이 공유',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).chosenQuote)).toBe('');
});

test('share errors stay in a dismissible toast without moving the card',async({page})=>{
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:5175/');await page.evaluate(async()=>{const {mountTicket}=await import('/tests/share-ticket-harness.tsx');mountTicket();});
 await expect(page.getByRole('dialog',{name:'책 공유'})).toBeVisible();await page.evaluate(()=>(window as any).finishBook());
 await page.getByRole('button',{name:'공유',exact:true}).click();
 const before=await page.locator('.share-interactive-ticket').boundingBox();
 await page.getByRole('button',{name:'HTML로 공유',exact:true}).click();
 await expect(page.locator('.share-ticket-dialog .toast')).toHaveAttribute('role','alert');
 await expect(page.locator('.share-ticket-dialog .toast')).toContainText('로그인한 서재');
 expect(await page.locator('.share-interactive-ticket').boundingBox()).toEqual(before);
 await page.getByRole('button',{name:'알림 닫기',exact:true}).click();await expect(page.locator('.share-ticket-dialog .toast')).toHaveCount(0);
});

test('shared toast expires and repeated notifications restart its lifetime',async({page})=>{
 await page.clock.install();await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:5175/');await page.evaluate(async()=>{const {mountTicket}=await import('/tests/share-ticket-harness.tsx');mountTicket();});
 await expect(page.getByRole('dialog',{name:'책 공유'})).toBeVisible();await page.evaluate(()=>(window as any).finishBook());
 await page.getByRole('button',{name:'공유',exact:true}).click();await page.getByRole('button',{name:'URL로 공유',exact:true}).click();
 await expect(page.locator('.toast')).toBeVisible();await page.clock.fastForward(3000);
 await page.getByRole('button',{name:'URL로 공유',exact:true}).click();await page.clock.fastForward(1000);await expect(page.locator('.toast')).toBeVisible();
 await page.clock.fastForward(2700);await expect(page.locator('.toast')).toHaveCount(0);
});

test('card render has a bounded font wait and ignores unrelated font readiness',async({page})=>{
 await page.goto('http://127.0.0.1:5175/');
 const result=await page.evaluate(async()=>{
  const {makeTicketCard}=await import('/src/lib/shareTicket.ts');
  const original=document.fonts.load;
  Object.defineProperty(document.fonts,'ready',{configurable:true,get:()=>new Promise(()=>{})});
  document.fonts.load=()=>new Promise(()=>{});
  const start=performance.now();
  try{const card=await makeTicketCard({id:'font',title:'느린 폰트',author:'',description:'',color:'#1d3b31',createdAt:'',updatedAt:'',messages:[]});return {elapsed:performance.now()-start,size:card.size};}
  finally{document.fonts.load=original;}
 });
 expect(result.elapsed).toBeLessThan(1600);expect(result.size).toBeGreaterThan(0);
});
