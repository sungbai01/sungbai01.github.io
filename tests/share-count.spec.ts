import {test,expect} from '@playwright/test';
test('drawer share badge refreshes active count and title wrapping keeps words',async({page})=>{
 await page.goto('http://127.0.0.1:5175/');let count=3;
 await page.route('**/library/shares?count=1',route=>route.fulfill({json:{activeCount:count}}));
 await page.evaluate(async()=>{
  const {setAuthSession}=await import('/src/lib/auth.ts');setAuthSession({token:'test',expiresAt:Date.now()+3600000,user:{id:'u_'+'a'.repeat(43)}});
 });
 await page.getByRole('button',{name:'서재 메뉴 열기',exact:true}).click();await expect(page.getByRole('status',{name:'공유 중 3개',exact:true})).toHaveText('3');count=1;await page.evaluate(()=>dispatchEvent(new Event('galpi:shares-changed')));await expect(page.getByRole('status',{name:'공유 중 1개',exact:true})).toHaveText('1');
 const style=await page.locator('.share-count-badge').evaluate(el=>({radius:getComputedStyle(el).borderRadius,color:getComputedStyle(el).color}));expect(style.radius).toBe('6px');await expect(page.getByRole('button',{name:'목록 새로고침',exact:true})).toHaveCount(0);const neutral=await page.locator('.share-count-badge').evaluate(el=>getComputedStyle(el).color===getComputedStyle(el).getPropertyValue('--brand-red-ink').trim());expect(neutral).toBe(false);
});
