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
 await expect(page.getByRole('button',{name:'책 페이지에서 대사 선택',exact:true})).toBeDisabled();
 const fits=await page.locator('.share-ticket-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth);
 expect(fits).toBe(true);
 await page.evaluate(()=>(window as any).finishBook());
 await expect(page.getByRole('button',{name:'책 페이지에서 대사 선택',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'카드로 공유',exact:true}).click();
 await expect(page.getByRole('button',{name:'카드 이미지 저장',exact:true})).toBeEnabled();
 await expect(page.locator('.share-ticket-render')).toBeVisible();
 await expect(page.locator('.share-ticket-tools button').first()).toHaveCSS('border-radius','6px');
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

