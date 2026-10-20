import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());});
async function seed(page:any){await page.goto('/');await page.evaluate(async()=>{const {saveBook}=await import('/src/lib/library.ts');await saveBook({id:'editable',title:'편집할 책',author:'테스트',description:'',color:'#1d3b31',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:Array.from({length:8},(_,i)=>({role:'assistant',name:'화자 '+i,content:i+' '+('이야기가 이어진다.\n').repeat(30)})),lastPage:0});});await page.reload();}
test('reader edit saves selected message and survives reload; cancel preserves source',async({page})=>{
 await seed(page);await page.goto('/#/book/editable');await page.reload();await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'본문 편집',exact:true}).click();await expect(page.getByRole('dialog',{name:'본문 편집',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'대화 내용',exact:true}).fill('취소될 내용');await page.getByRole('button',{name:'편집 취소',exact:true}).click();
 await page.getByRole('button',{name:'본문 편집',exact:true}).click();await expect(page.getByRole('textbox',{name:'대화 내용',exact:true})).not.toHaveValue('취소될 내용');
 await page.getByRole('textbox',{name:'대화 내용',exact:true}).fill('수정한 본문\n\n공백과 😀 이모지를 보존합니다.');await page.getByRole('textbox',{name:'화자',exact:true}).fill('바뀐 화자');await page.getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'본문 편집',exact:true})).not.toBeVisible();await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 await page.reload();await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');
 const stored=await page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return (await loadBooks()).find((b:any)=>b.id==='editable');});
 expect(stored.messages[0].content).toBe('수정한 본문\n\n공백과 😀 이모지를 보존합니다.');expect(stored.messages[0].name).toBe('바뀐 화자');expect(stored.messages.length).toBe(8);
});
test('clear-all cancel is safe; confirm clears books and progress without respawning samples',async({page})=>{
 await seed(page);await page.getByRole('button',{name:'모든 책 삭제',exact:true}).click();const dialog=page.locator('dialog[open]');await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'취소',exact:true}).click();await expect(page.getByRole('button',{name:'편집할 책 읽기',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'모든 책 삭제',exact:true}).click();await page.locator('dialog[open]').getByRole('button',{name:'모든 책 삭제',exact:true}).click();
 await expect(page.getByText('책이 없어요',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('책이 없어요',{exact:true})).toBeVisible();
 const counts=await page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');const books=await loadBooks();const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('risu-bookshelf',2);r.onsuccess=()=>resolve(r.result);});const count=await new Promise<number>(resolve=>{const r=db.transaction('reading-progress').objectStore('reading-progress').count();r.onsuccess=()=>resolve(r.result);});db.close();return {books:books.length,progress:count};});expect(counts).toEqual({books:0,progress:0});
});
test('old short automatic volumes are rejoined once and chapter-policy volumes survive reload',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'모든 책 삭제',exact:true})).toBeEnabled();await page.evaluate(async()=>{
  const {saveBook}=await import('/src/lib/library.ts');localStorage.removeItem('galpi:volumes:100-chapters-v1');
  for(let i=0;i<3;i++)await saveBook({id:i?'old--part-'+(i+2):'old',title:'예전 분권 · '+(i+1)+'권',seriesId:'old',seriesTitle:'예전 분권',volumeNumber:i+1,volumeCount:3,author:'검증',description:'',color:'#1d3b31',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[{role:'assistant',name:'화자',content:'보존할 원문 '+i}],lastPage:0});
 });await page.reload();await expect(page.getByRole('button',{name:'예전 분권 읽기',exact:true})).toBeVisible();
 let books=await page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return(await loadBooks()).filter((b:any)=>b.seriesId==='old');});expect(books.length).toBe(1);expect(books[0].messages.map((m:any)=>m.content)).toEqual(['보존할 원문 0','보존할 원문 1','보존할 원문 2']);
 await page.reload();books=await page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return(await loadBooks()).filter((b:any)=>b.seriesId==='old');});expect(books.length).toBe(1);
});
test('spine shelf remains readable without horizontal overflow on mobile and desktop',async({page})=>{
 await seed(page);
 for(const size of [{width:1280,height:900},{width:390,height:844}]){
  await page.setViewportSize(size);await page.getByRole('button',{name:'책등 보기',exact:true}).click();await expect(page.locator('.book-spine').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/spines-${size.width}.png`,fullPage:true});
 }
});

