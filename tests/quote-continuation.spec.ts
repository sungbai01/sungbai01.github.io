import {test,expect} from '@playwright/test';
test('quote selection survives turning pages and combines subsequent selection once',async({page})=>{
 await page.goto('http://127.0.0.1:5175/');await page.evaluate(async()=>{const {mountContinuation}=await import('/tests/quote-continuation-harness.tsx');mountContinuation();});
 const select=()=>page.locator('.reader-prose').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 await select();await expect(page.getByRole('status')).toContainText('8 /');await page.getByRole('button',{name:'다음 페이지',exact:true}).click();await expect(page.locator('.reader-prose')).toHaveText('다음 페이지 문장');await expect(page.getByRole('status')).toContainText('8 /');await select();await page.getByRole('button',{name:'선택한 대사 첨부',exact:true}).click();expect(await page.evaluate(()=>(window as any).continuation)).toEqual({text:'첫 페이지 문장\n다음 페이지 문장',pages:{start:1,end:2}});
});
