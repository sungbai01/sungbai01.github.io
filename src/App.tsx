import { lazy, Suspense, useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState, useId, type CSSProperties, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Bookmark, Check, ChevronDown, Ellipsis, Library, LoaderCircle, Menu, Pencil, Images, Link, Plus, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { getLibraryGeneration, importChatFile, BOOK_COLORS, type Book } from './lib/library';
import { CloudLibrary, stopCloudLibrary, type AccountStore, type CloudStatus } from './lib/cloudLibrary';
import { clearAuthSession, getAuthSession, restoreAuthSession, subscribeAuthSession } from './lib/auth';
import { groupBooks } from './lib/volumes';
import { prepareBooks,measureBookPageCount } from './lib/prepareBooks';
import {PAGE_LAYOUT_VERSION} from './lib/pagination';
import AssetManager from './components/AssetManager';
import Cover from './components/BookCover';
import BookIntake,{type IntakeRequest} from './components/BookIntake';
import ThemePicker from './components/ThemePicker';
import AuthorPicker from './components/AuthorPicker';
import BookRibbon from './components/BookRibbon';
import SpineTitle from './components/SpineTitle';
import ShelfBox from './components/ShelfBox';
import HoldDelete from './components/HoldDelete';
import useShelfDrag from './components/useShelfDrag';
import './components/shelf-interactions.css';
import GoogleAccount from './components/GoogleAccount';
import BookOpening from './components/BookOpening';
import {LibraryLoading} from './components/LoadingSkeleton';
import ShareDialog from './components/ShareDialog';
import ShareManager from './components/ShareManager';
import './components/library-drawer.css';
import {readTheme,saveTheme,THEME_EVENT,type Theme} from './lib/appearance';
import { importAssetFile, normalizeAssets, portraitPalette } from './lib/assets';
import {normalizeImageRules,type ImageRule} from './lib/imageRules';
import {applyBookDisplayRules,type DisplayRule} from './lib/displayRules';

type BookAsset = NonNullable<Book['assets']>[number];
type BookmarkAnchor={message:number;char:number;label?:string;progress?:number};
type ShelfBookmark=BookmarkAnchor&{bookId:string;title:string;style?:Book['bookmarkStyle'];icon?:string;image?:string};
function bookShelf(book:Book):ShelfTarget{return {id:book.seriesId??'ungrouped',title:book.seriesTitle??'단권',ungrouped:!book.seriesId};}
function displayBookTitle(book:Book){return book.title.replace(/\s*·\s*\d+권\s*$/, '').trim()||book.title;}
function portrait(book:Book){return book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;}
function bookmarkImage(book:Book){return book.assets?.find(asset=>asset.id===book.bookmarkAssetId)?.src??portrait(book);}
function canonicalBookmark(books:Book[]):ShelfBookmark|undefined{
  let selected:Book|undefined;
  for(const book of books)if(book.bookmarks?.length&&(!selected||book.updatedAt>selected.updatedAt||(book.updatedAt===selected.updatedAt&&book.id>selected.id)))selected=book;
  const anchor=selected?.bookmarks?.at(-1);
  return selected&&anchor?{...anchor,bookId:selected.id,title:selected.title,style:selected.bookmarkStyle??'normal',icon:portrait(selected),image:bookmarkImage(selected)}:undefined;
}
type ShelfTarget = {id:string;title:string;ungrouped:boolean};
function shelfBooks(books:Book[],shelf:ShelfTarget){return books.filter(book=>shelf.ungrouped?!book.seriesId:(book.seriesId??book.id)===shelf.id).sort((a,b)=>(a.volumeNumber??1)-(b.volumeNumber??1));}
function shelfAssets(books:Book[],shelf:ShelfTarget):BookAsset[]{return [...new Map(shelfBooks(books,shelf).flatMap(book=>book.assets??[]).map(asset=>[asset.id,asset])).values()];}

function shelfImageRules(books:Book[],shelf:ShelfTarget):ImageRule[]{
  const seen=new Set<string>();
  return shelfBooks(books,shelf).flatMap(book=>book.imageRules??[]).filter(rule=>{const key=JSON.stringify(rule);if(seen.has(key))return false;seen.add(key);return true;});
}

function shelfDisplayRules(books:Book[],shelf:ShelfTarget):DisplayRule[]{
  const counts=new Map<string,number>(),rules:DisplayRule[]=[];
  for(const book of shelfBooks(books,shelf)){
    const local=new Map<string,number>();
    for(const rule of book.displayRules??[]){const key=JSON.stringify(rule),count=(local.get(key)??0)+1;local.set(key,count);if(count>(counts.get(key)??0)){rules.push(rule);counts.set(key,count);}}
  }
  return rules;
}

function collapseShelfBookmarks(siblings:Book[]):Book[]{
  if(siblings.reduce((count,book)=>count+(book.bookmarks?.length??0),0)<=1)return siblings;
  const mark=canonicalBookmark(siblings)!;
  return siblings.map(book=>{
    if(!book.bookmarks?.length)return book;
    const bookmarks=book.id===mark.bookId?[book.bookmarks.at(-1)!]:[];
    return bookmarks.length===book.bookmarks.length?book:{...book,bookmarks};
  });
}
async function normalizeShelfBookmarks(books:Book[],store:AccountStore):Promise<Book[]>{
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
    await store.repackSeries(normalized[0]!.id,normalized,[]);
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
  const messages=book.messages.map((message,index)=>JSON.stringify(message.originalMap)===JSON.stringify(previous.messages[index]?.originalMap)?{...message,originalMap:previous.messages[index]?.originalMap}:message);
  if(equalRows(messages,previous.messages,['role','name','content','chapter','chapterTitle','chapterStart','pageBreakBefore','pageBreakAfter','originalContent','originalMap']))next.messages=previous.messages;
  if(equalRows(book.assets,previous.assets,['id','name','src','type']))next.assets=previous.assets;
  if(equalRows(book.bookmarks,previous.bookmarks,['message','char','label','progress']))next.bookmarks=previous.bookmarks;
  if(book.imageRules===previous.imageRules||JSON.stringify(book.imageRules)===JSON.stringify(previous.imageRules))next.imageRules=previous.imageRules;
  if(book.displayRules===previous.displayRules||JSON.stringify(book.displayRules)===JSON.stringify(previous.displayRules))next.displayRules=previous.displayRules;
  const fields=new Set([...Object.keys(previous),...Object.keys(next)]);
  return [...fields].every(field=>next[field as keyof Book]===previous[field as keyof Book])?previous:next;
}

const Reader = lazy(() => import('./components/Reader'));
const SharedBook=lazy(()=>import('./components/SharedBook'));
function sharedBookId(){const match=/^#\/share\/([^/]+)$/.exec(location.hash);return match?.[1]??null;}
const colors = BOOK_COLORS;
const retiredDemoIds = new Set(['sample-forest-letter','sample-terracotta-evening','sample-indigo-platform','sample-ochre-bookshop']);
function currentBookId() { try { const match = location.hash.match(/^#\/book\/([^/]+)$/); return match ? decodeURIComponent(match[1]) : null; } catch { return null; } }
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function storeBooks(incoming:Book[],existing:Book[],store:AccountStore,assertAccount:()=>void,normalize=true){
  for(let index=0;index<incoming.length;index++){const book=incoming[index]!;if(book.pageCount!==undefined&&book.pageLayoutVersion===PAGE_LAYOUT_VERSION)continue;incoming[index]={...book,pageCount:await measureBookPageCount(book),pageLayoutVersion:PAGE_LAYOUT_VERSION};assertAccount();await new Promise<void>(resolve=>setTimeout(resolve,0));assertAccount();}
  assertAccount();if(incoming.length)await store.repackSeries(incoming[0]!.id,incoming,[]);
  const byId=new Map(incoming.map(book=>[book.id,book]));const existingIds=new Set(existing.map(book=>book.id));
  const merged=[...existing.map(book=>byId.get(book.id)??book),...incoming.filter(book=>!existingIds.has(book.id))];
  return normalize?normalizeShelfBookmarks(merged,store):merged;
}

function Modal({title, children, onClose, wide=false, locked=false,headerAction}: {title:string; children:ReactNode; onClose:()=>void; wide?:boolean; locked?:boolean;headerAction?:ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);const titleId=useId();
  useEffect(()=>{const dialog=ref.current!; dialog.showModal(); return ()=>dialog.close();},[]);
  return <dialog className={`modal ${wide?'modal-wide':''}`} ref={ref} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(e.target===e.currentTarget&&!locked)onClose();}} onClick={e=>{if(!locked&&e.target===e.currentTarget)onClose();}}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><div className="modal-header-actions">{headerAction}<button className="icon-btn" title="닫기" aria-label="닫기" disabled={locked} onClick={onClose}><X size={20}/></button></div></div>{children}
  </dialog>;
}

function SortMenu({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const id=useId();
  const options=[{value:'recent',label:'최근 저장 순'},{value:'oldest',label:'오래된 순'},{value:'title',label:'제목순'}];
  useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();return()=>document.removeEventListener('pointerdown',close);},[open]);
  return <div className="sort-menu" ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}if(open&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'));const index=items.indexOf(document.activeElement as HTMLButtonElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}}}>
    <button ref={trigger} className="sort-trigger" type="button" aria-label="책 정렬" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(previous=>!previous)} onKeyDown={event=>{if(!open&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setOpen(true);}}}>{options.find(option=>option.value===value)?.label}<ChevronDown size={13}/></button>
    {open&&<div id={id} role="listbox" aria-label="책 정렬" className="sort-options">{options.map(option=><button key={option.value} type="button" role="option" aria-selected={value===option.value} onClick={()=>{onChange(option.value);setOpen(false);trigger.current?.focus();}}><span>{option.label}</span>{value===option.value&&<Check size={14}/>}</button>)}</div>}
  </div>;
}
function BookActions({book,open,onOpen,onClose,onEdit,onShare,onDelete}:{book:Book;open:boolean;onOpen:()=>void;onClose:()=>void;onEdit:()=>void;onShare:()=>void;onDelete:()=>void}){
 const popup=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const id=useId();
 useLayoutEffect(()=>{
  const element=popup.current;if(!element)return;
  if(!open){if(element.matches(':popover-open'))element.hidePopover();return;}
  function position(){const anchor=trigger.current?.getBoundingClientRect();if(!anchor||!element)return;const width=Math.min(158,innerWidth-16);const height=Math.min(138,innerHeight-16);const above=innerHeight-anchor.bottom<height+10&&anchor.top>height+10;element.style.width=`${width}px`;element.style.maxHeight=`${height}px`;element.style.left=`${Math.max(8,Math.min(anchor.right-width,innerWidth-width-8))}px`;element.style.top=`${Math.max(8,Math.min(above?anchor.top-height-6:anchor.bottom+6,innerHeight-height-8))}px`;}
  element.showPopover();position();element.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
  const scrolled=(event:Event)=>{if(!element.contains(event.target as Node))position();};window.addEventListener('resize',position);window.addEventListener('scroll',scrolled,true);
  return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',scrolled,true);if(element.matches(':popover-open'))element.hidePopover();};
 },[open]);
 return <div className={`book-menu-wrap ${open?'menu-open':''}`}><button ref={trigger} className="icon-btn" title="책 관리" aria-label={`${book.title} 관리`} aria-haspopup="menu" aria-controls={id} aria-expanded={open} onClick={event=>{event.stopPropagation();if(open)onClose();else onOpen();}}><Ellipsis size={19}/></button><div ref={popup} id={id} popover="auto" role="menu" aria-label={`${book.title} 관리`} className="book-actions-popover" onToggle={event=>{if(event.newState==='closed'&&open)onClose();}} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();trigger.current?.focus({preventScroll:true});}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=Array.from(popup.current!.querySelectorAll<HTMLButtonElement>('button'));const index=items.indexOf(document.activeElement as HTMLButtonElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus({preventScroll:true});}
 }}><button role="menuitem" onClick={()=>{onClose();onEdit();}}>꾸미기</button><button role="menuitem" onClick={()=>{onClose();onShare();trigger.current?.focus({preventScroll:true});}}>공유</button><button role="menuitem" className="danger-text" onClick={()=>{onClose();onDelete();}}>삭제</button></div></div>;
}
function LibraryDrawer({open,children,account,onClose}:{open:boolean;children:ReactNode;account:ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    if(!open)return;
    const dialog=ref.current,body=document.body,html=document.documentElement;
    const x=window.scrollX,y=window.scrollY;
    const previous={position:body.style.position,top:body.style.top,left:body.style.left,width:body.style.width,overflow:body.style.overflow,htmlOverflow:html.style.overflow};
    // A modal dialog makes the background inert, but does not lock mobile
    // viewport scrolling. Keep its original scroll position while the drawer is open.
    body.style.position='fixed';body.style.top=`-${y}px`;body.style.left=`-${x}px`;
    body.style.width='100%';body.style.overflow='hidden';html.style.overflow='hidden';
    dialog?.showModal();
    return()=>{
      dialog?.close();
      Object.assign(body.style,{position:previous.position,top:previous.top,left:previous.left,width:previous.width,overflow:previous.overflow});
      html.style.overflow=previous.htmlOverflow;
      window.scrollTo({left:x,top:y,behavior:'instant'});
    };
  },[open]);
  return <dialog ref={ref} id="library-drawer" className="library-drawer" aria-label="서재 메뉴" onCancel={event=>{event.preventDefault();if(event.target===event.currentTarget)onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="drawer-panel">
      <header><span className="drawer-brand"><BookOpen size={21} aria-hidden="true"/>갈피</span><button className="icon-btn" title="닫기" aria-label="서재 메뉴 닫기" onClick={onClose}><X size={19}/></button></header>
      <div className="drawer-content">{children}</div>
      <footer className="drawer-footer">{account}<a href="/privacy.html" target="_blank" rel="noopener noreferrer">개인정보 안내<ArrowRight size={13} aria-hidden="true"/></a></footer>
    </div>
  </dialog>;
}


function EditBook({book,onSave,onClose,scope='book'}:{book:Book;onSave:(book:Book,reset:boolean)=>Promise<void>;onClose:()=>void;scope?:'book'|'shelf'}){
  const [draft,setDraft]=useState(()=>({...book,author:book.author?.trim()?book.author:book.aiModel??book.author??''}));const [reset,setReset]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  function defaults(){setReset(true);setDraft(previous=>({...previous,color:colors[0]!,customColor:undefined,cover:undefined,backCover:undefined,characterIcon:undefined,assets:previous.assets?.map(asset=>asset.type==='icon'?{...asset,type:'asset' as const}:asset)}));}
  return <Modal title={scope==='shelf'?'책 꾸미기':`책 꾸미기 · ${String(book.volumeNumber??1).padStart(2,'0')}`} onClose={onClose} wide locked={busy} headerAction={<button type="button" className="icon-btn" aria-label="표지 기본값 복원" title="표지와 초상을 기본값으로" disabled={busy} onClick={defaults}><RotateCcw size={18}/></button>}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSave({...draft,title:draft.title.trim()},reset);onClose();}catch(e){setError(e instanceof Error?e.message:'저장하지 못했어요.');}finally{setBusy(false);}}}>
    <div className="edit-layout"><div className="cover-previews"><Cover book={draft}/></div><div className="space-y-4">
      <label className="field">책 제목<input required maxLength={100} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
      <AuthorPicker value={draft.author} disabled={busy} onChange={author=>setDraft({...draft,author})}/>
      <div className="field">표지 색<div className="cover-swatches">{colors.map(color=><button key={color} type="button" className="swatch" aria-label={`${color} 표지`} aria-pressed={draft.color===color} style={{background:color}} onClick={()=>setDraft({...draft,color})}>{draft.color===color&&<Check size={15}/>}</button>)}<label className="swatch custom-color-swatch" title="사용자 지정 색" style={{background:draft.customColor??draft.color}}><input type="color" aria-label="사용자 지정 표지 색" value={draft.customColor??draft.color} onChange={e=>setDraft({...draft,color:e.target.value,customColor:e.target.value})}/>{draft.color===draft.customColor?<Check size={15}/>:<Plus size={13}/>}</label></div></div>
      
    </div></div>
    {error&&<p className="error-message" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>취소</button><button className="primary-btn" disabled={busy||!draft.title.trim()}>{busy?<LoaderCircle size={16} className="animate-spin"/>:<Check size={16}/>} 저장하기</button></div>
  </form></Modal>;
}
function styleBook(book:Book,draft:Book,reset:boolean):Book{
  return {...book,author:draft.author.trim(),aiModel:undefined,color:draft.color,customColor:draft.customColor,
    ...(reset?{cover:undefined,backCover:undefined,characterIcon:undefined,assets:book.assets?.some(asset=>asset.type==='icon')?book.assets.map(asset=>asset.type==='icon'?{...asset,type:'asset' as const}:asset):book.assets}:{})};
}


export default function App(){
  const [share,setShare]=useState(sharedBookId);
  useEffect(()=>{const change=()=>setShare(sharedBookId());addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  return share?<Suspense fallback={<BookOpening variant="library" onBack={()=>{location.hash='/';}} onRetry={()=>location.reload()}/>}><SharedBook key={share} id={share}/></Suspense>:<AccountShell/>;
}
function AccountShell() {
  const [account,setAccount]=useState(()=>({owner:getAuthSession()?.user.id??null,version:0}));
  const [authReady,setAuthReady]=useState(false);
  const [authError,setAuthError]=useState('');
  const [authAttempt,setAuthAttempt]=useState(0);
  const authReadyRef=useRef(false);
  const ownerRef=useRef(account.owner);
  useEffect(()=>{
    let active=true;
    const change=()=>{
      if(!active)return;
      const owner=getAuthSession()?.user.id??null;
      if(owner===ownerRef.current)return;
      ownerRef.current=owner;
      stopCloudLibrary();
      if(authReadyRef.current)history.replaceState(history.state,'',`${location.pathname}${location.search}#/`);
      setAccount(previous=>({owner,version:previous.version+1}));
    };
    const unsubscribe=subscribeAuthSession(change);
    setAuthError('');
    void restoreAuthSession().then(()=>{
      if(!active)return;change();authReadyRef.current=true;setAuthReady(true);
    }).catch(cause=>{if(active)setAuthError(cause instanceof Error?cause.message:'로그인을 확인하지 못했어요.');});
    return()=>{active=false;unsubscribe();};
  },[authAttempt]);
  if(!authReady)return <BookOpening variant="library" error={authError} label={currentBookId()?'책을 펼치고 있어요…':'서재를 열고 있어요…'} backLabel="게스트로" onBack={()=>{clearAuthSession();history.replaceState(history.state,'',`${location.pathname}${location.search}#/`);authReadyRef.current=true;setAuthReady(true);}} onRetry={()=>setAuthAttempt(value=>value+1)}/>;
  // Unmount every reader/editor and discard old callbacks/state on an account change.
  return <AccountApp key={`${account.owner??'guest'}:${account.version}`} owner={account.owner}/>;
}

function AccountApp({owner}:{owner:string|null}) {
  const [library]=useState(()=>new CloudLibrary(owner));
  const [accountReady,setAccountReady]=useState(false);
  const [syncStatus,setSyncStatus]=useState<CloudStatus>({phase:'loading',message:'서재를 열고 있어요.'});
  const loadBooks=()=>library.loadBooks();
  async function loadTargetBooks(ids:string[]){
    const metadata=await library.loadBooks();if(!owner)return metadata;
    const hydrated=new Map<string,Book>();
    for(const id of new Set(ids)){hydrated.set(id,await library.ensureBook(id));library.assertCurrent();}
    return metadata.map(book=>hydrated.get(book.id)??book);
  }
  function accountGuard(){const generation=getLibraryGeneration();library.assertCurrent();return()=>{library.assertCurrent();if(generation!==getLibraryGeneration())throw new DOMException('계정이 변경되었어요.','AbortError');};}
  const [books,setBooks]=useState<Book[]>([]); const [loading,setLoading]=useState(true);const [error,setError]=useState(''); const [toast,setToast]=useState('');
  const [route,setRoute]=useState(currentBookId);const [readerStart,setReaderStart]=useState<{bookId:string;anchor:BookmarkAnchor}|null>(null); const [query,setQuery]=useState('');const [sort,setSort]=useState('recent');const canEdit=accountReady&&!loading;
  const [readyRoute,setReadyRoute]=useState<string|null>(null);const [openError,setOpenError]=useState('');const [openAttempt,setOpenAttempt]=useState(0);
  const [readerReady,setReaderReady]=useState<string|null>(null);
  const onReaderReady=useCallback(()=>setReaderReady(route),[route]);
  useEffect(()=>{setReaderReady(null);},[route]);
  const [drawerOpen,setDrawerOpen]=useState(false);const [intakeMode,setIntakeMode]=useState<'file'|'text'>('file');const [importing,setImporting]=useState(false);const [busy,setBusy]=useState(false);const [theme,setTheme]=useState<Theme>(readTheme);const [backupOpen,setBackupOpen]=useState(false);const [edit,setEdit]=useState<Book|null>(null);const [remove,setRemove]=useState<Book|null>(null);const [menu,setMenu]=useState<string|null>(null);const [view,setView]=useState<'covers'|'spines'>(()=>{try{return localStorage.getItem('galpi.library.view.v1')==='spines'?'spines':'covers';}catch{return 'covers';}});
  useEffect(()=>{try{localStorage.setItem('galpi.library.view.v1',view);}catch{/* Keep the selected view in memory when storage is unavailable. */}},[view]);
  const [clearConfirm,setClearConfirm]=useState<{title:string;ids:string[]}|null>(null);const [deleting,setDeleting]=useState(false);const [clearError,setClearError]=useState('');
  const [sharing,setSharing]=useState<Book|null>(null);
  const [shareQuotes,setShareQuotes]=useState<Record<string,string>>({});
  const [quoteBook,setQuoteBook]=useState<string|null>(null);
  const [cardBook,setCardBook]=useState<string|null>(null);
  function selectShareQuote(book:Book){setCardBook(book.id);setQuoteBook(book.id);setSharing(null);if(route!==book.id)openBook(book);}
  function finishShareQuote(text?:string){const book=latestBooks.current.find(item=>item.id===quoteBook);if(book){if(text!==undefined)setShareQuotes(previous=>({...previous,[book.id]:text}));setSharing(book);}setQuoteBook(null);}
  const [managingShares,setManagingShares]=useState(false);
  const [creating,setCreating]=useState<ShelfTarget|null>(null);const [renaming,setRenaming]=useState<ShelfTarget|null>(null);const [assetShelf,setAssetShelf]=useState<ShelfTarget|null>(null);
  const deletingRef=useRef(false);const editingShelf=useRef(false);const preparingAssets=useRef(false);
  const restore=useRef<HTMLInputElement>(null);const latestBooks=useRef(books); latestBooks.current=books;
  const splittingBooks=useRef(new Set<string>());
  useEffect(()=>{const sync=(event:Event)=>{const value=(event as CustomEvent<Theme>).detail;setTheme(value==='paper'||value==='warm'||value==='dark'?value:readTheme());};window.addEventListener(THEME_EVENT,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(THEME_EVENT,sync);window.removeEventListener('storage',sync);};},[]);
  useEffect(()=>{document.documentElement.dataset.libraryTheme=theme;document.documentElement.classList.toggle('dark',theme==='dark');return()=>{delete document.documentElement.dataset.libraryTheme;document.documentElement.classList.remove('dark');};},[theme]);
  function changeTheme(value:Theme){try{saveTheme(value);setTheme(value);}catch{setToast('테마를 저장하지 못했어요.');}}

  useEffect(()=>{
    let active=true;
    setLoading(true);setAccountReady(false);
    const initialLoad=library.start({
      initialize:async store=>{
      let data=await store.loadBooks();
      // Remove only the four app-provided demos, never user-created books.
      const demos=data.filter(book=>retiredDemoIds.has(book.id));
      if(demos.length){await store.deleteBooks(demos.map(book=>book.id));data=data.filter(book=>!retiredDemoIds.has(book.id));}
      data=await normalizeShelfBookmarks(data,store);
      for(let index=0;index<data.length;index++){
        const book=data[index]!;
        if(book.pageCount!==undefined&&book.pageLayoutVersion===PAGE_LAYOUT_VERSION)continue;
        const counted={...book,pageCount:await measureBookPageCount(book),pageLayoutVersion:PAGE_LAYOUT_VERSION};
        library.assertCurrent();await store.repackSeries(book.id,[counted],[]);data[index]=counted;
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      return data;
      },
      onBooks:data=>{if(!active)return;const previous=new Map(latestBooks.current.map(book=>[book.id,book]));const next=data.map(book=>reuseBookReferences(book,previous.get(book.id)));latestBooks.current=next;setBooks(next);},
      onStatus:status=>{if(active)setSyncStatus(status);},
    });
    void initialLoad.then(()=>{if(active)setAccountReady(true);})
      .catch(cause=>{if(active)setError(owner?(cause instanceof Error?cause.message:'서재 목록을 불러오지 못했어요.'):'서재를 열지 못했어요. 브라우저의 저장소 접근을 허용한 뒤 새로고침해 주세요.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;library.stop();};
  },[library]);
  useEffect(()=>{
    if(!owner||!route||!accountReady){setReadyRoute(null);return;}
    let active=true;setReadyRoute(null);setOpenError('');
    void library.ensureBook(route,true).then(book=>{
      if(!active)return;library.assertCurrent();const anchor=book.bookmarks?.at(-1);
      setReaderStart(anchor?{bookId:book.id,anchor}:null);setReadyRoute(route);
    }).catch(cause=>{if(active)setOpenError(cause instanceof Error?cause.message:'책을 불러오지 못했어요.');});
    return()=>{active=false;};
  },[library,owner,route,accountReady,openAttempt]);
  useEffect(()=>{const change=()=>{setRoute(currentBookId());setMenu(null);};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),3600);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!menu)return;const close=()=>setMenu(null);document.addEventListener('click',close);return()=>document.removeEventListener('click',close);},[menu]);
  const openBook=useCallback((book:Book)=>{
    library.assertCurrent();setReadyRoute(null);setReaderReady(null);setOpenError('');
    const mark=canonicalBookmark(shelfBooks(latestBooks.current,bookShelf(book)));
    setReaderStart(mark?.bookId===book.id?{bookId:book.id,anchor:{message:mark.message,char:mark.char}}:null);
    setRoute(book.id);location.hash=`/book/${encodeURIComponent(book.id)}`;
  },[library]);
  const closeBook=useCallback(()=>{setReaderStart(null);location.hash='/';},[]);
  async function commitBooks(ids:string[],make:(current:Book[])=>Book[]|Promise<Book[]>){
    const assertAccount=accountGuard();if(!canEdit)throw new Error('서재를 열고 있어요.');
    if(deletingRef.current||editingShelf.current||preparingAssets.current||splittingBooks.current.size>0)throw new Error('책을 저장 중이에요. 잠시 후 다시 시도해 주세요.');
    editingShelf.current=true;for(const id of ids)splittingBooks.current.add(id);setBusy(true);
    try{
      await library.edit(async store=>{
      let current=await store.loadBooks();assertAccount();
      if(owner){const hydrated=new Map<string,Book>();for(const id of new Set(ids)){hydrated.set(id,await store.ensureBook(id));assertAccount();}current=current.map(book=>hydrated.get(book.id)??book);}
      const updated=await make(current);assertAccount();
      if(!updated.length)throw new Error('책장을 찾지 못했어요.');
      await store.repackSeries(updated[0]!.id,updated,[]);assertAccount();
      const byId=new Map(updated.map(book=>[book.id,book]));
      // Storage returns clones. Preserve live references for untouched books and
      // equal reader inputs so bookmark/metadata saves do not rebuild pages.
      const liveById=new Map(latestBooks.current.map(book=>[book.id,book]));
      const next=current.map(book=>{
        const changed=byId.get(book.id);const live=liveById.get(book.id);
        return changed?reuseBookReferences(changed,live):(live??book);
      });const existing=new Set(current.map(book=>book.id));
      next.push(...updated.filter(book=>!existing.has(book.id)));latestBooks.current=next;setBooks(next);
      },{publish:!!owner});
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
    await commitBooks([book.id],async current=>{
      const stored=current.find(item=>item.id===book.id);if(!stored)throw new Error('책을 찾지 못했어요.');
      const updated={...stored,...patch};
      if(updated.pageCount===undefined||updated.pageLayoutVersion!==PAGE_LAYOUT_VERSION||!equalRows(updated.messages,stored.messages,['role','name','content','chapter','chapterTitle','chapterStart'])){
        updated.pageCount=await measureBookPageCount(updated);updated.pageLayoutVersion=PAGE_LAYOUT_VERSION;
      }
      return [updated];
    });
  };
  async function changeBookmark(book:Book,anchor:BookmarkAnchor|null,style?:Book['bookmarkStyle']){
    const shelf=bookShelf(book);
    await commitBookmarkFields(current=>{
      const siblings=shelfBooks(current,shelf);if(!siblings.some(item=>item.id===book.id))throw new Error('책을 찾지 못했어요.');
      const chosenStyle=style??canonicalBookmark(siblings)?.style??book.bookmarkStyle??'normal';
      return siblings.map(item=>({...item,bookmarks:anchor&&item.id===book.id?[anchor]:[],bookmarkStyle:chosenStyle,...(anchor&&item.id===book.id?{updatedAt:new Date().toISOString()}:{})}));
    });
  }
  async function changeBookmarkStyle(book:Book,style:NonNullable<Book['bookmarkStyle']>){
    const shelf=bookShelf(book);
    await commitBookmarkFields(current=>{
      const siblings=shelfBooks(current,shelf);const mark=canonicalBookmark(siblings);
      return siblings.map(item=>({...item,bookmarkStyle:style,bookmarks:mark&&item.id===mark.bookId?[{message:mark.message,char:mark.char,...(mark.label!==undefined?{label:mark.label}:{}),...(mark.progress!==undefined?{progress:mark.progress}:{})}]:[]}));
    });
  }
  async function commitBookmarkFields(make:(current:Book[])=>Book[]){
    const assertAccount=accountGuard();if(!canEdit)throw new Error('서재를 열고 있어요.');
    if(deletingRef.current||editingShelf.current||preparingAssets.current||splittingBooks.current.size>0)throw new Error('책을 저장 중이에요. 잠시 후 다시 시도해 주세요.');
    editingShelf.current=true;
    try{
      await library.edit(async store=>{
      const current=latestBooks.current;
      const updated=make(current);
      const currentById=new Map(current.map(book=>[book.id,book]));
      const changed=updated.filter(book=>{const previous=currentById.get(book.id);return !previous||(book.bookmarkStyle??'normal')!==(previous.bookmarkStyle??'normal')||book.updatedAt!==previous.updatedAt||JSON.stringify(book.bookmarks??[])!==JSON.stringify(previous.bookmarks??[]);});
      if(!changed.length)return;
      assertAccount();await store.updateBookmarks(changed.map(({id,bookmarks,bookmarkStyle,updatedAt})=>({id,bookmarks,bookmarkStyle,updatedAt})));assertAccount();
      // Keep the existing text, assets and source maps by reference. A bookmark
      // change must never reload or paginate the book's body.
      const byId=new Map(changed.map(book=>[book.id,book]));
      const next=latestBooks.current.map(book=>{const changedBook=byId.get(book.id);return changedBook?{...book,bookmarks:changedBook.bookmarks,bookmarkStyle:changedBook.bookmarkStyle,updatedAt:changedBook.updatedAt}:book;});
      latestBooks.current=next;setBooks(next);
      },{publish:!!owner});
    }finally{editingShelf.current=false;}
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
    const assertAccount=accountGuard();
    if(!canEdit||busy||editingShelf.current||deletingRef.current)throw new Error('저장이 끝난 뒤 다시 시도해 주세요.');
    let incoming:Book[]=[];
    if(request.mode==='file'){
      const failures:string[]=[];
      for(const file of request.files){try{incoming.push(...(await importChatFile(file,{removeUserInputs:request.removeUserInputs})).map(book=>({...book,author:request.author.trim(),aiModel:undefined,...(request.title.trim()?{title:book.seriesId?`${request.title.trim()} · ${book.volumeNumber??1}권`:request.title.trim(),...(book.seriesId||book.seriesTitle?{seriesTitle:request.title.trim()}:{})}:{})})));}catch(cause){failures.push(`${file.name}: ${cause instanceof Error?cause.message:'파일을 읽지 못했어요.'}`);}}
      if(failures.length)throw new Error(failures.join('\n'));
    }else{
      const now=new Date().toISOString();
      incoming=[{id:crypto.randomUUID(),title:request.title,author:request.name,description:request.text.slice(0,160),color:colors[0]!,createdAt:now,updatedAt:now,messages:[{role:'assistant',name:request.name,content:request.text}]}];
    }
    const target=creating;const siblings=target?shelfBooks(latestBooks.current,target):[];
    if(target&&siblings.length)incoming=incoming.map(book=>({...book,assets:shelfAssets(latestBooks.current,target),imageRules:shelfImageRules(latestBooks.current,target),displayRules:shelfDisplayRules(latestBooks.current,target),characterIcon:portrait(siblings[0]!),bookmarkAssetId:siblings[0]!.bookmarkAssetId,shareCardAssetId:siblings[0]!.shareCardAssetId,bookmarkStyle:siblings[0]!.bookmarkStyle,color:siblings[0]!.color,customColor:siblings[0]!.customColor}));
    // The optional card is staged with the logs and applied before their single
    // preprocessing pass. Nothing is persisted merely by selecting a file.
    if(request.mode==='file'&&request.cardFile){
      const card=await importAssetFile(request.cardFile);
      const icon=card.assets.find(asset=>asset.type==='icon');
      const palette=icon?await portraitPalette(icon.src):undefined;
      incoming=incoming.map(book=>({...book,
        assets:normalizeAssets([...(book.assets??[]),...card.assets]),
        imageRules:normalizeImageRules([...(book.imageRules??[]),...(card.imageRules??[])]),
        displayRules:[...(book.displayRules??[]),...(card.displayRules??[])],
        ...(icon?{characterIcon:icon.src}:{}),
        ...(palette?{color:palette,customColor:palette}:{})
      }));
    }
    // Parse every staged file first. Preparation happens once, before any write.
    const prepared=await prepareBooks(incoming,{removeEmoji:request.removeEmoji,removeSquareBrackets:request.removeSquareBrackets,removeAngleBrackets:request.removeAngleBrackets,removeDollarLines:request.removeDollarLines,removeHashLines:request.removeHashLines});
    assertAccount();
    if(!prepared.length)throw new Error('추가할 본문이 없어요.');
    let createdBook:Book|undefined;
    await commitBooks(siblings.map(book=>book.id),current=>{
      const occupied=new Set(current.map(book=>book.id));const remap=new Map<string,string>();
      for(const book of prepared){let id=book.id;while(occupied.has(id))id=crypto.randomUUID();occupied.add(id);remap.set(book.id,id);}
      const uploadedAt=new Date().toISOString();
      const fresh=prepared.map(book=>({...book,uploadedAt,id:remap.get(book.id)!,...(book.seriesId?{seriesId:remap.get(book.seriesId)??book.seriesId}:{})}));
      if(!target||target.ungrouped){createdBook=fresh[0];return fresh;}
      const fullSiblings=shelfBooks(current,target);if(!fullSiblings.length)throw new Error('대상 책장을 찾지 못했어요.');
      const count=fullSiblings.length+fresh.length;
      const appended=fresh.map((book,index)=>({...book,seriesId:target.id,seriesTitle:fullSiblings[0]!.seriesTitle??target.title,title:`${fullSiblings[0]!.seriesTitle??target.title} · ${fullSiblings.length+index+1}권`,volumeNumber:fullSiblings.length+index+1,volumeCount:count}));
      createdBook=appended[0];return [...fullSiblings.map(book=>({...book,volumeCount:count})),...appended];
    });
    setQuery('');setToast(`${prepared.length}권의 책을 추가했어요.`);if(request.mode==='text'&&createdBook)openBook(createdBook);
  }
  async function saveShelfAssets(shelf:ShelfTarget,assets:BookAsset[],imageRules:ImageRule[]=shelfImageRules(latestBooks.current,shelf),displayRules:DisplayRule[]=shelfDisplayRules(latestBooks.current,shelf),bookmarkAssetId?:string,shareCardAssetId?:string){
    const assertAccount=accountGuard();
    if(!canEdit||busy||preparingAssets.current||editingShelf.current||deletingRef.current)throw new Error('저장이 끝난 뒤 다시 시도해 주세요.');
    preparingAssets.current=true;setBusy(true);
    try{
      const ids=shelfBooks(latestBooks.current,shelf).map(book=>book.id);
      const snapshot=shelfBooks(await loadTargetBooks(ids),shelf);if(!snapshot.length)throw new Error('책장을 찾지 못했어요.');
      assertAccount();
      const expected=new Map(snapshot.map(book=>[book.id,book]));
      const icon=assets.find(asset=>asset.type==='icon')??assets[0];const palette=icon?await portraitPalette(icon.src):undefined;
      const processed=new Map<string,Book>();
      for(const book of snapshot){
        const imageId=assets.some(asset=>asset.id===bookmarkAssetId)?bookmarkAssetId:undefined;
        const styled={...book,assets,imageRules,displayRules,bookmarkAssetId:imageId,shareCardAssetId:assets.some(asset=>asset.id===shareCardAssetId)?shareCardAssetId:undefined,bookmarkStyle:imageId&&imageId!==book.bookmarkAssetId?'image' as const:!imageId&&book.bookmarkStyle==='image'?'normal' as const:book.bookmarkStyle,characterIcon:icon?.src,...(palette?{color:palette,customColor:palette}:assets.length?{}:{cover:undefined,backCover:undefined,color:colors[0]!,customColor:undefined})};
        const ruled=await applyBookDisplayRules(styled,displayRules);
        if(ruled.pageCount===undefined||ruled.pageLayoutVersion!==PAGE_LAYOUT_VERSION||!equalRows(ruled.messages,book.messages,['role','name','content','chapter','chapterTitle','chapterStart'])||!equalRows(ruled.assets,book.assets,['id','name','src','type'])){
          ruled.pageCount=await measureBookPageCount(ruled);ruled.pageLayoutVersion=PAGE_LAYOUT_VERSION;
        }
        processed.set(book.id,ruled);
        assertAccount();
      }
      // Release only our processing guard immediately before acquiring commitBooks' guard.
      preparingAssets.current=false;
      await commitBooks(snapshot.map(book=>book.id),current=>{
        const siblings=shelfBooks(current,shelf);
        if(siblings.length!==snapshot.length||siblings.some(book=>!expected.has(book.id)||reuseBookReferences(book,expected.get(book.id))!==expected.get(book.id)))throw new Error('처리 중 책이 변경됐어요. 다시 저장해 주세요.');
        return siblings.map(book=>processed.get(book.id)!);
      });
      setSharing(previous=>previous?latestBooks.current.find(book=>book.id===previous.id)??previous:null);
      setToast('에셋과 규칙을 저장했어요.');
    }finally{preparingAssets.current=false;setBusy(false);}
  }
  async function backupBooks(){
    const assertAccount=accountGuard();
    if(!clearConfirm)return;

    const targetIds=new Set(clearConfirm.ids);
    const persisted=(await loadTargetBooks([...targetIds])).filter(book=>targetIds.has(book.id));
    assertAccount();
    download(clearConfirm.title+'-'+new Date().toISOString().slice(0,10)+'.json',{format:'galpi-backup',version:1,volumePolicy:'chapters-200-v1',books:persisted});
    setToast('백업 완료');
  }
  async function clearBooks(){
    const assertAccount=accountGuard();
    if(!canEdit||!clearConfirm||deletingRef.current||preparingAssets.current||busy||loading)return;
    if(splittingBooks.current.size){setClearError('책을 저장 중이에요. 잠시 후 다시 시도해 주세요.');return;}
    deletingRef.current=true;setDeleting(true);setBusy(true);setClearError('');
    try{
  
      const targetIds=new Set(clearConfirm.ids);
      await library.edit(store=>store.deleteBooks([...targetIds]));assertAccount();
      const remaining=latestBooks.current.filter(book=>!targetIds.has(book.id));
      latestBooks.current=remaining;setBooks(remaining);
      if(targetIds.has(currentBookId()??'')){setRoute(null);location.hash='/';}
      setMenu(null);if(edit&&targetIds.has(edit.id))setEdit(null);if(remove&&targetIds.has(remove.id))setRemove(null);setClearConfirm(null);
      setToast('책장을 삭제했어요.');
    }catch{setClearError('삭제하지 못했어요. 다시 시도해 주세요.');}
    finally{deletingRef.current=false;setDeleting(false);setBusy(false);}
  }
  async function restoreBackup(file?:File){
    if(!canEdit||!file||busy||preparingAssets.current)return;
    const assertAccount=accountGuard();setBusy(true);setError('');
    try{
      const data=JSON.parse(await file.text());assertAccount();
      if(data.format!=='galpi-backup'||!Array.isArray(data.books))throw new Error('갈피에서 내보낸 책장 백업 파일을 선택해 주세요.');
      const normalized=await importChatFile(new File([JSON.stringify(data.books)],'backup.json',{type:'application/json'}),{removeUserInputs:false});assertAccount();
      const merged=await library.edit(async store=>storeBooks(normalized,await store.loadBooks(),store,assertAccount,!owner),{publish:!!owner});assertAccount();
      if(!owner){latestBooks.current=merged;setBooks(merged);}setToast(`${normalized.length}권을 복원했어요.`);
    }catch(e){setError(e instanceof Error?e.message:'백업을 복원하지 못했어요.');}
    finally{setBusy(false);if(restore.current)restore.current.value='';}
  }
  async function exportLibrary(){
    const assertAccount=accountGuard();
    if(busy)return;setBusy(true);
    try{const metadata=await loadBooks();const persisted=await loadTargetBooks(metadata.map(book=>book.id));assertAccount();download('갈피-책장-'+new Date().toISOString().slice(0,10)+'.json',{format:'galpi-backup',version:1,volumePolicy:'chapters-200-v1',books:persisted});setToast('백업 완료');}
    catch{setToast('백업하지 못했어요.');}
    finally{setBusy(false);}
  }
  async function exportOne(book:Book){
    if(busy)return;const assertAccount=accountGuard();setBusy(true);
    try{const full=owner?await library.ensureBook(book.id):book;assertAccount();download(`${full.title}.json`,[full]);}
    catch(cause){setError(cause instanceof Error?cause.message:'책을 내보내지 못했어요.');}finally{setBusy(false);}
  }
  async function shareOne(book:Book){
    if(busy)return;setBusy(true);
    try{const full=owner?await library.ensureBook(book.id,true):book;library.assertCurrent();setSharing(full);}catch(cause){setError(cause instanceof Error?cause.message:'책을 불러오지 못했어요.');}finally{setBusy(false);}
  }
  async function editOne(book:Book){
    if(busy)return;setBusy(true);
    try{setEdit(owner?await library.ensureBook(book.id,true):book);}catch(cause){setError(cause instanceof Error?cause.message:'책을 불러오지 못했어요.');}finally{setBusy(false);}
  }
  async function openAssets(shelf:ShelfTarget){
    if(busy)return;setBusy(true);
    try{if(owner)await loadTargetBooks(shelfBooks(latestBooks.current,shelf).map(book=>book.id));library.assertCurrent();setAssetShelf(shelf);}catch(cause){setError(cause instanceof Error?cause.message:'에셋을 불러오지 못했어요.');}finally{setBusy(false);}
  }
  async function reloadLibrary(){
    if(busy||route||edit||renaming||assetShelf||importing||creating)return;
    setLoading(true);setReadyRoute(null);setReaderReady(null);
    try{await library.reload();library.assertCurrent();setAccountReady(true);setError('');}
    catch(cause){setError(cause instanceof Error?cause.message:'목록을 불러오지 못했어요.');}finally{setLoading(false);}
  }
  async function importGuest(){
    if(!canEdit||busy)return;
    const assertAccount=accountGuard();setBusy(true);
    try{const count=await library.importGuestBooks();assertAccount();setToast(count?`${count}권을 가져왔어요. 이미지는 이 기기에만 보관돼요.`:'이 기기에 가져올 책이 없어요.');}
    finally{setBusy(false);}
  }
  const shelfDrag=useShelfDrag(owner,canEdit&&!busy&&!route&&!loading&&!query,id=>{const book=latestBooks.current.find(book=>book.id===id);if(book)setRemove(book);});
  const pendingBook=useMemo<Book>(()=>({id:route??'',title:'',author:'',description:'',color:BOOK_COLORS[0]!,createdAt:'',updatedAt:'',messages:[]}),[route]);
  const selected=books.find(b=>b.id===route);
  const selectedBookmark=selected?canonicalBookmark(shelfBooks(books,bookShelf(selected))):undefined;
  const markedBooks=books.filter(book=>canonicalBookmark(shelfBooks(books,bookShelf(book)))?.bookId===book.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const shown=books.filter(book=>`${book.title} ${book.author} ${book.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,'ko'):sort==='oldest'?String(a.createdAt).localeCompare(String(b.createdAt)):String(b.updatedAt).localeCompare(String(a.updatedAt)));
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
  const assetManager=canEdit&&assetShelf&&<AssetManager assets={shelfAssets(books,assetShelf)} imageRules={shelfImageRules(books,assetShelf)} displayRules={shelfDisplayRules(books,assetShelf)} bookmarkAssetId={shelfBooks(books,assetShelf).find(book=>book.bookmarkAssetId)?.bookmarkAssetId} shareCardAssetId={shelfBooks(books,assetShelf).find(book=>book.shareCardAssetId)?.shareCardAssetId} onSave={(assets,rules,displayRules,bookmarkAssetId,shareCardAssetId)=>saveShelfAssets(assetShelf,assets,rules,displayRules,bookmarkAssetId,shareCardAssetId)} onClose={()=>setAssetShelf(null)}/>;
  if(route&&(loading||owner||selected)){
    const dataReady=!loading&&selected&&(!owner||readyRoute===route);
    const openingError=openError||(!loading&&!accountReady?error:'');

    return <>
      <div>
        <Suspense fallback={<BookOpening variant="library" onBack={closeBook} onRetry={()=>location.reload()}/>}><Reader key={`${route}:${openAttempt}`} book={selected??pendingBook} dataPending={!dataReady} onReady={onReaderReady} onOpenError={setOpenError} onClose={closeBook} onShare={()=>{if(selected)setSharing(selected);}} selectingQuote={quoteBook===selected?.id} onQuoteSelected={finishShareQuote} onSaveBook={canEdit?updateBook:undefined} shelfBookmark={selectedBookmark} bookmarkStyle={selectedBookmark?.style??selected?.bookmarkStyle??(selected?shelfBooks(books,bookShelf(selected)).find(book=>book.bookmarkStyle)?.bookmarkStyle:undefined)} bookmarkImage={selected?bookmarkImage(selected):undefined} characterIcon={selected?(portrait(selected)??shelfBooks(books,bookShelf(selected)).map(portrait).find(Boolean)):undefined} onBookmarkChange={async(anchor,style)=>{if(selected)await changeBookmark(selected,anchor,style);}} onBookmarkStyleChange={async style=>{if(selected)await changeBookmarkStyle(selected,style);}} initialBookmark={readerStart&&readerStart.bookId===selected?.id?readerStart.anchor:undefined} onNextVolume={nextVolume?onNextVolume:undefined} nextVolumeTitle={nextVolume?.title}/></Suspense>
      </div>
      {openingError&&<BookOpening error={openingError} onBack={()=>{setRoute(null);location.hash='/';}} onRetry={()=>{setReaderReady(null);setOpenError('');if(accountReady)setOpenAttempt(value=>value+1);else location.reload();}}/>}
      {assetManager}
      {managingShares&&<ShareManager onClose={()=>setManagingShares(false)}/>}
    {sharing&&<ShareDialog book={sharing} quote={shareQuotes[sharing.id]??''} initialMode={cardBook===sharing.id?'card':'url'} onSelectQuote={()=>selectShareQuote(sharing)} onClearQuote={()=>setShareQuotes(previous=>({...previous,[sharing.id]:''}))} onClose={()=>setSharing(null)} onManageAssets={()=>{if(sharing)void openAssets(bookShelf(sharing));}} onLogin={()=>{setSharing(null);setRoute(null);location.hash='/';setDrawerOpen(true);}}/>}
      {toast&&<div className="toast" role="status">{toast}</div>}
    </>;
  }
  return <div className="app-shell">
    <header className="site-header" inert={deleting}><button className="drawer-trigger" aria-label="서재 메뉴 열기" title="내 서재" aria-expanded={drawerOpen} aria-controls="library-drawer" onClick={()=>setDrawerOpen(true)}><Menu size={20}/></button><a href="#/" className="brand" aria-label="갈피 서재"><span className="brand-mark"><BookOpen size={23} strokeWidth={1.4}/><span/></span><span>갈피<span className="brand-en">galpi</span></span></a></header>
    <div className="workspace" inert={deleting}>
      <LibraryDrawer open={drawerOpen} account={<GoogleAccount compact disabled={loading||busy||deleting||editingShelf.current||preparingAssets.current}/>} onClose={()=>setDrawerOpen(false)}>
        <nav className="drawer-navigation" aria-label="서재 메뉴">
          <h2 className="drawer-label">서재</h2>
          <button className="nav-item active" aria-current="page" onClick={()=>{setDrawerOpen(false);setQuery('');}}><Library size={18}/><span>내 서재</span><small title="책장 수">{groupBooks(books).length}</small></button>
          <button className="nav-item" aria-expanded={backupOpen} aria-controls="drawer-backup" onClick={()=>setBackupOpen(value=>!value)}><ArrowDownToLine size={18}/><span>백업·복원</span><ChevronDown className="drawer-chevron" size={15}/></button>
          {backupOpen&&<div id="drawer-backup" className="drawer-backup">
            <button disabled={busy||loading} onClick={()=>void exportLibrary()}><ArrowDownToLine size={15}/>백업</button>
            <button disabled={busy||!canEdit} onClick={()=>restore.current?.click()}><Upload size={15}/>복원</button>
          </div>}
          {owner&&<><button className="nav-item" onClick={()=>{setDrawerOpen(false);setManagingShares(true);}}><Link size={18}/><span>공유 URL 관리</span></button><button className="nav-item" disabled={busy||loading} onClick={()=>void reloadLibrary()}><RotateCcw size={18}/><span>목록 새로고침</span></button><button className="nav-item" disabled={busy||loading} onClick={()=>void importGuest().catch(cause=>setError(cause instanceof Error?cause.message:'책을 가져오지 못했어요.'))}><Upload size={18}/><span>이 기기 책 가져오기</span></button></>}
        </nav>
        <section className="drawer-appearance" aria-label="화면 설정"><h2 className="drawer-label">화면</h2><ThemePicker value={theme} onChange={changeTheme}/></section>

        {error&&<p className="error-message" role="alert">{error}</p>}
      </LibraryDrawer>

      <main className="main-content">
        <section className="library-intro"><h1>내 서재</h1>{canEdit&&<button className="primary-btn" title="로그 가져오기" onClick={()=>{setError('');setIntakeMode('file');setCreating(null);setImporting(true);}}><Upload size={17}/>로그 가져오기</button>}</section>
        {error&&<div className="error-banner" role="alert">{error}<button className="icon-btn" aria-label="오류 닫기" onClick={()=>setError('')}><X size={16}/></button></div>}
        {route&&!selected&&!loading&&<div className="error-banner">이 브라우저에 저장되지 않은 책이에요.<a href="#/">서재로 돌아가기</a></div>}


        {markedBooks.length>0&&<section className="resume-section" aria-label="이어읽기"><h2>이어읽기</h2><div className="resume-list">{markedBooks.map(book=><button key={book.id} className="resume-link" title="책갈피에서 이어읽기" onClick={()=>openBook(book)}><Bookmark size={14}/><span>{book.title}</span><ArrowRight size={14}/></button>)}</div></section>}
        <section aria-label="책장" className="collection"><div className="collection-toolbar"><div className="collection-heading"><h2>책장</h2><span>{groups.length}작품 · {shown.length}권</span></div><div className="collection-controls"><label className="search-box"><Search size={16}/><input aria-label="이야기 검색" placeholder="검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="검색 초기화" onClick={()=>setQuery('')}><X size={14}/></button>}</label><SortMenu value={sort} onChange={value=>{setSort(value);shelfDrag.reset();}}/><button type="button" className="view-switch view-segment-toggle" role="switch" aria-label="책등 보기" aria-checked={view==='spines'} title={view==='spines'?'표지 보기로 전환':'책등 보기로 전환'} onClick={()=>setView(value=>value==='covers'?'spines':'covers')}><span className="view-switch-thumb" aria-hidden="true"/><span className={view==='covers'?'selected':''} aria-hidden="true"><BookOpen size={16}/></span><span className={view==='spines'?'selected':''} aria-hidden="true"><Library size={16}/></span></button></div></div>
          {loading?<LibraryLoading view={view}/>:shown.length?<div className="shelf-groups" ref={shelfDrag.host}>{shelves.map(shelf=>{const mark=canonicalBookmark(shelfBooks(books,{id:shelf.id,title:shelf.title,ungrouped:shelf===singletons}));return <section key={shelf===singletons?'singletons':`series:${shelf.id}`} aria-label={shelf.title} className="series-shelf" data-series-id={shelf.id}>
            <header className="series-heading"><h3>{shelf.title}</h3><span>{shelf.books.length}권</span>{canEdit&&<div className="shelf-actions"><button className="icon-btn" aria-label={`${shelf.title} 책장 꾸미기`} title="책장 꾸미기" disabled={busy} onClick={()=>setRenaming({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons})}><Pencil size={16}/></button><button className="icon-btn" aria-label={`${shelf.title} 에셋 관리`} title="에셋 이미지 관리" disabled={busy} onClick={()=>void openAssets({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons})}><Images size={17}/></button><button className="icon-btn shelf-delete danger-text" aria-label={`${shelf.title} 책장 삭제`} title={`${shelf.title} 책장 삭제`} disabled={busy||loading||splittingBooks.current.size>0} onClick={()=>{const targets=books.filter(book=>shelf===singletons?!book.seriesId:(book.seriesId??book.id)===shelf.id);setClearError('');setClearConfirm({title:shelf.title,ids:targets.map(book=>book.id)});}}><Trash2 size={17}/></button></div>}</header>
            <ShelfBox view={view}>{view==='spines'&&<span className="shelf-bookstop shelf-bookstop-start" aria-hidden="true"/>}{shelfDrag.ordered(shelf.id,shelf.books).map((book,index)=><article key={book.id} data-drag-book={book.id} className={`book-item ${view==='spines'?'spine-item':''} ${mark?.bookId===book.id?'book-has-bookmark':''}`} data-bookmarked={mark?.bookId===book.id||undefined} style={{'--cover':book.color,'--delay':`${Math.min(index,8)*60}ms`} as CSSProperties}>
              <button className="book-read" aria-label={`${book.title} 읽기`} title={`${book.title} 읽기`} onClick={()=>openBook(book)}>
                <div className="book-stage"><div className="book-open">{mark?.bookId===book.id&&<BookRibbon book={book} mark={mark} view={view}/>}{view==='covers'?<Cover book={book}/>:<div className="book-spine"><SpineTitle title={displayBookTitle(book)}/><span className="spine-volume">{String(book.volumeNumber??1).padStart(2,'0')}</span></div>}</div></div>
                <div className="book-caption"><div><span className="book-title">{book.title}</span><p>{book.author || '저자 모델 미상'}</p></div></div>
                <div className="book-meta"><span>{book.pageCount?.toLocaleString()??'…'}페이지</span><span>{mark?.bookId===book.id&&<Bookmark size={13} fill="currentColor" aria-label="책갈피"/>}</span></div>
              </button>
              {canEdit&&<BookActions book={book} open={menu===book.id} onOpen={()=>setMenu(book.id)} onClose={()=>setMenu(previous=>previous===book.id?null:previous)} onEdit={()=>void editOne(book)} onShare={()=>void shareOne(book)} onDelete={()=>setRemove(book)}/>}
            </article>)}{view==='spines'&&<span className="shelf-bookstop shelf-bookstop-end" aria-hidden="true"/>}{canEdit&&<button className={`add-book-card ${view==='spines'?'add-spine-card':''}`} aria-label={`${shelf.title} 새 책 쓰기`} title="직접 쓴 이야기 추가" disabled={busy} onClick={()=>{setIntakeMode('text');setCreating({id:shelf.id,title:shelf.title,ungrouped:shelf===singletons});}}><span className="add-book-outline"><Plus size={24} strokeWidth={1.2}/></span><span className="sr-only">새 책 쓰기</span></button>}</ShelfBox>
          </section>;})}</div>:<div className="empty-state"><BookOpen size={38} strokeWidth={1}/><h3>{query?'검색 결과 없음':'책이 없어요'}</h3>{canEdit&&!query&&<div className="empty-actions"><button className="secondary-btn" onClick={()=>{setIntakeMode('text');setCreating({id:'ungrouped',title:'단권',ungrouped:true});}}><Plus size={17}/>새 책 쓰기</button><button className="secondary-btn" onClick={()=>{setIntakeMode('file');setCreating(null);setImporting(true);}}><Upload size={17}/>로그 가져오기</button></div>}</div>}

        </section>

      </main>
    </div>
    <input className="sr-only" ref={restore} type="file" accept=".json" onChange={e=>void restoreBackup(e.target.files?.[0])}/>
    {canEdit&&(importing||creating)&&<BookIntake initialMode={intakeMode} title={creating&&!creating.ungrouped?creating.title:''} author={creating?(shelfBooks(books,creating)[0]?.author||shelfBooks(books,creating)[0]?.aiModel||''):''} onConfirm={intakeBooks} onClose={()=>{setImporting(false);setCreating(null);}}/>}
    {canEdit&&renaming&&shelfBooks(books,renaming)[0]&&<EditBook scope="shelf" book={{...shelfBooks(books,renaming)[0]!,title:renaming.title}} onSave={(draft,reset)=>decorateShelf(renaming,draft,reset)} onClose={()=>setRenaming(null)}/>}
    {assetManager}
    {canEdit&&edit&&<EditBook book={edit} onSave={decorateBook} onClose={()=>setEdit(null)}/>}
    {canEdit&&clearConfirm&&<Modal title="책장 삭제" locked={busy} onClose={()=>setClearConfirm(null)}>
      <div className="delete-shelf-confirm" aria-busy={deleting}>
        <span className="delete-shelf-icon" aria-hidden="true"><Trash2 size={26} strokeWidth={1.5}/></span>
        <p className="delete-shelf-count">‘{clearConfirm.title}’ 책장의<br/>총 <strong>{clearConfirm.ids.length.toLocaleString()}권</strong>을 삭제할까요?</p>
        <p className="modal-description">이 책장에 담긴 책의 대화와 책갈피가 사라져요.<br/><strong>삭제 후에는 되돌릴 수 없어요.</strong></p>
        <button className="secondary-btn clear-backup" disabled={busy} onClick={async()=>{setBusy(true);try{await backupBooks();}catch{setClearError('백업하지 못했어요. 다시 시도해 주세요.');}finally{setBusy(false);}}}><ArrowDownToLine size={16}/> 먼저 백업하기 <span>선택</span></button>
        {clearError&&<p className="error-message" role="alert">{clearError}</p>}
        <div className="modal-actions"><button className="secondary-btn" autoFocus disabled={busy} onClick={()=>setClearConfirm(null)}>취소</button><HoldDelete disabled={busy} onConfirm={()=>void clearBooks()}/></div>
      </div>
    </Modal>}
    {managingShares&&<ShareManager onClose={()=>setManagingShares(false)}/>}
    {sharing&&<ShareDialog book={sharing} quote={shareQuotes[sharing.id]??''} initialMode={cardBook===sharing.id?'card':'url'} onSelectQuote={()=>selectShareQuote(sharing)} onClearQuote={()=>setShareQuotes(previous=>({...previous,[sharing.id]:''}))} onClose={()=>setSharing(null)} onManageAssets={()=>{if(sharing)void openAssets(bookShelf(sharing));}} onLogin={()=>{setSharing(null);setDrawerOpen(true);}}/>}
    {canEdit&&remove&&<Modal title="책 삭제" onClose={()=>setRemove(null)}><p className="modal-description">‘{remove.title}’을 삭제할까요?</p><div className="modal-actions"><button className="secondary-btn" title="삭제 전 이 책을 백업" onClick={()=>void exportOne(remove)}><ArrowDownToLine size={16}/> 백업</button><button className="danger-btn" title="대화와 책갈피를 삭제합니다" disabled={busy} onClick={async()=>{if(!canEdit||deletingRef.current||editingShelf.current||preparingAssets.current||splittingBooks.current.size)return;const assertAccount=accountGuard();deletingRef.current=true;setBusy(true);try{await library.edit(store=>store.deleteBook(remove.id));assertAccount();const next=latestBooks.current.filter(b=>b.id!==remove.id);latestBooks.current=next;setBooks(next);setRemove(null);setToast('삭제 완료');}catch{setToast('삭제 실패');}finally{deletingRef.current=false;setBusy(false);}}}>삭제</button></div></Modal>}
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}

