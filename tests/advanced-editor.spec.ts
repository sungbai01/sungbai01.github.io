import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`advanced editor keeps drafts on errors and cancelled close at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('http://127.0.0.1:5175/');await page.evaluate(async()=>{const {mountAdvanced}=await import('/tests/advanced-editor-harness.tsx');mountAdvanced();});
 const editor=page.getByRole('dialog',{name:'고급 수정',exact:true}),field=editor.getByRole('textbox',{name:'본문',exact:true});await expect(editor).toBeVisible();await editor.evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished));});
 const box=(await editor.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(901);
 await field.fill('긴 수정 본문\n\n두 번째 줄');await editor.getByRole('button',{name:'취소',exact:true}).click();await expect(editor.getByRole('alertdialog')).toBeVisible();await editor.getByRole('button',{name:'계속 편집',exact:true}).click();await expect(field).toHaveValue('긴 수정 본문\n\n두 번째 줄');
 await page.evaluate(()=>(window as any).failEditorSave=true);await editor.getByRole('button',{name:'저장',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('저장 실패 테스트');await expect(field).toHaveValue('긴 수정 본문\n\n두 번째 줄');
 await page.evaluate(()=>(window as any).failEditorSave=false);await editor.getByRole('button',{name:'저장',exact:true}).click();await expect(editor).toHaveCount(0);expect(await page.evaluate(()=>(window as any).savedEditorBook.messages[0].content)).toBe('긴 수정 본문\n\n두 번째 줄');expect(await page.evaluate(()=>(window as any).savedEditorBook.messages[1].content)).toBe('둘째 본문');
});
test('advanced editor discard closes without writing',async({page})=>{
 await page.goto('http://127.0.0.1:5175/');await page.evaluate(async()=>{const {mountAdvanced}=await import('/tests/advanced-editor-harness.tsx');mountAdvanced();});const editor=page.getByRole('dialog',{name:'고급 수정',exact:true});await editor.getByRole('textbox',{name:'본문',exact:true}).fill('버릴 내용');await page.keyboard.press('Escape');await expect(editor.getByRole('alertdialog')).toBeVisible();await editor.getByRole('button',{name:'버리고 닫기',exact:true}).click();await expect(editor).toHaveCount(0);expect(await page.evaluate(()=>(window as any).savedEditorBook)).toBeUndefined();
});
