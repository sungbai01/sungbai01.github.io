import {test,expect,type Page} from '@playwright/test';
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
async function seedShelves(page:Page){
 await page.goto('/');await expect(page.locator('.loading-screen')).toHaveCount(0);
 await page.evaluate(async()=>{
  const {saveBook,saveReadingProgress,deleteAllBooks}=await import('/src/lib/library.ts');
  await deleteAllBooks();
  localStorage.setItem('galpi:initialized','yes');localStorage.setItem('galpi:volumes:100-chapters-v1','yes');
  const date='2026-10-01T00:00:00.000Z';
  for(const [id,title,series,count] of [['target','삭제할 시리즈','target',3],['keep','보존할 시리즈','keep',2],['single','단권 이야기','',2]] as const){
   for(let i=1;i<=count;i++){
    const bookId=`${id}-${i}`;
    await saveBook({id:bookId,title:`${title} · ${i}권`,author:'검증',description:'원본 소개',color:'#1d3b31',createdAt:date,updatedAt:date,messages:[{role:'assistant',name:'캐릭터',content:`${bookId} 원문`},{role:'user',name:'사용자',content:'보존할 사용자 원문'}],lastPage:0,...(series?{seriesId:series,seriesTitle:title,volumeNumber:i,volumeCount:count,volumePolicy:'chapters-100-v1'}:{})});
    if(bookId!=='target-3')await saveReadingProgress(bookId,i+2,`2026-10-0${i+1}T00:00:00.000Z`);
   }
  }
  localStorage.setItem('galpi:stars',JSON.stringify(['target-1','keep-2','single-1']));
 });
 await page.reload();await expect(page.getByRole('button',{name:'삭제할 시리즈 책장 삭제',exact:true})).toBeEnabled();
}
async function snapshot(page:Page){
 return page.evaluate(async()=>{
  const {loadBooks}=await import('/src/lib/library.ts');const books=await loadBooks();
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('risu-bookshelf',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const progress=await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('reading-progress').objectStore('reading-progress').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
  return {books,progress,stars:JSON.parse(localStorage.getItem('galpi:stars')||'[]'),initialized:localStorage.getItem('galpi:initialized')};
 });
}

test('shelf deletion cancel preserves every book, progress and star; no global delete control',async({page})=>{
 await seedShelves(page);const before=await snapshot(page);
 await expect(page.getByRole('button',{name:'모든 책 삭제',exact:true})).toHaveCount(0);
 await expect(page.locator('.site-header button').filter({has:page.locator('svg.lucide-trash-2')})).toHaveCount(0);
 await expect(page.locator('.series-heading .shelf-delete')).toHaveCount(3);
 await page.getByRole('button',{name:'삭제할 시리즈 책장 삭제',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'책장 삭제',exact:true});
 await expect(dialog).toContainText('삭제할 시리즈');await expect(dialog).toContainText('3권');
 await dialog.getByRole('button',{name:'취소',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await snapshot(page)).toEqual(before);await page.reload();await expect(page.locator('.loading-screen')).toHaveCount(0);expect(await snapshot(page)).toEqual(before);
});

for(const filter of ['검색','읽던 책','책갈피'])test(`shelf delete includes hidden series volumes under ${filter} and preserves other books and progress`,async({page})=>{
 await seedShelves(page);const before=await snapshot(page);
 if(filter==='검색')await page.getByRole('textbox',{name:'이야기 검색',exact:true}).fill('삭제할 시리즈 · 1권');
 else await page.getByRole('navigation',{name:'서재 메뉴'}).getByRole('button',{name:new RegExp(`^${filter}`)}).click();
 const shelf=page.locator('.series-shelf[data-series-id="target"]');
 await expect(shelf.locator('.book-item')).toHaveCount(filter==='읽던 책'?2:1);
 await shelf.getByRole('button',{name:'삭제할 시리즈 책장 삭제',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'책장 삭제',exact:true});await expect(dialog).toContainText('3권');
 await dialog.getByRole('button',{name:'책장 삭제',exact:true}).click();await expect(dialog).toHaveCount(0);
 const expected={...before,books:before.books.filter((b:any)=>b.seriesId!=='target'),progress:before.progress.filter(p=>!p.id.startsWith('target-')),stars:before.stars.filter((id:string)=>!id.startsWith('target-'))};
 expect(await snapshot(page)).toEqual(expected);
 await page.reload();await expect(page.locator('.loading-screen')).toHaveCount(0);expect(await snapshot(page)).toEqual(expected);
 await expect(page.getByRole('button',{name:'삭제할 시리즈 책장 삭제',exact:true})).toHaveCount(0);
});

test('singleton shelf delete targets only ungrouped books even when search hides one',async({page})=>{
 await seedShelves(page);const before=await snapshot(page);
 await page.getByRole('textbox',{name:'이야기 검색',exact:true}).fill('단권 이야기 · 1권');
 await page.getByRole('button',{name:'단권 책장 삭제',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'책장 삭제',exact:true});await expect(dialog).toContainText('2권');
 await dialog.getByRole('button',{name:'책장 삭제',exact:true}).click();await expect(dialog).toHaveCount(0);
 const expected={...before,books:before.books.filter((b:any)=>!!b.seriesId),progress:before.progress.filter(p=>!p.id.startsWith('single-')),stars:before.stars.filter((id:string)=>!id.startsWith('single-'))};
 expect(await snapshot(page)).toEqual(expected);await page.reload();await expect(page.locator('.loading-screen')).toHaveCount(0);expect(await snapshot(page)).toEqual(expected);
});

test('old short automatic volumes are rejoined once and chapter-policy volumes survive reload',async({page})=>{
 await page.goto('/');await expect(page.locator('.loading-screen')).toHaveCount(0);await expect(page.locator('.series-heading').first()).toBeVisible();await page.evaluate(async()=>{
  const {saveBook}=await import('/src/lib/library.ts');localStorage.removeItem('galpi:volumes:100-chapters-v1');
  for(let i=0;i<3;i++)await saveBook({id:i?'old--part-'+(i+2):'old',title:'예전 분권 · '+(i+1)+'권',seriesId:'old',seriesTitle:'예전 분권',volumeNumber:i+1,volumeCount:3,author:'검증',description:'',color:'#1d3b31',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[{role:'assistant',name:'화자',content:'보존할 원문 '+i}],lastPage:0});
 });await page.reload();await expect(page.getByRole('button',{name:'예전 분권 읽기',exact:true})).toBeVisible();
 let books=await page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return(await loadBooks()).filter((b:any)=>b.seriesId==='old');});expect(books.length).toBe(1);expect(books[0].messages.map((m:any)=>m.content)).toEqual(['보존할 원문 0','보존할 원문 1','보존할 원문 2']);
 await page.reload();books=await page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return(await loadBooks()).filter((b:any)=>b.seriesId==='old');});expect(books.length).toBe(1);
});
for(const size of [{width:1280,height:900},{width:390,height:844}])test(`same-series spines have uniform physical dimensions without overflow at ${size.width}px`,async({page})=>{
 await page.setViewportSize(size);await seedShelves(page);
 await page.getByRole('button',{name:'책등 보기',exact:true}).click();
 for(const series of ['target','keep']){
  const spines=page.locator(`.series-shelf[data-series-id="${series}"] .book-spine`);
  await expect(spines).toHaveCount(series==='target'?3:2);
  const dimensions=await spines.evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {width:rect.width,height:rect.height};}));
  expect(dimensions[0].width).toBeGreaterThan(30);expect(dimensions[0].height).toBeGreaterThan(180);
  for(const dimension of dimensions){expect(dimension.width).toBeCloseTo(dimensions[0].width,1);expect(dimension.height).toBeCloseTo(dimensions[0].height,1);}
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/spines-${size.width}.png`,fullPage:true});
});
