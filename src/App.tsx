import { lazy, Suspense, useCallback, useEffect, useRef, useState, useId, type CSSProperties, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Bookmark, Check, ChevronDown, Ellipsis, Library, LoaderCircle, Pencil, Images, Plus, Search, Settings2, Trash2, Upload, X } from 'lucide-react';
import { loadBooks, saveBook, repackSeries, deleteBook, deleteBooks, importChatFile, BOOK_COLORS, type Book } from './lib/library';
import { groupBooks } from './lib/volumes';
import { prepareBooks } from './lib/prepareBooks';
import { sampleBooks } from './lib/sample';
import ShelfAssets from './components/ShelfAssets';
import BookIntake,{type IntakeRequest} from './components/BookIntake';
import { portraitPalette } from './lib/assets';

type BookAsset = NonNullable<Book['assets']>[number];
type BookmarkAnchor={message:number;char:number;label?:string};
type ShelfBookmark=BookmarkAnchor&{bookId:string;title:string;style?:'normal'|'character';icon?:string};
function bookShelf(book:Book):ShelfTarget{return {id:book.seriesId??'ungrouped',title:book.seriesTitle??'단권',ungrouped:!book.seriesId};}
function displayBookTitle(book:Book){return book.title.replace(/\s*·\s*\d+권\s*$/, '').trim()||book.title;}
function portrait(book:Book){return book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;}
function canonicalBookmark(books:Book[]):ShelfBookmark|undefined{
  let selected:Book|undefined;
  for(const book of books)if(book.bookmarks?.length&&(!selected||book.updatedAt>selected.updatedAt||(book.updatedAt===selected.updatedAt&&book.id>selected.id)))selected=book;
  const anchor=selected?.bookmarks?.at(-1);
  return selected&&anchor?{...anchor,bookId:selected.id,title:selected.title,style:selected.bookmarkStyle??'normal',icon:portrait(selected)}:undefined;
}
function BookmarkBadge({mark}:{mark:ShelfBookmark}){return <>{mark.style==='character'&&mark.icon?<img className="bookmark-character" src={mark.icon} alt=""/>:<Bookmark size={15}/>}<span className="bookmark-strip-title">{mark.title.replace(/\s*·\s*\d+권\s*$/, '')}</span></>;}
type ShelfTarget = {id:string;title:string;ungrouped:boolean};
function shelfBooks(books:Book[],shelf:ShelfTarget){return books.filter(book=>shelf.ungrouped?!book.seriesId:(book.seriesId??book.id)===shelf.id).sort((a,b)=>(a.volumeNumber??1)-(b.volumeNumber??1));}
function shelfAssets(books:Book[],shelf:ShelfTarget):BookAsset[]{return [...new Map(shelfBooks(books,shelf).flatMap(book=>book.assets??[]).map(asset=>[asset.id,asset])).values()];}

function collapseShelfBookmarks(siblings:Book[]):Book[]{
  if(siblings.reduce((count,book)=>count+(book.bookmarks?.length??0),0)<=1)return siblings;
  const mark=canonicalBookmark(siblings)!;
  return siblings.map(book=>{
    if(!book.bookmarks?.length)return book;
    const bookmarks=book.id===mark.bookId?[book.bookmarks.at(-1)!]:[];
    return bookmarks.length===book.bookmarks.length?book:{...book,bookmarks};
  });
}
async function normalizeShelfBookmarks(books:Book[]):Promise<Book[]>{
  const shelves=new Map<string,Book[]>();
  for(const book of books){
    const shelf=bookShelf(book);const key=shelf.ungrouped?'singletons':`series:${shelf.id}`;
    const siblings=shelves.get(key)??[];siblings.push(book);shelves.set(key,siblings);
  }
  const replacements=new Map<string,Book>();
  for(const siblings of shelves.values()){
    const normalized=collapseShelfBookmarks(siblings);
    if(normalized===siblings)continue;
    // Persist one mark across the full shelf without changing its content or metadata.
    await repackSeries(normalized[0]!.id,normalized,[]);
    for(const book of normalized)replacements.set(book.id,book);
  }
  return replacements.size?books.map(book=>replacements.get(book.id)??book):books;
}

function equalRows<T>(left:T[]|undefined,right:T[]|undefined,fields:readonly (keyof T)[]):boolean{
  if(left===right)return true;
  return !!left&&!!right&&left.length===right.length&&left.every((row,index)=>
    row===right[index]||fields.every(field=>row[field]===right[index]![field]));
}
function reuseBookReferences(book:Book,previous:Book|undefined):Book{
  if(!previous||book===previous)return book;
  const next={...book};
  if(equalRows(book.messages,previous.messages,['role','name','content','chapter']))next.messages=previous.messages;
  if(equalRows(book.assets,previous.assets,['id','name','src','type']))next.assets=previous.assets;
  if(equalRows(book.bookmarks,previous.bookmarks,['message','char','label']))next.bookmarks=previous.bookmarks;
  const fields=new Set([...Object.keys(previous),...Object.keys(next)]);
  return [...fields].every(field=>next[field as keyof Book]===previous[field as keyof Book])?previous:next;
}

const Reader = lazy(() => import('./components/Reader'));
const colors = BOOK_COLORS;
const key = 'galpi:initialized';
const legacySampleColors:Record<string,string> = {'sample-forest-letter':'#596B55','sample-terracotta-evening':'#AD715B','sample-indigo-platform':'#5C6386','sample-ochre-bookshop':'#A68A4D'};
function currentBookId() { try { const match = location.hash.match(/^#\/book\/([^/]+)$/); return match ? decodeURIComponent(match[1]) : null; } catch { return null; } }
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function storeBooks(incoming:Book[],existing:Book[]){
  if(incoming.length)await repackSeries(incoming[0]!.id,incoming,[]);
  const byId=new Map(incoming.map(book=>[book.id,book]));const existingIds=new Set(existing.map(book=>book.id));
  return normalizeShelfBookmarks([...existing.map(book=>byId.get(book.id)??book),...incoming.filter(book=>!existingIds.has(book.id))]);
}

function Modal({title, children, onClose, wide=false, locked=false}: {title:string; children:ReactNode; onClose:()=>void; wide?:boolean; locked?:boolean}) {
  const ref = useRef<HTMLDialogElement>(null);const titleId=useId();
  useEffect(()=>{const dialog=ref.current!; dialog.showModal(); return ()=>dialog.close();},[]);
  return <dialog className={`modal ${wide?'modal-wide':''}`} ref={ref} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!locked)onClose();}} onClick={e=>{if(!locked&&e.target===e.currentTarget)onClose();}}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-btn" title="닫기" aria-label="닫기" disabled={locked} onClick={onClose}><X size={20}/></button></div>{children}
  </dialog>;
}

function Cover({book, small=false}: {book:Book;small?:boolean}) {
  const icon=portrait(book);
  return <div className={`book-cover ${small?'cover-small':''}`} style={{'--cover':book.color || colors[0]} as CSSProperties}>
    {book.cover && <img className="cover-image" src={book.cover} alt=""/>}
    <div className="cover-content"><h3>{displayBookTitle(book)}</h3><div className="cover-portrait">{icon?<img src={icon} alt={`${book.author||'캐릭터'} 초상`}/>:<span className="cover-ornament" aria-hidden="true">✳</span>}</div><span className="cover-volume">{String(book.volumeNumber??1).padStart(2,'0')}</span></div>
  </div>;
}

function EditBook({book,onSave,onClose,scope='book'}:{book:Book;onSave:(book:Book,reset:boolean)=>Promise<void>;onClose:()=>void;scope?:'book'|'shelf'}){
  const [draft,setDraft]=useState(book);const [reset,setReset]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  function defaults(){setReset(true);setDraft(previous=>({...previous,color:colors[0]!,customColor:undefined,cover:undefined,backCover:undefined,characterIcon:undefined,assets:previous.assets?.map(asset=>asset.type==='icon'?{...asset,type:'asset' as const}:asset)}));}
  return <Modal title={scope==='shelf'?'책 꾸미기':`책 꾸미기 · ${String(book.volumeNumber??1).padStart(2,'0')}`} onClose={onClose} wide locked={busy}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSave({...draft,title:draft.title.trim()},reset);onClose();}catch(e){setError(e instanceof Error?e.message:'저장하지 못했어요.');}finally{setBusy(false);}}}>
    <div className="edit-layout"><div className="cover-previews"><Cover book={draft}/></div><div className="space-y-4">
      <label className="field">책 제목<input required maxLength={100} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
      <label className="field">등장인물 · 작가<input maxLength={100} value={draft.author} onChange={e=>setDraft({...draft,author:e.target.value})}/></label>
      <label className="field">책 소개<textarea rows={3} maxLength={600} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      <div className="field">표지 색<div className="cover-swatches">{colors.map(color=><button key={color} type="button" className="swatch" aria-label={`${color} 표지`} aria-pressed={draft.color===color} style={{background:color}} onClick={()=>setDraft({...draft,color})}>{draft.color===color&&<Check size={15}/>}</button>)}<label className="swatch custom-color-swatch" title="사용자 지정 색" style={{background:draft.customColor??draft.color}}><input type="color" aria-label="사용자 지정 표지 색" value={draft.customColor??draft.color} onChange={e=>setDraft({...draft,color:e.target.value,customColor:e.target.value})}/>{draft.color===draft.customColor?<Check size={15}/>:<Plus size={13}/>}</label></div></div>
      <button type="button" className="secondary-btn" title="표지와 캐릭터 초상을 기본값으로 되돌리기" disabled={busy} onClick={defaults}>기본값으로</button>
    </div></div>
    {error&&<p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>취소</button><button className="primary-btn" disabled={busy||!draft.title.trim()}>{busy?<LoaderCircle size={16} className="animate-spin"/>:<Check size={16}/>} 저장하기</button></div>
  </form></Modal>;
}
function styleBook(book:Book,draft:Book,reset:boolean):Book{
  return {...book,author:draft.author,description:draft.description,color:draft.color,customColor:draft.customColor,
    ...(reset?{cover:undefined,backCover:undefined,characterIcon:undefined,assets:book.assets?.some(asset=>asset.type==='icon')?book.assets.map(asset=>asset.type==='icon'?{...asset,type:'asset' as const}:asset):book.assets}:{})};
}


export default function App() {
  const [books,setBooks]=useState<Book[]>([]); const [loading,setLoading]=useState(true);const [error,setError]=useState(''); const [toast,setToast]=useState('');
  const [route,setRoute]=useState(currentBookId);const [readerStart,setReaderStart]=useState<{bookId:string;anchor:BookmarkAnchor}|null>(null); const [query,setQuery]=useState(''); const [tab,setTab]=useState('all');const [sort,setSort]=useState('recent');const canEdit=tab==='all';
  const [importing,setImporting]=useState(false);const [busy,setBusy]=useState(false);const [info,setInfo]=useState(false);const [edit,setEdit]=useState<Book|null>(null);const [remove,setRemove]=useState<Book|null>(null);const [menu,setMenu]=useState<string|null>(null);const [view,setView]=useState<'covers'|'spines'>('covers');
  const [clearConfirm,setClearConfirm]=useState<{title:string;ids:string[]}|null>(null);const [deleting,setDeleting]=useState(false);const [clearError,setClearError]=useState('');
  const [creating,setCreating]=useState<ShelfTarget|null>(null);const [renaming,setRenaming]=useState<ShelfTarget|null>(null);const [assetShelf,setAssetShelf]=useState<ShelfTarget|null>(null);
  const deletingRef=useRef(false);const editingShelf=useRef(false);
  const restore=useRef<HTMLInputElement>(null);const latestBooks=useRef(books); latestBooks.current=books;
  const splittingBooks=useRef(new Set<string>());
  const initialLoad=useRef<Promise<Book[]>|null>(null);
  useEffect(()=>{
    let active=true;
    initialLoad.current??=(async()=>{
      let data=await loadBooks();
      for(let i=0;i<data.length;i++){
        const previous=data[i];const sample=sampleBooks.find(book=>book.id===previous.id);
        if(sample&&previous.color===legacySampleColors[previous.id]){data[i]={...previous,color:sample.color};await saveBook(data[i]);}
      }
      if(!localStorage.getItem(key)&&!data.length){for(const book of sampleBooks)await saveBook(book);data=sampleBooks;}
      data=await normalizeShelfBookmarks(data);
      localStorage.setItem(key,'yes');
      return data;
    })();
    void initialLoad.current.then(data=>{if(active){latestBooks.current=data;setBooks(data);}})
      .catch(()=>{if(active)setError('서재를 열지 못했어요. 브라우저의 저장소 접근을 허용한 뒤 새로고침해 주세요.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{const change=()=>{setRoute(currentBookId());setMenu(null);};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),3600);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!menu)return;const close=()=>setMenu(null);document.addEventListener('click',close);return()=>document.removeEventListener('click',close);},[menu]);
  const openBook=useCallback((book:Book)=>{
    const mark=canonicalBookmark(shelfBooks(latestBooks.current,bookShelf(book)));
    setReaderStart(mark?.bookId===book.id?{bookId:book.id,anchor:{message:mark.message,char:mark.char}}:null);
    setRoute(book.id);location.hash=`/book/${encodeURIComponent(book.id)}`;
  },[]);
  const closeBook=useCallback(()=>{setReaderStart(null);location.hash='/';},[]);
  async function commitBooks(ids:string[],make:(current:Book[])=>Book[]){
    if(deletingRef.current||editingShelf.current||splittingBooks.current.size>0)throw new Error('책을 저장 중이에요. 잠시 후 다시 시도해 주세요.');
    editingShelf.current=true;for(const id of ids)splittingBooks.current.add(id);setBusy(true);
    try{
  
      const current=await loadBooks();const updated=make(current);
      if(!updated.length)throw new Error('책장을 찾지 못했어요.');
      await repackSeries(updated[0]!.id,updated,[]);
      const byId=new Map(updated.map(book=>[book.id,book]));
      // Storage returns clones. Preserve live references for untouched books and
      // equal reader inputs so bookmark/metadata saves do not rebuild pages.
      const liveById=new Map(latestBooks.current.map(book=>[book.id,book]));
      const next=current.map(book=>{
        const changed=byId.get(book.id);const live=liveById.get(book.id);
        return changed?reuseBookReferences(changed,live):(live??book);
      });const existing=new Set(current.map(book=>book.id));
      next.push(...updated.filter(book=>!existing.has(book.id)));latestBooks.current=next;setBooks(next);
    }finally{editingShelf.current=false;for(const id of ids)splittingBooks.current.delete(id);setBusy(false);}
  }
  const updateBook=async(book:Book)=>{
    if(!canEdit)return;
    const baseline=books.find(item=>item.id===book.id);
    if(!baseline)throw new Error('책을 찾지 못했어요.');
    // Reader text saves retain shelf metadata; bookmark changes use the sibling transaction.
    const patch:Partial<Book>={};
    if(book.messages!==baseline.messages)patch.messages=book.messages;
    if(book.bookmarks!==baseline.bookmarks)patch.bookmarks=book.bookmarks;

    if(book.updatedAt!==baseline.updatedAt)patch.updatedAt=book.updatedAt;
    await commitBooks([book.id],current=>{
      const stored=current.find(item=>item.id===book.id);if(!stored)throw new Error('책을 찾지 못했어요.');
      return [{...stored,...patch}];
    });
  };
  async function changeBookmark(book:Book,anchor:BookmarkAnchor|null,style?:'normal'|'character'){
    const shelf=bookShelf(book);const ids=shelfBooks(latestBooks.current,shelf).map(item=>item.id);
    await commitBooks(ids,current=>{
      const siblings=shelfBooks(current,shelf);if(!siblings.some(item=>item.id===book.id))throw new Error('책을 찾지 못했어요.');
      const chosenStyle=style??canonicalBookmark(siblings)?.style??book.bookmarkStyle??'normal';
      return siblings.map(item=>({...item,bookmarks:anchor&&item.id===book.id?[anchor]:[],bookmarkStyle:chosenStyle,...(anchor&&item.id===book.id?{updatedAt:new Date().toISOString()}:{})}));
    });
  }
  async function changeBookmarkStyle(book:Book,style:'normal'|'character'){
    const shelf=bookShelf(book);
    await commitBooks(shelfBooks(latestBooks.current,shelf).map(item=>item.id),current=>{
      const siblings=shelfBooks(current,shelf);const mark=canonicalBookmark(siblings);
      return siblings.map(item=>({...item,bookmarkStyle:style,bookmarks:mark&&item.id===mark.bookId?[{message:mark.message,char:mark.char,...(mark.label!==undefined?{label:mark.label}:{})}]:[]}));
    });
  }
  const decorateBook=async(draft:Book,reset:boolean)=>{
    if(!canEdit)return;
    await commitBooks([draft.id],current=>{
      const stored=current.find(book=>book.id===draft.id);if(!stored)throw new Error('책을 찾지 못했어요.');
      return [{...styleBook(stored,draft,reset),title:draft.title}];
    });
  };
  async function decorateShelf(shelf:ShelfTarget,draft:Book,reset:boolean){
    if(!canEdit)return;
    const ids=shelfBooks(latestBooks.current,shelf).map(book=>book.id);const seriesId=shelf.ungrouped?crypto.randomUUID():shelf.id;
    await commitBooks(ids,current=>{const siblings=shelfBooks(current,shelf);return siblings.map((book,index)=>({...styleBook(book,draft,reset),seriesId,seriesTitle:draft.title,title:`${draft.title} · ${index+1}권`,volumeNumber:index+1,volumeCount:siblings.length}));});
    setToast('책장을 꾸몄어요.');
  }
  async function intakeBooks(request:IntakeRequest){
    if(!canEdit||busy||editingShelf.current||deletingRef.current)throw new Error('저장이 끝난 뒤 다시 시도해 주세요.');
    let incoming:Book[]=[];
    if(request.mode==='file'){
      const failures:string[]=[];
      for(const file of request.files){try{incoming.push(...await importChatFile(file,{removeUserInputs:request.removeUserInputs}));}catch(cause){failures.push(`${file.name}: ${cause instanceof Error?cause.message:'파일을 읽지 못했어요.'}`);}}
      if(failures.length)throw new Error(failures.join('\n'));
    }else{
      const now=new Date().toISOString();
      incoming=[{id:crypto.randomUUID(),title:request.title,author:request.name,description:request.text.slice(0,160),color:colors[0]!,createdAt:now,updatedAt:now,messages:[{role:'assistant',name:request.name,content:request.text}]}];
    }
    const target=creating;const siblings=target?shelfBooks(latestBooks.current,target):[];
    if(target&&siblings.length)incoming=incoming.map(book=>({...book,assets:shelfAssets(latestBooks.current,target),characterIcon:portrait(siblings[0]!),color:siblings[0]!.color,customColor:siblings[0]!.customColor}));
    // Parse every staged file first. Preparation happens once, before any write.
    const prepared=await prepareBooks(incoming,{removeEmoji:request.removeEmoji});
    if(!prepared.length)throw new Error('추가할 본문이 없어요.');
    await commitBooks(siblings.map(book=>book.id),current=>{
      const occupied=new Set(current.map(book=>book.id));const remap=new Map<string,string>();
      for(const book of prepared){let id=book.id;while(occupied.has(id))id=crypto.randomUUID();occupied.add(id);remap.set(book.id,id);}
      const fresh=prepared.map(book=>({...book,id:remap.get(book.id)!,...(book.seriesId?{seriesId:remap.get(book.seriesId)??book.seriesId}:{})}));
      if(!target||target.ungrouped)return fresh;
      const fullSiblings=shelfBooks(current,target);if(!fullSiblings.length)throw new Error('대상 책장을 찾지 못했어요.');
      const count=fullSiblings.length+fresh.length;
      return [...fullSiblings.map(book=>({...book,volumeCount:count})),...fresh.map((book,index)=>({...book,seriesId:target.id,seriesTitle:fullSiblings[0]!.seriesTitle??target.title,title:`${fullSiblings[0]!.seriesTitle??target.title} · ${fullSiblings.length+index+1}권`,volumeNumber:fullSiblings.length+index+1,volumeCount:count}))];
    });
    setTab('all');setQuery('');setToast(`${prepared.length}권의 책을 추가했어요.`);
  }
  async function saveShelfAssets(shelf:ShelfTarget,assets:BookAsset[]){
    if(!canEdit)return;
    const icon=assets.find(asset=>asset.type==='icon')??assets[0];
    const palette=icon?await portraitPalette(icon.src):undefined;
    await commitBooks(shelfBooks(latestBooks.current,shelf).map(book=>book.id),current=>shelfBooks(current,shelf).map(book=>({...book,assets,characterIcon:icon?.src,...(palette?{color:palette,customColor:palette}:assets.length?{}:{cover:undefined,backCover:undefined,color:colors[0]!,customColor:undefined})})));
    setToast('에셋을 저장했어요.');
  }
  async function backupBooks(){
    if(!clearConfirm)return;

    const targetIds=new Set(clearConfirm.ids);
    const persisted=(await loadBooks()).filter(book=>targetIds.has(book.id));
    download(clearConfirm.title+'-'+new Date().toISOString().slice(0,10)+'.json',{format:'galpi-backup',version:1,volumePolicy:'chapters-100-v1',books:persisted});
    setToast('백업 완료');
  }
  async function clearBooks(){
    if(!canEdit||!clearConfirm||deletingRef.current||busy||loading)return;
    if(splittingBooks.current.size){setClearError('책을 저장 중이에요. 잠시 후 다시 시도해 주세요.');return;}
    deletingRef.current=true;setDeleting(true);setBusy(true);setClearError('');
    try{
  
      const targetIds=new Set(clearConfirm.ids);
      await deleteBooks([...targetIds]);
      const remaining=latestBooks.current.filter(book=>!targetIds.has(book.id));
      latestBooks.current=remaining;setBooks(remaining);
      if(targetIds.has(currentBookId()??'')){setRoute(null);location.hash='/';}
      setMenu(null);if(edit&&targetIds.has(edit.id))setEdit(null);if(remove&&targetIds.has(remove.id))setRemove(null);setClearConfirm(null);
      setToast('책장을 삭제했어요.');
    }catch{setClearError('삭제하지 못했어요. 다시 시도해 주세요.');}
    finally{deletingRef.current=false;setDeleting(false);setBusy(false);}
  }
  async function restoreBackup(file?:File){if(!canEdit||!file||busy)return;setBusy(true);setError('');try{const data=JSON.parse(await file.text());if(data.format!=='galpi-backup'||!Array.isArray(data.books))throw new Error('갈피에서 내보낸 책장 백업 파일을 선택해 주세요.');const normalized=await importChatFile(new File([JSON.stringify(data.books)],'backup.json',{type:'application/json'}),{removeUserInputs:false});const merged=await storeBooks(normalized,await loadBooks());latestBooks.current=merged;setBooks(merged);setToast(`${normalized.length}권을 복원했어요.`);}catch(e){setError(e instanceof Error?e.message:'백업을 복원하지 못했어요.');}finally{setBusy(false);if(restore.current)restore.current.value='';}}
  const selected=books.find(b=>b.id===route);
  const selectedBookmark=selected?canonicalBookmark(shelfBooks(books,bookShelf(selected))):undefined;
  const markedBooks=books.filter(book=>canonicalBookmark(shelfBooks(books,bookShelf(book)))?.bookId===book.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const markedIds=new Set(markedBooks.map(book=>book.id));
  const shown=books.filter(book=>(tab!=='reading'||markedIds.has(book.id))&&`${book.title} ${book.author} ${book.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,'ko'):sort==='oldest'?String(a.createdAt).localeCompare(String(b.createdAt)):String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const groups=groupBooks(shown);
  const singletons:{id:string;title:string;books:Book[]}={id:'ungrouped',title:'단권',books:[]};
  const shelves=groups.reduce<{id:string;title:string;books:Book[]}[]>((rows,group)=>{
    if(group.books.some(book=>book.seriesId)){rows.push(group);return rows;}
    if(!rows.includes(singletons))rows.push(singletons);
    singletons.books.push(...group.books);
    return rows;
  },[]);
  const nextVolume=selected?.seriesId?groupBooks(books).find(group=>group.id===selected.seriesId)?.books.find(book=>(book.volumeNumber??1)>(selected.volumeNumber??1)):undefined;
  const onNextVolume=useCallback(()=>{if(nextVolume)openBook(nextVolume);},[nextVolume,openBook]);
  if(route&&!loading&&selected)return <><Suspense fallback={<div className="loading-screen"><LoaderCircle className="animate-spin"/> 책을 펼치고 있어요</div>}><Reader book={selected} onClose={closeBook} onSaveBook={canEdit?updateBook:undefined} shelfBookmark={selectedBookmark} bookmarkStyle={selectedBookmark?.style??selected.bookmarkStyle??shelfBooks(books,bookShelf(selected)).find(book=>book.bookmarkStyle)?.bookmarkStyle} characterIcon={portrait(selected)??shelfBooks(books,bookShelf(selected)).map(portrait).find(Boolean)} onBookmarkChange={(anchor,style)=>changeBookmark(selected,anchor,style)} onBookmarkStyleChange={style=>changeBookmarkStyle(selected,style)} initialBookmark={readerStart?.bookId===selected.id?readerStart.anchor:undefined} onNextVolume={nextVolume?onNextVolume:undefined} nextVolumeTitle={nextVolume?.title}/></Suspense>{toast&&<div className="toast" role="status">{toast}</div>}</>;
  return <div className="app-shell">
    <header className="site-header" inert={deleting}><a href="#/" className="brand" aria-label="갈피 서재"><span className="brand-mark"><BookOpen size={23} strokeWidth={1.4}/><span/></span><span>갈피<span className="brand-en">galpi</span></span></a><div className="header-right">{canEdit&&<button className="icon-btn" aria-label="저장 및 백업" title="저장 및 백업" onClick={()=>setInfo(true)}><Settings2 size={19}/></button>}</div></header>
    <div className="workspace" inert={deleting}>
      <aside className="sidebar"><nav aria-label="서재 메뉴">{[{id:'all',label:'내 서재',icon:Library,count:groupBooks(books).length},{id:'reading',label:'이어읽기',icon:BookOpen,count:markedBooks.length}].map(item=><button key={item.id} title={item.label} className={'nav-item '+(tab===item.id?'active':'')} onClick={()=>{setTab(item.id);setQuery('');setMenu(null);setEdit(null);setRemove(null);setCreating(null);setRenaming(null);setAssetShelf(null);setClearConfirm(null);setImporting(false);setInfo(false);}}><item.icon size={18} strokeWidth={1.6}/><span>{item.label}</span><small>{item.count.toString().padStart(2,'0')}</small></button>)}</nav>
      </aside>
      <main className="main-content">
        <section className="library-intro"><h1>내 서재</h1>{canEdit&&<button className="primary-btn icon-action" title="책 추가" aria-label="책 추가" onClick={()=>{setError('');setCreating(null);setImporting(true);}}><Plus size={21}/></button>}</section>
        {error&&<div className="error-banner" role="alert">{error}<button className="icon-btn" aria-label="오류 닫기" onClick={()=>setError('')}><X size={16}/></button></div>}
        {route&&!selected&&!loading&&<div className="error-banner">이 브라우저에 저장되지 않은 책이에요.<a href="#/">서재로 돌아가기</a></div>}
        {canEdit&&markedBooks.length>0&&<section className="resume-section" aria-label="이어읽기"><h2>이어읽기</h2><div className="resume-list">{markedBooks.map(book=><button key={book.id} className="resume-link" title="저장한 책갈피에서 이어읽기" onClick={()=>openBook(book)}><Bookmark size={14}/><span>{book.title}</span><ArrowRight size={14}/></button>)}</div></section>}

        <section aria-label="책장" className="collection"><div className="collection-toolbar"><div className="collection-heading"><h2>{tab==='reading'?'이어읽기':'책장'}</h2><span>{groups.length}작품 · {shown.length}권</span></div><div className="collection-controls"><label className="search-box"><Search size={16}/><input aria-label="이야기 검색" placeholder="검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="검색 초기화" onClick={()=>setQuery('')}><X size={14}/></button>}</label><label className="sort-select"><select aria-label="책 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">최근 저장 순</option><option value="oldest">오래된 순</option><option value="title">제목순</option></select><ChevronDown size={13}/></label><button type="button" className="view-toggle" role="switch" aria-label="책등 보기" aria-checked={view==='spines'} title={view==='spines'?'표지 보기로 전환':'책등 보기로 전환'} onClick={()=>setView(value=>value==='covers'?'spines':'covers')}>{view==='spines'?<Library size={17}/>:<BookOpen size={17}/>}</button></div></div>
          {loading?<div className="loading-screen"><LoaderCircle size={22} className="animate-spin"/> 서재를 열고 있어요</div>:shown.length?<div className="shelf-groups">{shelves.map(shelf=>{const mark=canonicalBookmark(shelfBooks(books,{id:shelf.id,title:shelf.title,ungrouped:shelf===singletons}));return <section key={shelf===singletons?'singletons':`series:${shelf.id}`} aria-label={shelf.title} className="series-shelf" data-series-id={shelf.id}>
            <header className="series-heading"><h3>{shelf.title}</h3><span>{shelf.books.length}권</span>{canEdit&&<div className="shelf-actions"><button className="icon-btn" aria-label={`${shelf.title} 책장 꾸미기`} title="책장 꾸미기" disabled={busy} onClick={()=>setRenaming({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons})}><Pencil size={16}/></button><button className="icon-btn" aria-label={`${shelf.title} 에셋 관리`} title="책장 에셋 관리" disabled={busy} onClick={()=>setAssetShelf({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons})}><Images size={17}/></button><button className="icon-btn shelf-delete danger-text" aria-label={`${shelf.title} 책장 삭제`} title={`${shelf.title} 책장 삭제`} disabled={busy||loading||splittingBooks.current.size>0} onClick={()=>{const targets=books.filter(book=>shelf===singletons?!book.seriesId:(book.seriesId??book.id)===shelf.id);setClearError('');setClearConfirm({title:shelf.title,ids:targets.map(book=>book.id)});}}><Trash2 size={17}/></button></div>}</header>
            <div className={view==='covers'?'bookshelf-grid':'spines-shelf'}>{view==='spines'&&<span className="shelf-bookstop shelf-bookstop-start" aria-hidden="true"/>}{shelf.books.map((book,index)=><article key={book.id} className={`book-item ${view==='spines'?'spine-item':''} ${mark?.bookId===book.id?'book-has-bookmark':''}`} data-bookmarked={mark?.bookId===book.id||undefined} style={{'--cover':book.color,'--delay':`${Math.min(index,8)*60}ms`} as CSSProperties}>
              <button className="book-read" aria-label={`${book.title} 읽기`} title={`${book.title} 읽기`} onClick={()=>openBook(book)}>
                <div className="book-stage"><div className="book-open">{view==='covers'?<Cover book={book}/>:<div className="book-spine"><span className="spine-title-zone"><strong className="spine-title">{displayBookTitle(book)}</strong></span><span className="spine-volume">{String(book.volumeNumber??1).padStart(2,'0')}</span></div>}</div></div>
                <div className="book-caption"><div><span className="book-title">{book.title}</span><p>{book.author || '나의 이야기'}</p></div></div>
                <div className="book-meta"><span>{book.messages.length.toLocaleString()}개의 대화</span><span>{mark?.bookId===book.id?'책갈피':''}</span></div>
              </button>
              {mark?.bookId===book.id&&<span className="book-bookmark" data-bookmark-style={mark.style} role="img" aria-label={`${book.title} 책갈피`}><BookmarkBadge mark={mark}/></span>}
              {canEdit&&<div className={`book-menu-wrap ${menu===book.id?'menu-open':''}`}><button className="icon-btn" title="책 관리" aria-label={`${book.title} 관리`} aria-expanded={menu===book.id} onClick={e=>{e.stopPropagation();setMenu(menu===book.id?null:book.id);}}><Ellipsis size={19}/></button>{menu===book.id&&<div className="dropdown"><button onClick={()=>setEdit(book)}>꾸미기</button><button onClick={()=>download(`${book.title}.json`,[book])}>내보내기</button><button className="danger-text" onClick={()=>setRemove(book)}>삭제</button></div>}</div>}
            </article>)}{view==='spines'&&<span className="shelf-bookstop shelf-bookstop-end" aria-hidden="true"/>}{canEdit&&<button className={`add-book-card ${view==='spines'?'add-spine-card':''}`} aria-label={`${shelf.title} 새 책 쓰기`} title="직접 쓴 이야기 추가" disabled={busy} onClick={()=>setCreating({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons})}><span className="add-book-outline"><Plus size={24} strokeWidth={1.2}/></span><span className="sr-only">새 책 쓰기</span></button>}</div>
          </section>;})}</div>:<div className="empty-state"><BookOpen size={38} strokeWidth={1}/><h3>{query?'검색 결과 없음':'책이 없어요'}</h3>{canEdit&&!query&&<button className="secondary-btn" onClick={()=>setCreating({id:'ungrouped',title:'단권',ungrouped:true})}><Plus size={17}/> 새 책 쓰기</button>}</div>}

        </section>

      </main>
    </div>
    <input className="sr-only" ref={restore} type="file" accept=".json" onChange={e=>void restoreBackup(e.target.files?.[0])}/>
    {canEdit&&(importing||creating)&&<BookIntake title={creating&&!creating.ungrouped?creating.title:''} assets={creating?shelfAssets(books,creating):[]} onConfirm={intakeBooks} onClose={()=>{setImporting(false);setCreating(null);}}/>}
    {canEdit&&info&&<Modal title="보관함" onClose={()=>setInfo(false)}><p className="modal-description">이 브라우저에 저장돼요. 데이터 삭제 전 백업하세요.</p><div className="backup-actions"><button className="secondary-btn" title="서재 전체를 파일로 저장" disabled={busy||loading} onClick={()=>{download('갈피-책장-'+new Date().toISOString().slice(0,10)+'.json',{format:'galpi-backup',version:1,volumePolicy:'chapters-100-v1',books});setToast('백업 완료');}}><ArrowDownToLine size={17}/> 백업</button><button className="secondary-btn" title="다른 브라우저의 백업도 복원할 수 있습니다" disabled={busy} onClick={()=>restore.current?.click()}><Upload size={17}/> 복원</button></div></Modal>}
    {canEdit&&renaming&&shelfBooks(books,renaming)[0]&&<EditBook scope="shelf" book={{...shelfBooks(books,renaming)[0]!,title:renaming.title}} onSave={(draft,reset)=>decorateShelf(renaming,draft,reset)} onClose={()=>setRenaming(null)}/>}
    {canEdit&&assetShelf&&<ShelfAssets assets={shelfAssets(books,assetShelf)} onSave={assets=>saveShelfAssets(assetShelf,assets)} onClose={()=>setAssetShelf(null)}/>}
    {canEdit&&edit&&<EditBook book={edit} onSave={decorateBook} onClose={()=>setEdit(null)}/>}
    {canEdit&&clearConfirm&&<Modal title="책장 삭제" locked={busy} onClose={()=>setClearConfirm(null)}>
      <div className="delete-shelf-confirm" aria-busy={deleting}>
        <span className="delete-shelf-icon" aria-hidden="true"><Trash2 size={26} strokeWidth={1.5}/></span>
        <p className="delete-shelf-count">‘{clearConfirm.title}’ 책장의<br/>총 <strong>{clearConfirm.ids.length.toLocaleString()}권</strong>을 삭제할까요?</p>
        <p className="modal-description">이 책장에 담긴 책의 대화와 책갈피가 사라져요.<br/><strong>삭제 후에는 되돌릴 수 없어요.</strong></p>
        <button className="secondary-btn clear-backup" disabled={busy} onClick={async()=>{setBusy(true);try{await backupBooks();}catch{setClearError('백업하지 못했어요. 다시 시도해 주세요.');}finally{setBusy(false);}}}><ArrowDownToLine size={16}/> 먼저 백업하기 <span>선택</span></button>
        {clearError&&<p className="error-message" role="alert">{clearError}</p>}
        <div className="modal-actions"><button className="secondary-btn" autoFocus disabled={busy} onClick={()=>setClearConfirm(null)}>취소</button><button className="danger-btn" disabled={busy} onClick={()=>void clearBooks()}>{deleting?<LoaderCircle size={16} className="animate-spin"/>:<Trash2 size={16}/>} {deleting?'삭제 중…':'책장 삭제'}</button></div>
      </div>
    </Modal>}
    {canEdit&&remove&&<Modal title="책 삭제" onClose={()=>setRemove(null)}><p className="modal-description">‘{remove.title}’을 삭제할까요?</p><div className="modal-actions"><button className="secondary-btn" title="삭제 전 이 책을 백업" onClick={()=>download(remove.title+'.json',[remove])}><ArrowDownToLine size={16}/> 내보내기</button><button className="danger-btn" title="대화와 책갈피를 삭제합니다" disabled={busy} onClick={async()=>{if(!canEdit||deletingRef.current||editingShelf.current||splittingBooks.current.size)return;deletingRef.current=true;setBusy(true);try{await deleteBook(remove.id);const next=latestBooks.current.filter(b=>b.id!==remove.id);latestBooks.current=next;setBooks(next);setRemove(null);setToast('삭제 완료');}catch{setToast('삭제 실패');}finally{deletingRef.current=false;setBusy(false);}}}>삭제</button></div></Modal>}
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}

