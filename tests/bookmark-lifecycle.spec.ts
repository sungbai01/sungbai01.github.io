import {test,expect,type Page} from '@playwright/test';
async function marks(page:Page){return page.evaluate(async()=>{const {loadBooks}=await import('/src/lib/library.ts');return (await loadBooks()).filter(b=>b.seriesId==='bookmark-spec').flatMap(b=>(b.bookmarks??[]).map(m=>({book:b.id,...m})));});}
async function ready(page:Page){await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy','false');}
async function position(page:Page,index:number){await page.locator('.reader-progress').fill(String(index));await expect(page.locator('.reader-progress')).toHaveValue(String(index));}
for(const viewport of [{width:1280,height:900},{width:390,height:844}])test(`bookmark lifecycle ${viewport.width}`,async({page})=>{
 await page.setViewportSize(viewport);
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
 await page.goto('/');await page.evaluate(async()=>{
  const {saveBook}=await import('/src/lib/library.ts');localStorage.setItem('galpi:initialized','yes');
  for(let i=1;i<=2;i++)await saveBook({id:'bookmark-spec-'+i,title:'책갈피 검증 · '+i+'권',author:'검증',description:'',color:'#284c40',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',seriesId:'bookmark-spec',seriesTitle:'책갈피 검증',volumeNumber:i,volumeCount:2,volumePolicy:'chapters-100-v1',messages:Array.from({length:24},(_,n)=>({role:'assistant',name:'화자',content:n+' '+('오래된 책을 펼쳐 이야기를 읽었다. 바람이 창가를 스쳤다. '.repeat(40))}))});
 });
 await page.goto('/#/book/bookmark-spec-1');await page.reload();await ready(page);
 await page.getByRole('button',{name:'현재 위치에 책갈피',exact:true}).click();await expect.poll(()=>marks(page)).toHaveLength(1);
 await expect(page.getByRole('button',{name:'책갈피 제거',exact:true})).toBeEnabled();
 const slip=page.locator('.reader-page:not([data-flip-copy]) .reader-bookmark-slip');
 await expect(slip).toHaveCount(1);
 const ratio=await slip.evaluate(e=>{const b=e.getBoundingClientRect();return b.height/b.width;});expect(ratio).toBeCloseTo(5,1);
 const first=(await marks(page))[0];await position(page,4);
 await page.getByRole('button',{name:'현재 위치로 책갈피 옮기기',exact:true}).click();
 await expect.poll(async()=>JSON.stringify((await marks(page))[0])).not.toBe(JSON.stringify(first));
 await expect(page.getByRole('button',{name:'책갈피 제거',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'책갈피 제거',exact:true}).click();await expect.poll(()=>marks(page)).toHaveLength(0);
 await page.getByRole('button',{name:'현재 위치에 책갈피',exact:true}).click();await expect.poll(()=>marks(page)).toHaveLength(1);
 await expect(slip).toBeVisible();const box=await slip.boundingBox();
 await page.mouse.move(box!.x+box!.width/2,box!.y+Math.min(40,box!.height/3));await page.mouse.down();await page.mouse.move(box!.x+box!.width/2,box!.y-30,{steps:6});await page.mouse.up();await expect.poll(()=>marks(page)).toHaveLength(0);
 await position(page,6);await page.getByRole('button',{name:'책을 닫고 서재로 돌아가기',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'책갈피 확인'})).toBeVisible();await page.getByRole('button',{name:'꽂고 나가기',exact:true}).click();await expect(page.locator('.reader')).toHaveCount(0);await expect.poll(()=>marks(page)).toHaveLength(1);
 await page.getByRole('button',{name:'책갈피 검증 · 1권 읽기',exact:true}).click();await ready(page);await expect(page.locator('.reader-progress')).toHaveValue('6');
 await position(page,8);await page.getByRole('button',{name:'책을 닫고 서재로 돌아가기',exact:true}).click();await page.getByRole('button',{name:'옮기고 나가기',exact:true}).click();await expect(page.locator('.reader')).toHaveCount(0);
 await page.getByRole('button',{name:'책갈피 검증 · 2권 읽기',exact:true}).click();await ready(page);await page.getByRole('button',{name:'현재 위치로 책갈피 옮기기',exact:true}).click();await expect.poll(()=>marks(page)).toHaveLength(1);await expect.poll(async()=>(await marks(page))[0]?.book).toBe('bookmark-spec-2');
 await page.getByRole('button',{name:'책갈피 제거',exact:true}).click();await expect.poll(()=>marks(page)).toHaveLength(0);
});
