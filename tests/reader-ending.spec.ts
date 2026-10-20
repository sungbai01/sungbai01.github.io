import {test,expect} from '@playwright/test';
for(const size of [{width:390,height:844},{width:1280,height:900}])test(`designed back cover closes; next-volume confirmation is centered and cancelable ${size.width}`,async({page})=>{
 await page.setViewportSize(size);await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('/');await page.evaluate(async()=>{const {saveBook}=await import('/src/lib/library.ts');for(let i=1;i<=2;i++)await saveBook({id:'closing-'+i,title:'완결 테스트 · '+i+'권',seriesId:'closing',seriesTitle:'완결 테스트',volumeNumber:i,volumeCount:2,volumePolicy:'chapters-100-v1',author:'테스트',description:'',color:'#286a57',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[{role:'assistant',name:'화자',content:'마지막 이야기. '.repeat(130)}],lastPage:0});});
 await page.goto('/#/book/closing-1');await page.reload();await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 expect(await page.locator('.reader-page[data-density=hard]:not([data-flip-copy])').count()).toBe(1);
 await expect(page.locator('.reader-page[data-page-kind=paper].--hard')).toHaveCount(0);
 const cover=page.locator('.reader-page[data-page-kind=back-cover]:not([data-flip-copy])');
 const coverIndex=await cover.evaluate(el=>Array.from(document.querySelectorAll('.reader-page:not([data-flip-copy])')).indexOf(el));
 const beforeClose=coverIndex-(size.width>=760?2:1);
 await page.locator('.reader-progress').evaluate((el,value)=>{const input=el as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},beforeClose);
 await expect(page.locator('.reader-progress')).toHaveValue(String(beforeClose));
 await page.getByRole('button',{name:'다음 쪽',exact:true}).click();await expect(page.locator('.reader-stage')).toHaveAttribute('data-book-closed','true');await expect(cover.locator('h2')).toHaveText('완결 테스트');
 await page.screenshot({path:`test-results/back-cover-${size.width}.png`});
 const action=page.getByRole('button',{name:'다음 권 읽기',exact:true});await expect(action).toBeVisible();const oldURL=page.url();const oldPage=await page.locator('.reader-progress').inputValue();
 await action.locator('svg').click();const modal=page.getByRole('dialog',{name:'다음 권 읽기',exact:true});await expect(modal).toBeVisible();await expect(page).toHaveURL(oldURL);
 const b=(await modal.boundingBox())!;expect(Math.abs(b.x+b.width/2-size.width/2)).toBeLessThan(3);expect(Math.abs(b.y+b.height/2-size.height/2)).toBeLessThan(3);
 await page.keyboard.press('ArrowLeft');await expect(page.locator('.reader-progress')).toHaveValue(oldPage);await modal.getByRole('button',{name:'취소',exact:true}).click();await expect(modal).not.toBeVisible();await expect(page).toHaveURL(oldURL);
 await action.click();await modal.getByRole('button',{name:'읽기',exact:true}).click();await expect(page).toHaveURL(/closing-2$/);await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 
});
