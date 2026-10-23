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
 const fits=await page.locator('.share-ticket-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth);
 expect(fits).toBe(true);
 await page.evaluate(()=>(window as any).finishBook());
 await expect(page.getByRole('button',{name:'공유할 대사 선택',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'카드 이미지 저장',exact:true})).toBeEnabled();
 await expect(page.locator('.share-ticket-render')).toBeVisible();
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
 await page.getByRole('button',{name:'닫기',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'책 공유'})).toHaveCount(0);
 expect(errors).toEqual([]);
});


test('HTML copy creates its link and includes body images without extra options',async({page})=>{
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
 await expect(page.getByRole('button',{name:'카드 HTML 복사',exact:true})).toBeEnabled();
 expect(calls).toEqual([]);
 await page.getByRole('button',{name:'카드 HTML 복사',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'복사했어요.'})).toBeVisible();
 expect(calls.map(call=>[call.method,call.role])).toEqual([['GET',null],['POST',null],['POST','asset'],['POST','card']]);
 expect(await page.evaluate(()=>(window as any).copied)).toContain('#/share/'+'a'.repeat(43));
 await page.getByRole('button',{name:'카드 HTML 복사',exact:true}).click();
 expect(calls.length).toBe(4);
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
