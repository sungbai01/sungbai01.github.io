import { lazy, Suspense, useCallback, useEffect, useRef, useState, useId, type CSSProperties, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronDown, Ellipsis, FileUp, Library, LoaderCircle, Pencil, Images, Plus, Search, Settings2, Trash2, Upload, X } from 'lucide-react';
import { loadBooks, saveBook, saveReadingProgress, replaceBookWithVolumes, repackSeries, deleteBook, deleteBooks, importChatFile, BOOK_COLORS, type Book } from './lib/library';
import { groupBooks, MAX_VOLUME_PAGES, splitBookForStorage, mergeLegacyVolumes } from './lib/volumes';
import { sampleBooks } from './lib/sample';
import ShelfAssets from './components/ShelfAssets';

type BookAsset = NonNullable<Book['assets']>[number];
type ShelfTarget = {id:string;title:string;ungrouped:boolean};
function shelfBooks(books:Book[],shelf:ShelfTarget){return books.filter(book=>shelf.ungrouped?!book.seriesId:(book.seriesId??book.id)===shelf.id).sort((a,b)=>(a.volumeNumber??1)-(b.volumeNumber??1));}
function shelfAssets(books:Book[],shelf:ShelfTarget):BookAsset[]{return [...new Map(shelfBooks(books,shelf).flatMap(book=>book.assets??[]).map(asset=>[asset.id,asset])).values()];}

function equalRows<T>(left:T[]|undefined,right:T[]|undefined,fields:readonly (keyof T)[]):boolean{
  if(left===right)return true;
  return !!left&&!!right&&left.length===right.length&&left.every((row,index)=>
    row===right[index]||fields.every(field=>row[field]===right[index]![field]));
}
function reuseBookReferences(book:Book,previous:Book|undefined):Book{
  if(!previous||book===previous)return book;
  const next={...book};
  if(equalRows(book.messages,previous.messages,['role','name','content','chapter']))next.messages=previous.messages;
  if(equalRows(book.assets,previous.assets,['id','name','src']))next.assets=previous.assets;
  if(equalRows(book.bookmarks,previous.bookmarks,['message','char','label']))next.bookmarks=previous.bookmarks;
  const fields=new Set([...Object.keys(previous),...Object.keys(next)]);
  return [...fields].every(field=>next[field as keyof Book]===previous[field as keyof Book])?previous:next;
}

const Reader = lazy(() => import('./components/Reader'));
const colors = BOOK_COLORS;
const key = 'galpi:initialized';
const volumeLayoutKey = 'galpi:volumes:100-chapters-v1';
const legacySampleColors:Record<string,string> = {'sample-forest-letter':'#596B55','sample-terracotta-evening':'#AD715B','sample-indigo-platform':'#5C6386','sample-ochre-bookshop':'#A68A4D'};
function currentBookId() { try { const match = location.hash.match(/^#\/book\/([^/]+)$/); return match ? decodeURIComponent(match[1]) : null; } catch { return null; } }
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function mergeSeriesVolumes(books:Book[], original:Book, volumes:Book[]) {
  const seriesId=original.seriesId??original.id;
  const seriesTitle=original.seriesTitle??original.title;
  const siblings=books.filter(book=>(book.seriesId??book.id)===seriesId)
    .sort((a,b)=>(a.volumeNumber??1)-(b.volumeNumber??1));
  const position=siblings.findIndex(book=>book.id===original.id);
  if(position<0)throw new Error('원본 책을 찾지 못했어요.');
  const occupied=new Set(books.map(book=>book.id));
  let suffix=2;
  const parts=volumes.map((volume,index)=>{
    if(index===0)return {...volume,id:original.id};
    let id=volume.id;
    while(occupied.has(id))id=`${original.id}--part-${suffix++}`;
    occupied.add(id);
    return {...volume,id};
  });
  const series=siblings.flatMap(book=>book.id===original.id?parts:[book])
    .map((book,index)=>({...book,seriesId,seriesTitle,title:`${seriesTitle} · ${index+1}권`,volumeNumber:index+1,volumeCount:siblings.length-1+parts.length}));
  return {series,parts,position};
}

function replaceSeries(books:Book[], original:Book, series:Book[]) {
  const belongs=(book:Book)=>(book.seriesId??book.id)===(original.seriesId??original.id);
  const first=books.findIndex(belongs);
  const next=books.filter(book=>!belongs(book));
  next.splice(first<0?next.length:first,0,...series);
  return next;
}

/** Commit each source replacement atomically; untouched books retain their objects and IDs. */
async function storeBooks(incoming:Book[], existing:Book[], persistUnchanged=false, rejoinLegacy=false) {
  const byId=new Map(incoming.map(book=>[book.id,book]));
  const existingIds=new Set(existing.map(book=>book.id));
  let result=[...existing.map(book=>byId.get(book.id)??book),...incoming.filter(book=>!existingIds.has(book.id))];
  for(const source of groupBooks(incoming).flatMap(group=>group.books)){
    const book=result.find(item=>item.id===source.id)!;
    const volumes=splitBookForStorage(book);
    if(volumes.length>1){
      const {series}=mergeSeriesVolumes(result,book,volumes);
      await replaceBookWithVolumes(book.id,series);
      result=replaceSeries(result,book,series);
    }else if(persistUnchanged)await saveBook(book);
  }
  if(rejoinLegacy){
    for(const group of groupBooks(result)){
      const siblings=group.books;const first=siblings[0]!;
      // The legacy helper has no version marker. Only migrate complete,
      // automatically generated part IDs; manually grouped books stay intact.
      const automatic=siblings.length>1&&first.seriesId===first.id&&!!first.seriesTitle&&siblings.every((book,index)=>
        (!('volumePolicy' in book)||book.volumePolicy!=='chapters-100-v1')&&byId.has(book.id)&&book.volumeNumber===index+1&&book.volumeCount===siblings.length&&
        book.title===`${first.seriesTitle} · ${index+1}권`&&
        (book.id===first.id||book.id.startsWith(first.id)&&/^(?:--part-[2-9]\d*|--part-1\d+)+$/.test(book.id.slice(first.id.length))));
      if(!automatic)continue;
      const joined=mergeLegacyVolumes(siblings);
      const obsolete=siblings.slice(1).map(book=>book.id);
      await repackSeries(first.id,joined,obsolete);
      result=replaceSeries(result,first,joined);
      if(obsolete.includes(currentBookId()??''))location.hash=`/book/${encodeURIComponent(first.id)}`;
    }
  }
  return result;
}

function Modal({title, children, onClose, wide=false, locked=false}: {title:string; children:ReactNode; onClose:()=>void; wide?:boolean; locked?:boolean}) {
  const ref = useRef<HTMLDialogElement>(null);const titleId=useId();
  useEffect(()=>{const dialog=ref.current!; dialog.showModal(); return ()=>dialog.close();},[]);
  return <dialog className={`modal ${wide?'modal-wide':''}`} ref={ref} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!locked)onClose();}} onClick={e=>{if(!locked&&e.target===e.currentTarget)onClose();}}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-btn" title="닫기" aria-label="닫기" disabled={locked} onClick={onClose}><X size={20}/></button></div>{children}
  </dialog>;
}

function Cover({book, small=false}: {book:Book;small?:boolean}) {
  return <div className={`book-cover ${small?'cover-small':''}`} style={{'--cover':book.color || colors[0]} as CSSProperties}>
    {book.cover && <img className="cover-image" src={book.cover} alt=""/>}
    <div className="cover-content"><div className="cover-rule"/><h3>{book.title}</h3><span className="cover-ornament" aria-hidden="true">✳</span><p>{book.author || '이름 없는 이야기'}</p></div>
  </div>;
}

function EditBook({book,onSave,onClose}: {book:Book;onSave:(book:Book)=>Promise<void>;onClose:()=>void}) {
  const [draft,setDraft]=useState(book); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function cover(file:File|undefined,side:'cover'|'backCover'='cover') {
    if(!file)return;
    if(!/^image\/(jpeg|png|webp|gif)$/.test(file.type)||file.size>5*1024*1024){setError('표지는 5MB 이하의 JPG, PNG, WebP, GIF를 골라 주세요.');return;}
    const reader=new FileReader(); reader.onload=()=>setDraft(v=>({...v,[side]:String(reader.result)})); reader.onerror=()=>setError('표지를 읽지 못했어요.');reader.readAsDataURL(file);
  }
  return <Modal title="책 꾸미기" onClose={onClose} wide locked={busy}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSave({...draft,title:draft.title.trim(),updatedAt:new Date().toISOString()});onClose();}catch{setError('저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');}finally{setBusy(false);}}}>
    <div className="edit-layout"><div className="cover-previews"><Cover book={draft}/>{draft.backCover&&<div className="back-cover-preview"><img src={draft.backCover} alt="뒷표지 미리보기"/></div>}</div><div className="space-y-4"><label className="field">책 제목<input required maxLength={100} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label className="field">등장인물 · 작가<input maxLength={100} value={draft.author} onChange={e=>setDraft({...draft,author:e.target.value})}/></label><label className="field">책 소개<textarea rows={3} maxLength={600} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label><div className="field">표지 색<div className="flex gap-2 mt-2">{colors.map(color=><button key={color} type="button" className="swatch" aria-label={`${color} 표지`} aria-pressed={draft.color===color} style={{background:color}} onClick={()=>setDraft({...draft,color})}>{draft.color===color&&<Check size={15}/>}</button>)}</div></div><label className="secondary-btn cursor-pointer"><Upload size={15}/> 앞표지 이미지<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>void cover(e.target.files?.[0])}/></label>{draft.cover&&<button type="button" className="text-button" onClick={()=>setDraft({...draft,cover:undefined})}>앞표지 지우기</button>}<label className="secondary-btn cursor-pointer"><Upload size={15}/> 뒷표지 이미지<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>void cover(e.target.files?.[0],'backCover')}/></label>{draft.backCover&&<button type="button" className="text-button" onClick={()=>setDraft({...draft,backCover:undefined})}>뒷표지 지우기</button>}</div></div>
    {error&&<p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>취소</button><button disabled={busy||!draft.title.trim()} className="primary-btn">{busy?<LoaderCircle className="animate-spin" size={16}/>:<Check size={16}/>} 저장하기</button></div>
  </form></Modal>;
}

function WriteBook({shelf,assets,onSave,onClose}:{shelf:ShelfTarget;assets:BookAsset[];onSave:(draft:{title:string;name:string;text:string})=>Promise<void>;onClose:()=>void}){
  const [title,setTitle]=useState(shelf.ungrouped?'':shelf.title);const [name,setName]=useState('');const [text,setText]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const textInput=useRef<HTMLTextAreaElement>(null);
  function insertAsset(id:string){
    const asset=assets.find(item=>item.id===id);if(!asset)return;
    const start=textInput.current?.selectionStart??text.length;const end=textInput.current?.selectionEnd??start;
    const before=text.slice(0,start);const after=text.slice(end);const token=`${before&&!before.endsWith('\n')?'\n\n':''}{{img::${asset.name}}}${after&&!after.startsWith('\n')?'\n\n':''}`;
    setText(before+token+after);
    requestAnimationFrame(()=>{textInput.current?.focus();textInput.current?.setSelectionRange(start+token.length,start+token.length);});
  }
  return <Modal title="새 책 쓰기" onClose={onClose} wide locked={busy}><form className="write-book-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSave({title:title.trim(),name:name.trim(),text});onClose();}catch(e){setError(e instanceof Error?e.message:'책을 저장하지 못했어요.');}finally{setBusy(false);}}}>
    <label className="field">책 제목<input required maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    {!shelf.ungrouped&&<p className="form-hint">‘{shelf.title}’의 다음 권으로 추가돼요. 책장 제목과 권 번호는 유지하고, 입력한 제목은 본문의 제목으로 담아요.</p>}
    <label className="field">이름<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
    {assets.length>0&&<label className="field write-asset-picker">삽화<select value="" disabled={busy} aria-label="책장 삽화 삽입" title="선택한 에셋을 본문에 삽입" onChange={e=>insertAsset(e.target.value)}><option value="" disabled>에셋 선택</option>{assets.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}
    <label className="field">본문<textarea ref={textInput} required rows={12} value={text} placeholder="이야기를 써 주세요. 삽화: {{img::에셋 이름}}" title="{{img::에셋 이름}}으로 책장 삽화 삽입" onChange={e=>setText(e.target.value)}/></label>
    {error&&<p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>취소</button><button className="primary-btn" disabled={busy||!title.trim()||!name.trim()||!text.trim()}>{busy?<LoaderCircle size={16} className="animate-spin"/>:<Plus size={16}/>} 책 추가</button></div>
  </form></Modal>;
}
function RenameShelf({shelf,onSave,onClose}:{shelf:ShelfTarget;onSave:(title:string)=>Promise<void>;onClose:()=>void}){
  const [title,setTitle]=useState(shelf.ungrouped?'':shelf.title);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Modal title="책장 이름 변경" onClose={onClose} locked={busy}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSave(title.trim());onClose();}catch(e){setError(e instanceof Error?e.message:'책장 이름을 저장하지 못했어요.');}finally{setBusy(false);}}}><label className="field">책장 이름<input autoFocus required maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label><p className="form-hint">{shelf.ungrouped?'모든 단권을 이 이름의 새 책장으로 모으고, 책 제목에 권 번호를 붙여요.':'이 책장의 모든 책 제목을 새 이름과 권 번호로 함께 바꿔요.'}</p>{error&&<p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>취소</button><button className="primary-btn" disabled={busy||!title.trim()}>{busy?<LoaderCircle size={16} className="animate-spin"/>:<Check size={16}/>} 저장</button></div></form></Modal>;
}

export default function App() {
  const [books,setBooks]=useState<Book[]>([]); const [loading,setLoading]=useState(true);const [error,setError]=useState(''); const [toast,setToast]=useState('');
  const [route,setRoute]=useState(currentBookId); const [query,setQuery]=useState(''); const [tab,setTab]=useState('all');const [sort,setSort]=useState('recent');
  const [importing,setImporting]=useState(false);const [busy,setBusy]=useState(false);const [dragging,setDragging]=useState(false);const [info,setInfo]=useState(false);const [edit,setEdit]=useState<Book|null>(null);const [remove,setRemove]=useState<Book|null>(null);const [menu,setMenu]=useState<string|null>(null);const [view,setView]=useState<'covers'|'spines'>('covers');
  const [clearConfirm,setClearConfirm]=useState<{title:string;ids:string[]}|null>(null);const [deleting,setDeleting]=useState(false);const [clearError,setClearError]=useState('');
  const [removeUserInputs,setRemoveUserInputs]=useState(true);
  const [creating,setCreating]=useState<ShelfTarget|null>(null);const [renaming,setRenaming]=useState<ShelfTarget|null>(null);const [assetShelf,setAssetShelf]=useState<ShelfTarget|null>(null);
  const deletingRef=useRef(false);const editingShelf=useRef(false);
  const input=useRef<HTMLInputElement>(null);const restore=useRef<HTMLInputElement>(null);const latestBooks=useRef(books); latestBooks.current=books;
  const pendingProgress=useRef(new Map<string,{id:string;page:number;updatedAt:string}>());
  const progressTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const progressWrites=useRef<Promise<void>>(Promise.resolve());
  const splittingBooks=useRef(new Set<string>());
  const initialLoad=useRef<Promise<Book[]>|null>(null);
  const flushProgress=useCallback(()=>{
    if(progressTimer.current!==null){clearTimeout(progressTimer.current);progressTimer.current=null;}
    const updates=[...pendingProgress.current.values()];pendingProgress.current.clear();
    if(!updates.length)return;
    progressWrites.current=progressWrites.current.then(async()=>{
      for(const entry of updates){
        try{await saveReadingProgress(entry.id,entry.page,entry.updatedAt);
          setBooks(prev=>{const next=prev.map(book=>{if(book.id!==entry.id)return book;const newer=pendingProgress.current.get(book.id);return {...book,lastPage:newer?.page??entry.page,updatedAt:newer?.updatedAt??entry.updatedAt};});latestBooks.current=next;return next;});
        }catch{setToast('읽던 위치 저장 실패');}
      }
    });
  },[]);
  useEffect(()=>{
    const hide=()=>{if(document.visibilityState==='hidden')flushProgress();};
    addEventListener('hashchange',flushProgress);addEventListener('pagehide',flushProgress);document.addEventListener('visibilitychange',hide);
    return()=>{flushProgress();removeEventListener('hashchange',flushProgress);removeEventListener('pagehide',flushProgress);document.removeEventListener('visibilitychange',hide);};
  },[flushProgress]);
  useEffect(()=>{
    let active=true;
    initialLoad.current??=(async()=>{
      let data=await loadBooks();
      for(let i=0;i<data.length;i++){
        const previous=data[i];const sample=sampleBooks.find(book=>book.id===previous.id);
        if(sample&&previous.color===legacySampleColors[previous.id]){data[i]={...previous,color:sample.color};await saveBook(data[i]);}
      }
      if(!localStorage.getItem(key)&&!data.length){for(const book of sampleBooks)await saveBook(book);data=sampleBooks;}
      data=await storeBooks(data,data,false,localStorage.getItem(volumeLayoutKey)!=='yes');
      localStorage.setItem(volumeLayoutKey,'yes');
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
  const openBook=useCallback((book:Book)=>{location.hash=`/book/${encodeURIComponent(book.id)}`;},[]);
  const closeBook=useCallback(()=>{location.hash='/';},[]);
  async function commitBooks(ids:string[],make:(current:Book[])=>Book[]){
    if(deletingRef.current||editingShelf.current||splittingBooks.current.size>0)throw new Error('책을 저장 중이에요. 잠시 후 다시 시도해 주세요.');
    editingShelf.current=true;for(const id of ids)splittingBooks.current.add(id);setBusy(true);
    try{
      flushProgress();await progressWrites.current;
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
    const baseline=books.find(item=>item.id===book.id);
    if(!baseline)throw new Error('책을 찾지 못했어요.');
    // Reader saves content and position bookmarks; shelf metadata comes from storage.
    const patch:Partial<Book>={};
    if(book.messages!==baseline.messages)patch.messages=book.messages;
    if(book.bookmarks!==baseline.bookmarks)patch.bookmarks=book.bookmarks;
    if(book.updatedAt!==baseline.updatedAt)patch.updatedAt=book.updatedAt;
    const contentChanged=!equalRows(book.messages,baseline.messages,['role','name','content','chapter']);
    await commitBooks([book.id],current=>{
      const stored=current.find(item=>item.id===book.id);if(!stored)throw new Error('책을 찾지 못했어요.');
      return [{...stored,...patch,lastPage:book.lastPage??(contentChanged?0:stored.lastPage)}];
    });
  };
  const decorateBook=async(draft:Book)=>{
    await commitBooks([draft.id],current=>{
      const stored=current.find(book=>book.id===draft.id);if(!stored)throw new Error('책을 찾지 못했어요.');
      return [{...stored,title:draft.title,author:draft.author,description:draft.description,color:draft.color,cover:draft.cover,backCover:draft.backCover}];
    });
  };
  async function renameShelf(shelf:ShelfTarget,title:string){
    const ids=shelfBooks(latestBooks.current,shelf).map(book=>book.id);const seriesId=shelf.ungrouped?crypto.randomUUID():shelf.id;
    await commitBooks(ids,current=>{const siblings=shelfBooks(current,shelf);return siblings.map((book,index)=>({...book,seriesId,seriesTitle:title,title:`${title} · ${index+1}권`,volumeNumber:index+1,volumeCount:siblings.length}));});
    setToast('책장 이름을 바꿨어요.');
  }
  async function createBook(shelf:ShelfTarget,draft:{title:string;name:string;text:string}){
    const id=crypto.randomUUID();const now=new Date().toISOString();
    await commitBooks(shelfBooks(latestBooks.current,shelf).map(book=>book.id),current=>{
      const siblings=shelfBooks(current,shelf);if(!shelf.ungrouped&&!siblings.length)throw new Error('책장을 찾지 못했어요.');
      const book:Book={id,title:draft.title,author:draft.name,description:draft.text.slice(0,160),color:siblings[0]?.color??colors[0]!,createdAt:now,updatedAt:now,lastPage:0,messages:[{role:'assistant',name:draft.name,content:draft.text,...(!shelf.ungrouped?{chapter:draft.title}:{})}],...(siblings.length?{assets:shelfAssets(current,shelf)}:{})};
      if(shelf.ungrouped)return [book];
      return [...siblings,book].map((item,index)=>({...item,seriesId:shelf.id,seriesTitle:siblings[0]!.seriesTitle??shelf.title,title:`${siblings[0]!.seriesTitle??shelf.title} · ${index+1}권`,volumeNumber:index+1,volumeCount:siblings.length+1}));
    });
    setToast('새 책을 꽂았어요.');
  }
  async function saveShelfAssets(shelf:ShelfTarget,assets:BookAsset[]){
    await commitBooks(shelfBooks(latestBooks.current,shelf).map(book=>book.id),current=>shelfBooks(current,shelf).map(book=>({...book,assets})));
    setToast('에셋을 저장했어요.');
  }
  async function backupBooks(){
    if(!clearConfirm)return;
    flushProgress();await progressWrites.current;
    const targetIds=new Set(clearConfirm.ids);
    const persisted=(await loadBooks()).filter(book=>targetIds.has(book.id));
    download(clearConfirm.title+'-'+new Date().toISOString().slice(0,10)+'.json',{format:'galpi-backup',version:1,volumePolicy:'chapters-100-v1',books:persisted});
    setToast('백업 완료');
  }
  async function clearBooks(){
    if(!clearConfirm||deletingRef.current||busy||loading)return;
    if(splittingBooks.current.size){setClearError('책을 저장 중이에요. 잠시 후 다시 시도해 주세요.');return;}
    deletingRef.current=true;setDeleting(true);setBusy(true);setClearError('');
    try{
      // Drain queued writes before the atomic books/progress transaction.
      flushProgress();await progressWrites.current;
      const targetIds=new Set(clearConfirm.ids);
      await deleteBooks([...targetIds]);
      for(const id of targetIds)pendingProgress.current.delete(id);
      const remaining=latestBooks.current.filter(book=>!targetIds.has(book.id));
      latestBooks.current=remaining;setBooks(remaining);
      if(targetIds.has(currentBookId()??'')){setRoute(null);location.hash='/';}
      setMenu(null);if(edit&&targetIds.has(edit.id))setEdit(null);if(remove&&targetIds.has(remove.id))setRemove(null);setClearConfirm(null);
      setToast('책장을 삭제했어요.');
    }catch{setClearError('삭제하지 못했어요. 다시 시도해 주세요.');}
    finally{deletingRef.current=false;setDeleting(false);setBusy(false);}
  }
  const onProgress=useCallback((page:number)=>{
    const id=currentBookId();const book=latestBooks.current.find(b=>b.id===id);
    if(deletingRef.current||!book||splittingBooks.current.has(book.id)||(pendingProgress.current.get(book.id)?.page??book.lastPage)===page)return;
    pendingProgress.current.set(book.id,{id:book.id,page,updatedAt:new Date().toISOString()});
    if(progressTimer.current!==null)clearTimeout(progressTimer.current);
    progressTimer.current=setTimeout(flushProgress,1100);
  },[flushProgress]);
  const onSplit=useCallback(async(original:Book,volumes:Book[])=>{
    if(deletingRef.current||editingShelf.current||volumes.length<2||splittingBooks.current.has(original.id))return;
    const seriesId=original.seriesId??original.id;
    const belongs=(book:Book)=>(book.seriesId??book.id)===seriesId;
    const siblings=latestBooks.current.filter(belongs);
    if(!siblings.some(book=>book.id===original.id)||siblings.some(book=>splittingBooks.current.has(book.id)))return;
    const savedProgress=new Map(pendingProgress.current);
    for(const sibling of siblings){splittingBooks.current.add(sibling.id);pendingProgress.current.delete(sibling.id);}
    try{
      await progressWrites.current;
      const current=latestBooks.current.map(book=>{
        const progress=belongs(book)?savedProgress.get(book.id):undefined;
        return progress?{...book,lastPage:progress.page,updatedAt:progress.updatedAt}:book;
      });
      const {series:merged,parts,position}=mergeSeriesVolumes(current,original,volumes);
      await replaceBookWithVolumes(original.id,merged);
      setBooks(prev=>{
        const next=replaceSeries(prev,original,merged);
        latestBooks.current=next;
        return next;
      });
      const page=savedProgress.get(original.id)?.page??original.lastPage??0;
      const target=merged[position+Math.max(0,Math.min(parts.length-1,Math.floor(page/MAX_VOLUME_PAGES)))]!;
      if(currentBookId()===original.id){openBook(target);setRoute(target.id);}
    }catch(error){
      for(const sibling of siblings){const progress=savedProgress.get(sibling.id);if(progress)pendingProgress.current.set(sibling.id,progress);}
      throw error;
    }finally{
      for(const sibling of siblings)splittingBooks.current.delete(sibling.id);
    }
  },[openBook]);
  async function importFiles(files:FileList|File[]) {
    if(!files.length||busy)return;setBusy(true);setError('');let added=0;const errors:string[]=[];
    for(const file of Array.from(files)){try{const imported=await importChatFile(file,{removeUserInputs});flushProgress();await progressWrites.current;const next=await storeBooks(imported,await loadBooks(),true);latestBooks.current=next;setBooks(next);added+=imported.length;}catch(e){errors.push(`${file.name}: ${e instanceof Error?e.message:'파일을 읽지 못했어요.'}`);}}
    setBusy(false);if(errors.length)setError(errors.join('\n'));if(added){setToast(`${added}권의 이야기를 책장에 꽂았어요.`);setTab('all');if(!errors.length)setImporting(false);}
  }
  async function restoreBackup(file?:File){if(!file||busy)return;setBusy(true);setError('');try{const data=JSON.parse(await file.text());if(data.format!=='galpi-backup'||!Array.isArray(data.books))throw new Error('갈피에서 내보낸 책장 백업 파일을 선택해 주세요.');const normalized=await importChatFile(new File([JSON.stringify(data.books)],'backup.json',{type:'application/json'}),{removeUserInputs:false});flushProgress();await progressWrites.current;const merged=await storeBooks(normalized,await loadBooks(),true,data.volumePolicy!=='chapters-100-v1');latestBooks.current=merged;setBooks(merged);setToast(`${normalized.length}권을 복원했어요.`);}catch(e){setError(e instanceof Error?e.message:'백업을 복원하지 못했어요.');}finally{setBusy(false);if(restore.current)restore.current.value='';}}
  const selected=books.find(b=>b.id===route);
  const reading=books.filter(b=>(b.lastPage??0)>0).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  const shown=books.filter(b=>(tab!=='reading'||(b.lastPage??0)>0)&&`${b.title} ${b.author} ${b.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,'ko'):sort==='oldest'?String(a.createdAt).localeCompare(String(b.createdAt)):String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const groups=groupBooks(shown);
  const singletons:{id:string;title:string;books:Book[]}={id:'ungrouped',title:'단권',books:[]};
  const shelves=groups.reduce<{id:string;title:string;books:Book[]}[]>((rows,group)=>{
    if(group.books.some(book=>book.seriesId)){rows.push(group);return rows;}
    if(!rows.includes(singletons))rows.push(singletons);
    singletons.books.push(...group.books);
    return rows;
  },[]);
  const nextVolume=selected?.seriesId?groupBooks(books).find(group=>group.id===selected.seriesId)?.books.find(book=>(book.volumeNumber??1)>(selected.volumeNumber??1)):undefined;
  const nextVolumeId=nextVolume?.id;
  const onNextVolume=useCallback(()=>{if(nextVolumeId)location.hash=`/book/${encodeURIComponent(nextVolumeId)}`;},[nextVolumeId]);
  if(route&&!loading&&selected)return <><Suspense fallback={<div className="loading-screen"><LoaderCircle className="animate-spin"/> 책을 펼치고 있어요</div>}><Reader book={selected} onClose={closeBook} onProgress={onProgress} onSaveBook={updateBook} onSplit={onSplit} onNextVolume={nextVolume?onNextVolume:undefined} nextVolumeTitle={nextVolume?.title}/></Suspense>{toast&&<div className="toast" role="status">{toast}</div>}</>;
  return <div className="app-shell">
    <header className="site-header" inert={deleting}><a href="#/" className="brand" aria-label="갈피 서재"><span className="brand-mark"><BookOpen size={23} strokeWidth={1.4}/><span/></span><span>갈피<span className="brand-en">galpi</span></span></a><div className="header-right"><button className="icon-btn" aria-label="저장 및 백업" title="저장 및 백업" onClick={()=>setInfo(true)}><Settings2 size={19}/></button></div></header>
    <div className="workspace" inert={deleting}>
      <aside className="sidebar"><nav aria-label="서재 메뉴">{[{id:'all',label:'모든 책',icon:Library,count:groupBooks(books).length},{id:'reading',label:'읽던 책',icon:BookOpen,count:books.filter(b=>(b.lastPage??0)>0).length}].map(item=><button key={item.id} title={item.label} className={'nav-item '+(tab===item.id?'active':'')} onClick={()=>{setTab(item.id);setQuery('');}}><item.icon size={18} strokeWidth={1.6}/><span>{item.label}</span><small>{item.count.toString().padStart(2,'0')}</small></button>)}</nav>
      </aside>
      <main className="main-content">
        <section className="library-intro"><h1>서재</h1><button className="primary-btn icon-action" title="RisuAI 로그 가져오기" aria-label="RisuAI 로그 가져오기" onClick={()=>{setError('');setImporting(true);}}><Plus size={21}/></button></section>
        {error&&!importing&&<div className="error-banner" role="alert">{error}<button className="icon-btn" aria-label="오류 닫기" onClick={()=>setError('')}><X size={16}/></button></div>}
        {route&&!selected&&!loading&&<div className="error-banner">이 브라우저에 저장되지 않은 책이에요.<a href="#/">서재로 돌아가기</a></div>}
        {reading&&<button className="resume-card" aria-label={reading.title+' 이어 읽기'} title="이어 읽기" onClick={()=>openBook(reading)}><span className="resume-cover"><Cover book={reading} small/></span><span className="resume-copy"><strong>{reading.title}</strong><span>{reading.author} · {(reading.lastPage??0)+1}쪽</span></span><ArrowRight size={21} aria-hidden="true"/></button>}
        <section aria-label="책장" className="collection"><div className="collection-toolbar"><div className="collection-heading"><h2>{tab==='reading'?'읽던 책':'모든 책'}</h2><span>{groups.length}작품 · {shown.length}권</span></div><div className="collection-controls"><label className="search-box"><Search size={16}/><input aria-label="이야기 검색" placeholder="검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="검색 초기화" onClick={()=>setQuery('')}><X size={14}/></button>}</label><label className="sort-select"><select aria-label="책 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">최근 펼친 순</option><option value="oldest">오래된 순</option><option value="title">제목순</option></select><ChevronDown size={13}/></label><div className="view-switch" aria-label="책장 보기"><button className={view==='covers'?'active':''} title="표지 보기" aria-label="표지 보기" aria-pressed={view==='covers'} onClick={()=>setView('covers')}><BookOpen size={16}/></button><button className={view==='spines'?'active':''} title="책등 보기" aria-label="책등 보기" aria-pressed={view==='spines'} onClick={()=>setView('spines')}><Library size={16}/></button></div></div></div>
          {loading?<div className="loading-screen"><LoaderCircle size={22} className="animate-spin"/> 서재를 열고 있어요</div>:shown.length?<div className="shelf-groups">{shelves.map(shelf=><section key={shelf===singletons?'singletons':`series:${shelf.id}`} aria-label={shelf.title} className="series-shelf" data-series-id={shelf.id}>
            <header className="series-heading"><h3>{shelf.title}</h3><span>{shelf.books.length}권</span><div className="shelf-actions"><button className="icon-btn" aria-label={`${shelf.title} 책장 이름 변경`} title="책장 이름 변경" disabled={busy} onClick={()=>setRenaming({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons})}><Pencil size={16}/></button><button className="icon-btn" aria-label={`${shelf.title} 에셋 관리`} title="책장 에셋 관리" disabled={busy} onClick={()=>setAssetShelf({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons})}><Images size={17}/></button><button className="icon-btn shelf-delete danger-text" aria-label={`${shelf.title} 책장 삭제`} title={`${shelf.title} 책장 삭제`} disabled={busy||loading||splittingBooks.current.size>0} onClick={()=>{const targets=books.filter(book=>shelf===singletons?!book.seriesId:(book.seriesId??book.id)===shelf.id);setClearError('');setClearConfirm({title:shelf.title,ids:targets.map(book=>book.id)});}}><Trash2 size={17}/></button></div></header>
            <div className={view==='covers'?'bookshelf-grid':'spines-shelf'}>{shelf.books.map((book,index)=><article key={book.id} className={`book-item ${view==='spines'?'spine-item':''}`} style={{'--cover':book.color,'--delay':`${Math.min(index,8)*60}ms`} as CSSProperties}>
              <button className="book-read" aria-label={`${book.title} 읽기`} title={`${book.title} 읽기`} onClick={()=>openBook(book)}>
                <div className="book-stage"><div className="book-open">{view==='covers'?<Cover book={book}/>:<div className="book-spine"><span className="spine-band" aria-hidden="true"/><strong>{book.title}</strong><span>{book.author}</span><i aria-hidden="true">✳</i><span className="spine-band" aria-hidden="true"/></div>}</div></div>
                <div className="book-caption"><div><span className="book-title">{book.title}</span><p>{book.author || '나의 이야기'}</p></div></div>
                <div className="book-meta"><span>{book.messages.length.toLocaleString()}개의 대화</span><span>{(book.lastPage??0)>0?'읽는 중':'펼치기 전'}</span></div>
              </button>
              <button className="icon-btn book-decorate" aria-label={`${book.title} 꾸미기`} title="책 꾸미기" disabled={busy} onClick={()=>setEdit(book)}><Pencil size={15}/></button>
              <div className="book-menu-wrap"><button className="icon-btn" title="책 관리" aria-label={`${book.title} 관리`} aria-expanded={menu===book.id} onClick={e=>{e.stopPropagation();setMenu(menu===book.id?null:book.id);}}><Ellipsis size={19}/></button>{menu===book.id&&<div className="dropdown"><button onClick={()=>download(`${book.title}.json`,[book])}>내보내기</button><button className="danger-text" onClick={()=>setRemove(book)}>삭제</button></div>}</div>
            </article>)}<button className={`add-book-card ${view==='spines'?'add-spine-card':''}`} aria-label={`${shelf.title} 새 책 쓰기`} title="직접 쓴 이야기 추가" disabled={busy} onClick={()=>setCreating({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons})}><span className="add-book-outline"><Plus size={24} strokeWidth={1.2}/></span><span className="sr-only">새 책 쓰기</span></button></div>
          </section>)}</div>:<div className="empty-state"><BookOpen size={38} strokeWidth={1}/><h3>{query?'검색 결과 없음':'책이 없어요'}</h3>{!query&&<button className="secondary-btn" onClick={()=>setCreating({id:'ungrouped',title:'단권',ungrouped:true})}><Plus size={17}/> 새 책 쓰기</button>}</div>}

        </section>

      </main>
    </div>
    <input className="sr-only" ref={input} type="file" multiple accept=".json,.jsonl,.ndjson,.txt,.html,.htm,.md,.markdown,.chat" onChange={e=>{if(e.target.files)void importFiles(e.target.files);e.target.value='';}}/>
    <input className="sr-only" ref={restore} type="file" accept=".json" onChange={e=>void restoreBackup(e.target.files?.[0])}/>
    {importing&&<Modal title="로그 가져오기" onClose={()=>{if(!busy)setImporting(false);}}><button disabled={busy} title="RisuAI에서 내보낸 로그를 선택하거나 놓으세요. 여러 파일을 함께 가져올 수 있습니다." className={'import-dropzone '+(dragging?'dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);void importFiles(e.dataTransfer.files);}} onClick={()=>input.current?.click()}>{busy?<LoaderCircle className="animate-spin" size={33}/>:<FileUp size={33} strokeWidth={1.3}/>}<strong>{busy?'가져오는 중…':'파일 선택'}</strong><span>JSON · TXT · HTML · HTML embedded</span></button><div className="import-option" title="사용자 메시지를 제외하고 캐릭터 메시지만 저장합니다."><span id="remove-inputs-label">인풋 제거</span><button type="button" className="import-switch" role="switch" aria-labelledby="remove-inputs-label" aria-describedby="remove-inputs-help" aria-checked={removeUserInputs} disabled={busy} onClick={()=>setRemoveUserInputs(value=>!value)}><span/></button><span id="remove-inputs-help" className="sr-only">사용자 메시지를 제외하고 캐릭터 메시지만 저장합니다.</span></div>{error&&<p className="error-message whitespace-pre-line" role="alert">{error}</p>}</Modal>}
    {info&&<Modal title="보관함" onClose={()=>setInfo(false)}><p className="modal-description">이 브라우저에 저장돼요. 데이터 삭제 전 백업하세요.</p><div className="backup-actions"><button className="secondary-btn" title="서재 전체를 파일로 저장" disabled={busy||loading} onClick={()=>{download('갈피-책장-'+new Date().toISOString().slice(0,10)+'.json',{format:'galpi-backup',version:1,volumePolicy:'chapters-100-v1',books});setToast('백업 완료');}}><ArrowDownToLine size={17}/> 백업</button><button className="secondary-btn" title="다른 브라우저의 백업도 복원할 수 있습니다" disabled={busy} onClick={()=>restore.current?.click()}><Upload size={17}/> 복원</button></div></Modal>}
    {creating&&<WriteBook shelf={creating} assets={shelfAssets(books,creating)} onSave={draft=>createBook(creating,draft)} onClose={()=>setCreating(null)}/>}
    {renaming&&<RenameShelf shelf={renaming} onSave={title=>renameShelf(renaming,title)} onClose={()=>setRenaming(null)}/>}
    {assetShelf&&<ShelfAssets assets={shelfAssets(books,assetShelf)} onSave={assets=>saveShelfAssets(assetShelf,assets)} onClose={()=>setAssetShelf(null)}/>}
    {edit&&<EditBook book={edit} onSave={decorateBook} onClose={()=>setEdit(null)}/>}
    {clearConfirm&&<Modal title="책장 삭제" locked={busy} onClose={()=>setClearConfirm(null)}>
      <div className="delete-shelf-confirm" aria-busy={deleting}>
        <span className="delete-shelf-icon" aria-hidden="true"><Trash2 size={26} strokeWidth={1.5}/></span>
        <p className="delete-shelf-count">‘{clearConfirm.title}’ 책장의<br/>총 <strong>{clearConfirm.ids.length.toLocaleString()}권</strong>을 삭제할까요?</p>
        <p className="modal-description">이 책장에 담긴 책의 대화와 읽던 위치가 사라져요.<br/><strong>삭제 후에는 되돌릴 수 없어요.</strong></p>
        <button className="secondary-btn clear-backup" disabled={busy} onClick={async()=>{setBusy(true);try{await backupBooks();}catch{setClearError('백업하지 못했어요. 다시 시도해 주세요.');}finally{setBusy(false);}}}><ArrowDownToLine size={16}/> 먼저 백업하기 <span>선택</span></button>
        {clearError&&<p className="error-message" role="alert">{clearError}</p>}
        <div className="modal-actions"><button className="secondary-btn" autoFocus disabled={busy} onClick={()=>setClearConfirm(null)}>취소</button><button className="danger-btn" disabled={busy} onClick={()=>void clearBooks()}>{deleting?<LoaderCircle size={16} className="animate-spin"/>:<Trash2 size={16}/>} {deleting?'삭제 중…':'책장 삭제'}</button></div>
      </div>
    </Modal>}
    {remove&&<Modal title="책 삭제" onClose={()=>setRemove(null)}><p className="modal-description">‘{remove.title}’을 삭제할까요?</p><div className="modal-actions"><button className="secondary-btn" title="삭제 전 이 책을 백업" onClick={()=>download(remove.title+'.json',[remove])}><ArrowDownToLine size={16}/> 내보내기</button><button className="danger-btn" title="대화와 읽던 위치를 삭제합니다" disabled={busy} onClick={async()=>{if(deletingRef.current||editingShelf.current||splittingBooks.current.size)return;deletingRef.current=true;setBusy(true);try{flushProgress();await progressWrites.current;await deleteBook(remove.id);pendingProgress.current.delete(remove.id);const next=latestBooks.current.filter(b=>b.id!==remove.id);latestBooks.current=next;setBooks(next);setRemove(null);setToast('삭제 완료');}catch{setToast('삭제 실패');}finally{deletingRef.current=false;setBusy(false);}}}>삭제</button></div></Modal>}
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}

