import {bookAuthor} from '../lib/bookAuthor';
import {normalizeDisplayPrompt} from '../../shared/displayPrompt';
import SimpleEditTools from './SimpleEditTools';
import {resolveDisplayImageReferences} from '../lib/displayRules';
import type {QuotePageRange} from '../lib/shareTicket';
import Toast from './Toast';
import AdvancedBookEditor from './AdvancedBookEditor';
import {useToast} from '../lib/useToast';
import {createOffsetMapper} from '../lib/advancedEditing';
import { createContext, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { PageFlip } from '../vendor/page-flip/PageFlip';
import { SizeType } from '../vendor/page-flip/Settings';
import { FlipCorner } from '../vendor/page-flip/Flip/Flip';
import { ArrowRight, BookOpen, Bookmark, Check, ChevronLeft, ChevronRight, List, Maximize, Minus, Pencil, Plus, Search, Share2, Type, X } from 'lucide-react';
import type { Book, BookAsset } from '../lib/library';
import { paginate, cleanText, startsChapter, chapterNumber, pageTextInsets } from '../lib/pagination';
import type { Anchor, Fragment, PaperPage } from '../lib/pagination';
import { readerPageCount, readReaderViewport,classifyReaderViewport } from '../lib/readerLayout';
import BackBarcode from './BackBarcode';
import ThemePicker from './ThemePicker';
import {readTheme,saveTheme,THEME_EVENT} from '../lib/appearance';
import {visibleProse,visibleSlice,displayHiddenRanges,hiddenUserInput} from '../lib/prose';
import {imageReferenceRanges} from '../lib/assets';
import {chapterLabel,editedMessages,fragmentKey} from '../lib/bookEditing';
import BookmarkTitle from './BookmarkTitle';
import ShareQuoteSelection from './ShareQuoteSelection';
import { BookmarkMotion, sampleBookmarkThrow } from './bookmarkMotion';
import AssetImage from './AssetImage';
import BookCover from './BookCover';
import {ReadingSkeleton} from './LoadingSkeleton';
import {beginSkeletonTask} from '../lib/loadingActivity';
import {squareAssetCrop} from '../lib/assetCrop';
import './reader.css';

export interface ReaderProps {
  book: Book;
  dataPending?: boolean;
  onClose: () => void;
  onReady?: () => void;
  onOpenError?: (message:string) => void;
  initialBookmark?: { message: number; char: number };
  onNextVolume?: () => void;
  nextVolumeTitle?: string;
  onSaveBook?: (book:Book)=>Promise<void>;
  onShare?: () => void;
  selectingQuote?: boolean;
  onQuoteSelected?: (text?:string,pages?:QuotePageRange) => void;
  shelfBookmark?: { bookId: string; message: number; char: number; label?: string; progress?:number; style?: BookmarkStyle; icon?: string; image?: string; title: string };
  onBookmarkChange?: (anchor: (Anchor & { label?: string; progress?:number }) | null, style?: BookmarkStyle) => Promise<void>;
  onBookmarkStyleChange?: (style: BookmarkStyle) => Promise<void>;
  bookmarkStyle?: BookmarkStyle;
  characterIcon?: string;
  bookmarkImage?: string;
}

type BookmarkStyle = 'normal' | 'character' | 'image';
type Panel = 'contents' | 'search' | 'appearance' | null;
type Theme = 'paper' | 'warm' | 'dark';
type SearchHit = Anchor & { length: number; excerpt: string; name: string };
type ReaderPreferences = { theme: Theme; fontSize: number };

const PREFERENCES_KEY = 'galpi.reader.appearance.v1';
const FULLWINDOW_KEY = 'galpi.reader.fullwindow.v1';
const FOLD_FULLWINDOW_KEY = 'galpi.reader.fold-fullwindow.v1';
const MAX_FULLWINDOW_PAGE_RATIO = .75;

function readReaderPreferences(): ReaderPreferences {
  const defaults: ReaderPreferences = { theme: 'paper', fontSize: 18 };
  try {
    if (typeof window === 'undefined') return defaults;
    const saved: unknown = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || 'null');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    const values = saved as Partial<ReaderPreferences>;
    return {
      theme: values.theme === 'paper' || values.theme === 'warm' || values.theme === 'dark' ? values.theme : defaults.theme,
      fontSize: typeof values.fontSize === 'number' && Number.isFinite(values.fontSize)
        ? Math.max(14, Math.min(28, Math.round(values.fontSize))) : defaults.fontSize,
    };
  } catch {
    return defaults;
  }
}

function readFullwindowPreference(): boolean {
  const category=classifyReaderViewport(readReaderViewport());
  if(category==='phone')return true;
  try {
    const saved = window.localStorage.getItem(category==='fold'?FOLD_FULLWINDOW_KEY:FULLWINDOW_KEY);
    if (saved === 'true' || saved === 'false') return saved === 'true';
  } catch { /* Unavailable storage must not prevent opening a book. */ }
  return category==='fold';
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pageForAnchor(pages: PaperPage[], anchor: Anchor) {
  const found = pages.findIndex(page => page.fragments.some(fragment =>
    fragment.message === anchor.message && fragment.char <= anchor.char &&
    (anchor.char < fragment.end || fragment.char === fragment.end),
  ));
  if(found>=0)return found;
  // End-of-message bookmarks still belong to their last text leaf, not the cover.
  for(let index=pages.length-1;index>=0;index--)if(pages[index].fragments.some(fragment=>fragment.message===anchor.message&&fragment.end<=anchor.char))return index;
  for(let index=pages.length-1;index>=0;index--)if(pages[index].fragments.length)return index;
  return bodyStart(pages);
}

function bodyStart(pages:PaperPage[]){const first=pages.findIndex(page=>!page.kind||page.kind==='paper'||page.kind==='asset');return Math.max(0,first);}
// Spread bookmarks use even leaves; phones keep the exact visible leaf.
function bookmarkLeaf(pages:PaperPage[],index:number,singlePage=false){
 const start=bodyStart(pages);if(index<start)return -1;
 if(singlePage)return index<pages.length?index:-1;
 const next=(index-start)%2===0?index+1:index;
 return next<pages.length?next:Math.max(start+1,index-1);
}
function bookmarkPage(pages:PaperPage[],anchor:Anchor,singlePage=false){return bookmarkLeaf(pages,pageForAnchor(pages,anchor),singlePage);}
function bookmarkAnchor(pages:PaperPage[],index:number,contentCount:number,singlePage=false){
 if(!pages.length)return null;
 const target=bookmarkLeaf(pages,index,singlePage),page=pages[target];if(target<0)return null;
 const start=bodyStart(pages);
 const fragment=page?.fragments.find(fragment=>!fragment.hidden)??page?.fragments[0];
 if(fragment)return {message:fragment.message,char:fragment.char,progress:Math.min(1,(target-start)/Math.max(1,contentCount-1)),label:page.asset?.name??fragment.asset?.name??fragment.text.slice(0,60)};
 // An even blank endpaper still belongs to the preceding text's anchor.
 for(let cursor=target-1;cursor>=0;cursor--){const prior=pages[cursor];const first=prior.fragments[0];if(first)return {message:first.message,char:first.char,progress:Math.min(1,(target-start)/Math.max(1,contentCount-1)),label:'책갈피'};}
 return null;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const pattern = new RegExp(escapeRegExp(query.trim()), 'giu');
  const pieces = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    pieces.push(text.slice(cursor, start));
    pieces.push(<mark className="reader-highlight" key={start}>{match[0]}</mark>);
    cursor = start + match[0].length;
  }
  pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}

function RisuText({text,query}:{text:string;query:string}){
 const value=text;const parts=value.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|“[^”]+”|「[^」]+」)/g);
 return <>{parts.map((part,i)=>part.startsWith('**')?<strong key={i}><Highlight text={part.slice(2,-2)} query={query}/></strong>:/^[*_]/.test(part)&&part.length>2?<em key={i}><Highlight text={part.slice(1,-1)} query={query}/></em>:/^[“「]/.test(part)?<span className="reader-dialogue" key={i}><Highlight text={part} query={query}/></span>:<Highlight key={i} text={part} query={query}/>)}</>;
}
type EditFragment=(fragment:Fragment,text:string)=>void;
const EditNoticeContext=createContext<(message:string)=>void>(()=>{});
const EditOverflowContext=createContext<(fragment:Fragment,text:string,element:HTMLParagraphElement)=>string|undefined>(()=>undefined);
function EditableChunk({text,opening,onInput,onOverflow,editKey}:{text:string;opening:boolean;onInput:(text:string)=>void;onOverflow:(value:string,element:HTMLParagraphElement)=>string|undefined;editKey:string}){
 const ref=useRef<HTMLParagraphElement>(null),accepted=useRef(text),initial=useRef(text),baselineOverflow=useRef(0);
 const notify=useContext(EditNoticeContext);
 useLayoutEffect(()=>{if(ref.current){if(ref.current.innerText!==text)ref.current.textContent=text;accepted.current=text;const content=ref.current.closest<HTMLElement>('.reader-page-content');baselineOverflow.current=content?Math.max(0,content.scrollHeight-content.clientHeight):0;}},[text]);
 const warn=()=>notify('긴 글과 줄바꿈은 고급 수정에서 편집해 주세요.');
 function changed(element:HTMLParagraphElement){
  const value=element.innerText,content=element.closest<HTMLElement>('.reader-page-content');
  if(value.length>initial.current.length+80||value.split('\n').length>initial.current.split('\n').length){
   element.textContent=accepted.current;warn();return;
  }
  if(content&&content.scrollHeight-content.clientHeight>baselineOverflow.current+2){const prefix=onOverflow(value,element);if(prefix!==undefined){accepted.current=prefix;onInput(prefix);return;}element.textContent=accepted.current;warn();return;}
  accepted.current=value;onInput(value);
 }
 return <div className="reader-edit-chunk"><p ref={ref} className={`reader-prose reader-live-passage${opening?' reader-chapter-opening':''}`} role="textbox" data-edit-key={editKey} aria-label="페이지 본문 편집" contentEditable="plaintext-only" suppressContentEditableWarning data-no-flip onBeforeInput={event=>{const native=event.nativeEvent as InputEvent;if(native.inputType==='insertParagraph'||native.inputType==='insertLineBreak'){event.preventDefault();warn();}}} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();warn();}}} onInput={event=>{if(!(event.nativeEvent as InputEvent).isComposing)changed(event.currentTarget);}} onCompositionEnd={event=>changed(event.currentTarget)} onDrop={event=>{event.preventDefault();warn();}} onPaste={event=>{
  event.preventDefault();event.stopPropagation();
  const value=event.clipboardData.getData('text/plain');
  if(value.length>160||/[\r\n]/.test(value)){warn();return;}
  const selection=window.getSelection();if(!selection?.rangeCount)return;
  const range=selection.getRangeAt(0),element=event.currentTarget;
  if(!element.contains(range.startContainer)||!element.contains(range.endContainer))return;
  if(document.execCommand('insertText',false,value))return;
  const node=document.createTextNode(value);range.deleteContents();range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);changed(element);
 }}/></div>;
}
function EditablePassage({fragment,onEdit,draft}:{fragment:Fragment;onEdit:EditFragment;draft?:string}){
 const [value,setValue]=useState(()=>draft??(fragment.chapter!==undefined?fragment.text.trimStart():fragment.text));
 const overflow=useContext(EditOverflowContext);
 useLayoutEffect(()=>{if(draft!==undefined)setValue(draft);},[draft]);
 return <EditableChunk editKey={fragmentKey(fragment)} onOverflow={(text,element)=>overflow(fragment,text,element)} text={value} opening={fragment.chapter!==undefined} onInput={next=>{setValue(next);onEdit(fragment,next);}}/>;
}

type AssetPreview={container:HTMLElement;closing?:boolean;asset:BookAsset;owner:string;pinned:boolean;left:number;top:number;width:number;height:number;size:number};
const displayBookmarkStyle=(style:BookmarkStyle):BookmarkStyle=>style==='character'?'image':style;
function InlineAsset({fragment,editing,onEdit,draft,onPreview}:{fragment:Fragment;editing:boolean;onEdit:EditFragment;draft?:string;onPreview:(asset:BookAsset|null,owner:string,pinned?:boolean)=>void}){
 const asset=fragment.asset!;
 const owner=`${fragment.message}:${fragment.char}`;
 const [removed,setRemoved]=useState(draft==='');
 const [crop,setCrop]=useState<{src:string;width:number;height:number}|null>(null);
 useEffect(()=>{let active=true;void squareAssetCrop(asset.src,fragment.assetSize??300).then(value=>{if(active)setCrop(value);});return()=>{active=false;};},[asset.src,fragment.assetSize]);
 const buttonRef=useRef<HTMLButtonElement>(null);
 const preview=useRef(onPreview);preview.current=onPreview;
 const eligible=()=>!editing&&!buttonRef.current?.closest('[data-flip-copy="true"],[inert],[aria-hidden="true"]');
 useEffect(()=>()=>preview.current(null,owner,true),[owner]);
 useEffect(()=>setRemoved(editing&&draft===''),[editing,draft]);
 return <div className="reader-inline-asset-body" data-no-flip={editing||undefined}>
 {removed?<button type="button" className="reader-inline-asset-undo" onClick={()=>{onEdit(fragment,fragment.text);setRemoved(false);}}>이미지 복원</button>:<>
 <button ref={buttonRef} data-flip-asset={!editing||undefined} data-asset-owner={owner} data-original-width={crop?.width} data-original-height={crop?.height} className="reader-inline-asset-open" type="button" aria-label={`${asset.name} 크게 보기`} onPointerEnter={event=>{if(event.pointerType!=='touch'&&eligible())onPreview(asset,owner);}} onPointerLeave={()=>onPreview(null,owner)} onFocus={()=>{if(eligible())onPreview(asset,owner);}} onBlur={()=>onPreview(null,owner)} onClick={event=>{event.stopPropagation();if(eligible())onPreview(asset,owner,true);}}><img src={crop?.src??asset.src} alt={asset.name} draggable={false}/></button>
 {editing&&<button className="reader-inline-asset-remove" type="button" aria-label="본문 이미지 제거" title="본문에서 이미지 제거" onClick={()=>{onPreview(null,owner,true);onEdit(fragment,'');setRemoved(true);}}><X size={16}/></button>}
 </>}
 </div>;
}
function PageContent({page,query,editing,onEdit,drafts,onPreview}:{page:PaperPage;query:string;editing:boolean;onEdit:EditFragment;drafts:Map<string,string>;onPreview:(asset:BookAsset|null,owner:string,pinned?:boolean)=>void}){
 return <>{page.fragments.filter(fragment=>!fragment.hidden).map(fragment=><section className={`reader-fragment${fragment.asset?' reader-inline-asset':''}`} style={fragment.asset?{width:`${fragment.assetSize??12}px`,height:`${fragment.assetSize??12}px`}:undefined} data-message={fragment.message} data-char={fragment.char} key={`${fragment.message}:${fragment.char}`}>
 {fragment.asset?<InlineAsset fragment={fragment} editing={false} onEdit={onEdit} draft={drafts.get(`${fragment.message}:${fragment.char}`)} onPreview={editing?()=>{}:onPreview}/>:editing?<EditablePassage fragment={fragment} onEdit={onEdit} draft={drafts.get(`${fragment.message}:${fragment.char}`)}/>:<p className={`reader-prose${fragment.chapter!==undefined?' reader-chapter-opening':''}`}><RisuText text={fragment.chapter!==undefined?fragment.text.trimStart():fragment.text} query={query}/></p>}
 </section>)}</>;
}

type BookmarkSlipProps={style:BookmarkStyle;icon?:string;image?:string;title:string;color:string;side?:'before'|'after';disabled?:boolean;onActivate?:()=>void;onRemove?:(source:HTMLElement)=>void;canInteract?:()=>boolean};
function BookmarkSlip({style,icon,image,title,color,side='after',disabled,onActivate,onRemove,canInteract}:BookmarkSlipProps){
 const elementRef=useRef<HTMLSpanElement>(null);
 const actions=useRef({disabled,onActivate,onRemove,canInteract});actions.current={disabled,onActivate,onRemove,canInteract};
 const drag=useRef<{id:number;x:number;y:number;distance:number;bounds:DOMRect;angle:number;pivotX:number;pivotY:number}|null>(null);
 const suppressClick=useRef(false);
 const allowed=()=>{const element=elementRef.current;return !actions.current.disabled&&!!element&&!element.closest('[inert],[data-flip-copy="true"],[aria-hidden="true"]')&&(actions.current.canInteract?.()??true);};
 const reset=()=>{
  const active=drag.current;drag.current=null;
  const element=elementRef.current;if(!element)return;
  element.style.removeProperty('--bookmark-drag-x');element.style.removeProperty('--bookmark-drag-y');element.style.removeProperty('--bookmark-drag-angle');element.style.removeProperty('transform-origin');element.classList.remove('reader-bookmark-dragging');
  if(active)try{if(element.hasPointerCapture(active.id))element.releasePointerCapture(active.id);}catch{}
 };
 const cancel=()=>{if(drag.current)suppressClick.current=true;reset();};
 useEffect(()=>{window.addEventListener('blur',cancel);return()=>{window.removeEventListener('blur',cancel);cancel();};},[]);
 useEffect(()=>{if(disabled)cancel();},[disabled]);
 const move=(event:ReactPointerEvent<HTMLSpanElement>)=>{
  const active=drag.current;if(!active||active.id!==event.pointerId)return;
  event.stopPropagation();event.preventDefault();
  if(!allowed()){cancel();return;}
  sampleBookmarkThrow(event.currentTarget,event.clientX,event.clientY);
  const dx=event.clientX-active.x,dy=event.clientY-active.y;
  active.distance=Math.max(active.distance,Math.hypot(dx,dy));
  if(active.distance>5){suppressClick.current=true;event.currentTarget.classList.add('reader-bookmark-dragging');}
  const torque=(active.pivotX-.5)*dy-(active.pivotY-.5)*dx;
  const direction=Math.abs(torque)>.1?Math.sign(torque):Math.sign(active.angle)||1;
  const tilt=direction*Math.min(58,Math.max(0,Math.hypot(dx,dy)-5)*.2);
  active.angle+=(tilt-active.angle)*.35;
  event.currentTarget.style.setProperty('--bookmark-drag-angle',`${active.angle}deg`);
  event.currentTarget.style.setProperty('--bookmark-drag-x',`${dx}px`);event.currentTarget.style.setProperty('--bookmark-drag-y',`${dy}px`);
 };
 return <span ref={elementRef} data-no-flip data-bookmark-side={side} className={`reader-bookmark-slip reader-bookmark-${style}`} role="button" tabIndex={disabled?-1:0} aria-disabled={disabled||undefined} aria-label="책갈피로 이동" title={onRemove?'책갈피로 이동 · 끌어서 제거':'책갈피로 이동'} style={{'--bookmark-color':color} as CSSProperties}
 onPointerDown={event=>{event.stopPropagation();if(!actions.current.onRemove||!allowed()||!event.isPrimary||event.button!==0||drag.current)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});suppressClick.current=false;const bounds=event.currentTarget.getBoundingClientRect();const pivotX=event.clientX-bounds.left<bounds.width/2?.25:.75,pivotY=event.clientY-bounds.top<bounds.height/2?.25:.75;event.currentTarget.style.transformOrigin=`${pivotX*100}% ${pivotY*100}%`;sampleBookmarkThrow(event.currentTarget,event.clientX,event.clientY,true);drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,distance:0,bounds,angle:0,pivotX,pivotY};try{event.currentTarget.setPointerCapture(event.pointerId);}catch{cancel();}}}
 onPointerMove={move}
 onPointerUp={event=>{event.stopPropagation();const active=drag.current;if(!active||active.id!==event.pointerId)return;move(event);if(drag.current!==active)return;const eligible=allowed();const distance=active.distance;suppressClick.current=true;if(!eligible){reset();return;}const safe=event.clientX>=active.bounds.left-40&&event.clientX<=active.bounds.right+40&&event.clientY>=active.bounds.top-40&&event.clientY<=active.bounds.bottom+40;if(distance>=36&&!safe){drag.current=null;try{if(event.currentTarget.hasPointerCapture(active.id))event.currentTarget.releasePointerCapture(active.id);}catch{}actions.current.onRemove?.(event.currentTarget);reset();}else{reset();if(distance<=5)actions.current.onActivate?.();}}}
 onPointerCancel={event=>{event.stopPropagation();if(drag.current?.id===event.pointerId)cancel();}}
 onLostPointerCapture={event=>{if(drag.current?.id===event.pointerId)cancel();}}
 onClick={event=>{event.stopPropagation();event.preventDefault();if(suppressClick.current){suppressClick.current=false;return;}if(allowed())actions.current.onActivate?.();}}
 onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.stopPropagation();event.preventDefault();if(!event.repeat&&allowed())actions.current.onActivate?.();}}}
 onDragStart={event=>event.preventDefault()}>
 {(style==='image'||style==='character')&&(image||icon)&&<AssetImage className="reader-bookmark-image-fill" src={(image||icon)!} alt=""/>}<span className="reader-bookmark-punch"/><span className="reader-bookmark-string"/>{(style==='image'||style==='character')&&<BookmarkTitle className="reader-bookmark-title" title={cleanText(title).replace(/\s*·\s*\d+권\s*$/,'')}/>}
 </span>;
}

function PageLeaf({page,book,query,index,onNext,onClose,mobile,editing,onEdit,drafts,onPreview,bookmark}:{page:PaperPage;book:Book;query:string;index:number;onNext?:()=>void;onClose:()=>void;mobile:boolean;editing:boolean;onEdit:EditFragment;drafts:Map<string,string>;onPreview:(asset:BookAsset|null,owner:string,pinned?:boolean)=>void;bookmark?:BookmarkSlipProps}) {
 const showChapter=page.chapter!==undefined;
 const chapterTitle=chapterLabel(page.chapter??1,page.chapterTitle);
 const coverTitle=cleanText(book.title).replace(/\s*·\s*\d+권\s*$/,'');
 const date=(value:string)=>{const parsed=new Date(value);return Number.isNaN(parsed.getTime())?'—':parsed.toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'});};
 const action=<button className="reader-end-action" data-no-flip disabled={editing} onClick={onNext??onClose}>{onNext?'다음 권 읽기':'서재로'}<ArrowRight size={18}/></button>;
 if(page.kind==='front-cover')return <div className="reader-front-cover"><BookCover book={book} fit/></div>;
 if(page.kind==='colophon')return <div className="reader-paper-shell reader-colophon" style={{'--book-cover':book.color} as CSSProperties}>{bookmark&&<BookmarkSlip {...bookmark}/>}<section className="reader-colophon-details"><dl><div><dt>업로드일</dt><dd>{date(book.uploadedAt??book.createdAt)}</dd></div><div><dt>수정일</dt><dd>{date(book.updatedAt)}</dd></div><div><dt>저자</dt><dd>{bookAuthor(book)}</dd></div></dl><h2>{coverTitle}</h2></section></div>;
 if(page.kind==='back-cover')return <div className="reader-back-cover reader-true-back" style={{'--book-cover':book.color} as CSSProperties}><div className="reader-back-imprint"><span className="reader-back-colophon">{cleanText(bookAuthor(book))}</span><span className="reader-back-mark">{cleanText(book.title).replace(/\s*·\s*\d+권\s*$/,'')}</span><span className="reader-back-volume">{book.volumeNumber?String(book.volumeNumber).padStart(2,'0'):''}</span><BackBarcode/>{mobile&&action}</div></div>;
 if(page.kind==='front-endpaper')return <div className="reader-front-outside"/>;
 if(page.kind==='end')return <div className="reader-end-half">{action}</div>;
 if(page.kind==='padding'||page.kind==='endpaper'||page.kind==='opening-endpaper')return <div className={`reader-paper-shell${page.kind!=='padding'?' reader-endpaper':''}`}>{bookmark&&<BookmarkSlip {...bookmark}/>}</div>;
 return <div className="reader-paper-shell">{bookmark&&<BookmarkSlip {...bookmark}/>} {showChapter&&<div className="reader-chapter-heading">{chapterTitle}</div>}<div className={`reader-page-content${showChapter?' reader-page-chapter-content':''}${editing?' reader-page-content-editing':''}`}><PageContent page={page} query={query} editing={editing} onEdit={onEdit} drafts={drafts} onPreview={onPreview}/></div><div className="reader-page-number">{page.pageNumber??index+1}</div></div>;
}

function LeaveDialog({moving,busy,error,onCancel,onLeave,onSave}:{moving:boolean;busy:boolean;error:string;onCancel:()=>void;onLeave:()=>void;onSave:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 return <dialog ref={dialog} className="reader-next-dialog reader-leave-dialog" aria-label="책갈피 확인" onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}><h2>{moving?'책갈피를 옮길까요?':'책갈피를 넣을까요?'}</h2>{error&&<p role="alert">{error}</p>}<div><button disabled={busy} onClick={onCancel}>계속 읽기</button><button disabled={busy} onClick={onLeave}>그냥 나가기</button><button disabled={busy} onClick={onSave}>{busy?'저장 중…':moving?'옮기고 나가기':'꽂고 나가기'}</button></div></dialog>;
}

function NextVolumeDialog({title,onConfirm,onClose}:{title?:string;onConfirm:()=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="reader-next-dialog" aria-label="다음 권 읽기" onCancel={e=>{e.preventDefault();onClose();}}><h2>다음 권을 읽을까요?</h2><p>{title}</p><div><button autoFocus onClick={onClose}>취소</button><button onClick={onConfirm}>읽기<ArrowRight size={17}/></button></div></dialog>;
}

export function Reader({ book, dataPending=false, onClose, onReady, onOpenError, initialBookmark, onNextVolume, nextVolumeTitle, onSaveBook, onShare, selectingQuote=false, onQuoteSelected, shelfBookmark, onBookmarkChange, onBookmarkStyleChange, bookmarkStyle, characterIcon, bookmarkImage }: ReaderProps) {
  const [editing,setEditing]=useState(false);
  const [editPrompt,setEditPrompt]=useState(()=>normalizeDisplayPrompt(book.displayPrompt));
  const [advancedEditing,setAdvancedEditing]=useState(false);
  const {toast:editToast,notify:notifyEdit,dismiss:dismissEdit}=useToast();
  const [assetPreview,setAssetPreview]=useState<AssetPreview|null>(null);
  const assetPreviewRef=useRef(assetPreview);assetPreviewRef.current=assetPreview;
  const hoverSuppressedRef=useRef(new Set<string>());
  const previewAsset=(asset:BookAsset|null,owner:string,pinned=false)=>setAssetPreview(current=>{
    if(flipRef.current&&flipRef.current.getState()!=='read')return current;
    if(!asset){hoverSuppressedRef.current.delete(owner);return current?.owner===owner&&(!current.pinned||pinned)?null:current;}
    if(!pinned&&hoverSuppressedRef.current.has(owner))return current;
    if(current?.pinned&&!pinned)return current;
    if(current?.owner===owner&&current.pinned&&pinned){hoverSuppressedRef.current.add(owner);return null;}
    const element=readerRef.current?.querySelector<HTMLButtonElement>(`[data-asset-owner="${owner}"]`);
    if(!element)return null;
    const rect=element.getBoundingClientRect(),image=element.querySelector('img');
    const originalWidth=Number(element.dataset.originalWidth)||image?.naturalWidth||1;
    const originalHeight=Number(element.dataset.originalHeight)||image?.naturalHeight||1;
    const ratio=originalHeight/originalWidth;
    let width=ratio>=1?rect.width:rect.height/ratio,height=width*ratio;
    const fit=Math.min(1,(window.innerWidth-24)/width,(window.innerHeight-24)/height);width*=fit;height*=fit;
    const scale=rect.width/Math.max(1,element.offsetWidth);
    width/=scale;height/=scale;
    return {container:element.parentElement!,asset,owner,pinned,left:(element.offsetWidth-width)/2,top:0,width,height,size:element.offsetHeight};
  });
  const [saving,setSaving]=useState(false);
  const [editError,setEditError]=useState('');
  const [bookmarkToast,setBookmarkToast]=useState('');
  const [leafRevision,setLeafRevision]=useState(0);
  const draftsRef=useRef(new Map<string,string>());
  const editingSourceRef=useRef<Book|null>(null);
  const editBookmarkRef=useRef<Anchor|null>(null);
  const [viewport, setViewport] = useState(readReaderViewport);
  const device=classifyReaderViewport(viewport);
  const [windowPreference,setFullscreen]=useState(readFullwindowPreference);
  const fullscreen=device==='phone'||windowPreference;
  const previousDevice=useRef(device);
  useEffect(()=>{if(previousDevice.current!==device){previousDevice.current=device;setFullscreen(readFullwindowPreference());return;}if(device==='phone')return;try{window.localStorage.setItem(device==='fold'?FOLD_FULLWINDOW_KEY:FULLWINDOW_KEY,String(windowPreference));}catch{}},[device,windowPreference]);
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [drawerClosing,setDrawerClosing]=useState(false);
  useEffect(()=>{if(!drawerClosing)return;const timer=setTimeout(()=>setDrawerClosing(false),240);return()=>clearTimeout(timer);},[drawerClosing]);
  const zoomAnimation=useRef<Animation|null>(null);
  useEffect(()=>()=>zoomAnimation.current?.cancel(),[]);
  const [windowEntering,setWindowEntering]=useState(false);
  useEffect(()=>{if(!windowEntering)return;const timer=setTimeout(()=>setWindowEntering(false),240);return()=>clearTimeout(timer);},[windowEntering]);
  const drawerRef=useRef(false);drawerRef.current=drawerOpen;
  const drawerHandleRef=useRef<HTMLButtonElement>(null);
  const windowModeButtonRef=useRef<HTMLButtonElement>(null);
  const drawerDrag=useRef<{id:number;x:number;y:number;opened:boolean}|null>(null);
  const suppressHandleClick=useRef(false);
  const fullscreenRef=useRef(false);fullscreenRef.current=fullscreen;
  const readerRef=useRef<HTMLDivElement>(null);
  const [selectedLeaf,setSelectedLeaf]=useState<number|null>(null);
  const [selectedBookmarkStyle, setSelectedBookmarkStyle] = useState<BookmarkStyle>(displayBookmarkStyle(shelfBookmark ? shelfBookmark.style ?? 'normal' : bookmarkStyle ?? book.bookmarkStyle ?? 'normal'));
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const bookmarkBusyRef = useRef(false);
  const bookmarkMotionRef = useRef<BookmarkMotion|null>(null);
  const reinsertBookmarkRef = useRef<()=>void>(()=>{});
  useEffect(()=>{
    const motion=new BookmarkMotion(()=>readerRef.current,()=>reinsertBookmarkRef.current());
    bookmarkMotionRef.current=motion;
    return()=>{motion.dispose();bookmarkMotionRef.current=null;};
  },[book.id]);
  const [leaveConfirm,setLeaveConfirm]=useState(false);
  const [leaveError,setLeaveError]=useState('');
  const requestCloseRef=useRef<()=>void>(()=>{});
  const initialBookmarkRef=useRef(initialBookmark);initialBookmarkRef.current=initialBookmark;
  const navigationRevisionRef = useRef(0);
  const pagesReadyRef = useRef(false);
  const renderLeafRef=useRef<(page:PaperPage,index:number,mobile:boolean)=>ReactNode>(()=>null);
  const [nextConfirm,setNextConfirm]=useState(false);
  const blockedRef=useRef(false);blockedRef.current=advancedEditing||editing||nextConfirm||leaveConfirm||bookmarkBusy;
  const requestNextRef=useRef(()=>{});requestNextRef.current=()=>setNextConfirm(true);
  const [initialPreferences] = useState(readReaderPreferences);
  const [theme, setTheme] = useState<Theme>(initialPreferences.theme);
  const [fontSize, setFontSize] = useState(initialPreferences.fontSize);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState<PaperPage[]>([]);
  const [contentCount,setContentCount]=useState(0);
  const frontRequestedRef=useRef(false);
  const [spread, setSpread] = useState(1);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const pageGeometry=useMemo(()=>{
    const count = readerPageCount(dimensions.width, viewport);
    const height = Math.max(100, device==='phone'?dimensions.height:fullscreen?dimensions.height-10:Math.min(790, dimensions.height - Math.min(56, dimensions.height * .12)));
    // Editing reuses this pagination and only scales its presentation for rails.
    const sideSpace=device==='phone'?0:fullscreen?10:16;
    const availablePageWidth=Math.max(1,(dimensions.width-sideSpace)/count);
    // A 120px lower bound could overflow the reserved rails on a narrow
    // window. The actual stage width must always win over a preferred minimum.
    const width = Math.max(1, device==='phone'?availablePageWidth:fullscreen?Math.min(availablePageWidth,height*MAX_FULLWINDOW_PAGE_RATIO):Math.min(540,Math.floor(availablePageWidth)));
    const padding = width < 350 ? 22 : width < 440 ? 32 : 46;
    const {top:contentTop,bottom:contentBottom} = pageTextInsets(height,fontSize);
    return {count,height,width,padding,contentTop,contentBottom};
  },[dimensions,viewport,device,fullscreen,fontSize]);
  const [loading, setLoading] = useState(true);
  const openedRef=useRef(false);
  const openErrorRef=useRef(onOpenError);openErrorRef.current=onOpenError;
  useEffect(()=>{if(!loading&&pagesReadyRef.current){openedRef.current=true;onReady?.();}},[loading,onReady]);
  const [error, setError] = useState('');
  const [openRevision,setOpenRevision]=useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const rootsRef = useRef<Root[]>([]);
  const mountedPagesRef = useRef(new Map<number, { root: Root; element: HTMLElement }>());
  const renderWindowRef = useRef<(index:number,keepIndex?:number)=>void>(()=>{});
  const queryRef = useRef(deferredQuery);
  const nextVolumeRef = useRef(onNextVolume);
  const queuedTurnRef=useRef<'previous'|'next'|null>(null);
  const activeMessagesRef=useRef<Book['messages']|null>(null);
  const pagesRef = useRef<PaperPage[]>([]);
  const anchorRef = useRef<Anchor | null>(null);
  const activeBookRef = useRef<string | null>(null);
  const closeRef = useRef(onClose);
  const bookRef = useRef(book);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelButtonRefs = useRef<Partial<Record<Exclude<Panel, null>, HTMLButtonElement | null>>>({});
  closeRef.current = onClose;
  bookRef.current = book;
  queryRef.current = deferredQuery;
  nextVolumeRef.current=onNextVolume;
  // Stable content dependencies prevent a parent's progress update rebuilding the book.
  const contentKey = useMemo(() => ({ title: book.title, author: book.author, messages: book.messages,assets:book.assets,imageRules:book.imageRules,displayRules:book.displayRules,displayPrompt:book.displayPrompt }),
    [book.title, book.author, book.messages,book.assets,book.imageRules,book.displayRules,book.displayPrompt]);

  useEffect(() => {
    const pointer = window.matchMedia('(pointer: coarse)');
    const segments = window.matchMedia('(horizontal-viewport-segments: 2)');
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (blockedRef.current) return;
        const next = readReaderViewport();
        setViewport(previous => previous.width === next.width && previous.height === next.height &&
          previous.touch === next.touch && previous.horizontalSegments === next.horizontalSegments ? previous : next);
      });
    };
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    pointer.addEventListener('change', refresh);
    segments.addEventListener('change', refresh);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      pointer.removeEventListener('change', refresh);
      segments.removeEventListener('change', refresh);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ theme, fontSize }));
    } catch {
      // Reading controls remain usable when browser storage is unavailable.
    }
  }, [theme, fontSize]);

  useEffect(()=>{const sync=(event:Event)=>{const value=(event as CustomEvent<Theme>).detail;setTheme(value==='paper'||value==='warm'||value==='dark'?value:readTheme());};window.addEventListener(THEME_EVENT,sync);return()=>window.removeEventListener(THEME_EVENT,sync);},[]);

  const chapterEntries=useMemo(()=>{
    if(book.displayPrompt?.id==='soakma'){
      const entries=pages.flatMap(page=>page.chapter!==undefined&&page.chapterMessage!==undefined?[{message:{...book.messages[page.chapterMessage],chapterTitle:page.chapterTitle},index:page.chapterMessage,char:page.fragments.find(fragment=>!fragment.hidden)?.char??0,number:page.chapter}]:[]);
      if(entries.length)return entries;
    }
    let number=0;return book.messages.flatMap((message,index)=>startsChapter(book,index)?[{message,index,char:0,number:++number}]:[]);
  },[book.messages,book.displayPrompt,pages]);

  const hits = useMemo(() => {
    const results: SearchHit[] = [];
    if (!deferredQuery) return results;
    const pattern = new RegExp(escapeRegExp(deferredQuery), 'giu');
    for (let message = 0; message < book.messages.length; message++) {
      const entry = book.messages[message];
      if(hiddenUserInput(entry))continue;
      const images=imageReferenceRanges(entry.content);const hidden=[...displayHiddenRanges(entry.content,book.displayPrompt,images),...images];
      for (const match of entry.content.matchAll(pattern)) {
        const char = match.index ?? 0;
        if(hidden.some(range=>char<range.end&&char+match[0].length>range.start))continue;
        const before=visibleSlice(entry.content,0,char,book.displayPrompt),after=visibleSlice(entry.content,char+match[0].length,entry.content.length,book.displayPrompt);
        const chapter=[...chapterEntries].reverse().find(entry=>entry.index<message||entry.index===message&&entry.char<=char)?.number??chapterNumber(book,message);
        results.push({ message, char, length: match[0].length, name: `CHAPTER ${String(chapter).padStart(2,'0')}`,
          excerpt: `${before.length>35?'…':''}${before.slice(-35)}${match[0]}${after.slice(0,80)}${after.length>80?'…':''}` });
        if (results.length >= 200) return results;
      }
    }
    return results;
  }, [contentKey, deferredQuery,chapterEntries]);

  useEffect(() => {
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[]);

  // Mode CSS changes the stage immediately. Measure before paint so the first
  // skeleton frame already has destination geometry instead of the old size.
  useLayoutEffect(()=>{
    const stage=stageRef.current;if(!stage)return;
    const next={width:Math.floor(stage.clientWidth),height:Math.floor(stage.clientHeight)};
    setDimensions(previous=>previous.width===next.width&&previous.height===next.height?previous:next);
  },[fullscreen,device,book.title]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if(blockedRef.current)return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if(blockedRef.current)return;
        setDimensions(previous => {
        const next = { width: Math.floor(width), height: Math.floor(height) };
        return next.width === previous.width && next.height === previous.height ? previous : next;
        });
      });
    });
    observer.observe(stage);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  // Font loading can change wrapping independently of the viewport.
  const [fontRevision, setFontRevision] = useState(0);
  const [fontsReady,setFontsReady]=useState(false);
  useEffect(() => {
    let alive = true;
    const finishFontNetwork=document.fonts.status==='loading'?beginSkeletonTask('network'):()=>{};
    let signature='';
    const refresh = () => {
      finishFontNetwork();if(!alive||blockedRef.current)return;
      // Ignore duplicate ready/loadingdone events and unrelated UI fonts.
      const context=document.createElement('canvas').getContext('2d');
      const sample='가나다라마바사아자차카타파하 한글 이야기 ABCDEFG abcdefg 0123456789';
      const next=['400 18px "Gowun Batang"','700 18px "Gowun Batang"'].map(font=>{if(!context)return font;context.font=font;return context.measureText(sample).width;}).join(':');
      setFontsReady(true);
      if(next!==signature){signature=next;setFontRevision(value=>value+1);}
    };
    // A cold or unavailable remote font must not block opening indefinitely.
    const timeout=window.setTimeout(()=>{if(alive)setFontsReady(true);},1500);
    void Promise.allSettled([document.fonts.load('18px "Gowun Batang"','한글 이야기'),document.fonts.load('700 18px "Gowun Batang"','한글 이야기')]).then(()=>document.fonts.ready).then(()=>{clearTimeout(timeout);refresh();},()=>{finishFontNetwork();clearTimeout(timeout);if(alive)setFontsReady(true);});
    document.fonts.addEventListener('loadingdone', refresh);
    return () => { alive = false;finishFontNetwork();clearTimeout(timeout); document.fonts.removeEventListener('loadingdone', refresh); };
  }, []);

  useEffect(() => {
    if (dataPending || !fontsReady || !dimensions.width || !dimensions.height) return;
    let cancelled = false;
    let instance: PageFlip | null = null;
    let pageRoots: Root[] = [];
    let host: HTMLDivElement | null = null;
    let queuedFrame=0;
    pagesReadyRef.current=false;
    const finishCalculation=beginSkeletonTask('pagination');
    setLoading(true);
    setError('');
    // Let the committed skeleton paint before synchronous pagination blocks JS.
    let calculationFrame=0;
    const frame = requestAnimationFrame(() => {calculationFrame=requestAnimationFrame(async() => {
      if (cancelled || !mountRef.current || !measureRef.current) return;
      try {
      const currentBook = bookRef.current;
      if (activeBookRef.current !== currentBook.id || activeMessagesRef.current!==currentBook.messages) {
        anchorRef.current = null;frontRequestedRef.current=false;
        activeBookRef.current = currentBook.id;
        activeMessagesRef.current=currentBook.messages;
      }
      const {count,height,width,padding,contentTop,contentBottom}=pageGeometry;
      const measure = measureRef.current;
      measure.style.width = `${width - padding * 2}px`;
      measure.style.height = `${Math.max(1,height - contentTop - contentBottom)}px`;
      measure.style.fontSize = `${fontSize}px`;
      measure.style.setProperty('--paper-height',`${height}px`);
      const imageReferences=await resolveDisplayImageReferences(currentBook);
      if(cancelled)return;
      const body=paginate({...currentBook,imageReferences}, measure,{pageHeight:height,contentTop});
      body.forEach((page,index)=>{page.pageNumber=index+1;});
      let bodyCount=body.length;
      const prefix:PaperPage[]=device==='phone'?[]:count===2?[{fragments:[],intro:false,kind:'front-endpaper'},{fragments:[],intro:false,kind:'front-cover'}]:[{fragments:[],intro:false,kind:'front-cover'}];
      if(device!=='phone')prefix.push({fragments:[],intro:false,kind:'opening-endpaper'},{fragments:[],intro:false,kind:'opening-endpaper'});
      const assemblePages=(content:PaperPage[]):PaperPage[]=>{
        if(device==='phone')return [...content,{fragments:[],intro:false,kind:'colophon'},{fragments:[],intro:false,kind:'end'}];
        const result:PaperPage[]=[...prefix,...content,{fragments:[],intro:false,kind:'endpaper'}];
        if(count===2&&result.length%2)result.push({fragments:[],intro:false,kind:'endpaper'});
        result[result.length-1]!.kind='colophon';
        result.push({fragments:[],intro:false,kind:'back-cover'});
        if(count===2)result.push({fragments:[],intro:false,kind:'end'});
        return result;
      };
      const nextPages=assemblePages(body);
      pagesRef.current = nextPages;
      const target = frontRequestedRef.current?0:anchorRef.current ? pageForAnchor(nextPages, anchorRef.current)
        : initialBookmarkRef.current ? bookmarkPage(nextPages,initialBookmarkRef.current,device==='phone') : prefix.length;
      host = document.createElement('div');
      host.className = 'reader-flip-host';
      host.style.width = `${width * count}px`;
      host.style.height = `${height}px`;
      host.style.setProperty('--reader-page-padding', `${padding}px`);
      host.style.setProperty('--reader-font-size', `${fontSize}px`);
      host.style.setProperty('--reader-content-top', `${contentTop}px`);
      host.style.setProperty('--reader-content-bottom', `${contentBottom}px`);
      host.style.setProperty('--paper-width',`${width}px`);host.style.setProperty('--paper-height',`${height}px`);host.dataset.flipState='read';
      stageRef.current?.style.setProperty('--reader-edit-scale',String(Math.min(1,Math.max(.5,(dimensions.width-88)/(width*count)))));
      mountRef.current.append(host);
      const makeNode = (page:PaperPage,index:number) => {
        const element = document.createElement('div');
        element.className = `reader-page ${index % 2 === 0 ? 'reader-page-left' : 'reader-page-right'}`;
        element.dataset.pageKind=page.kind??'paper';
        element.dataset.readerPageIndex=String(index);
        const coverFace=device==='phone'?undefined:page.kind==='front-cover'||page.kind==='opening-endpaper'&&index===(count===2?2:1)?'front':page.kind==='back-cover'||page.kind==='colophon'?'back':undefined;
        if(coverFace)element.dataset.coverFace=coverFace;
        element.setAttribute('data-density', coverFace?'hard':'soft');
        element.setAttribute('role', 'article');
        element.setAttribute('aria-label', page.pageNumber?`${page.pageNumber}쪽`:page.kind==='front-cover'?'앞표지':page.kind==='back-cover'?'뒷표지':page.kind==='colophon'?'책 정보':'속표지');
        element.setAttribute('lang', 'ko');
        host!.append(element);
        return element;
      };
      const nodes:HTMLElement[]=nextPages.map(makeNode);
      const mounted=new Map<number,{root:Root;element:HTMLElement}>();
      mountedPagesRef.current=mounted;
      const renderWindow=(index:number,keepIndex?:number)=>{
        const first=Math.max(0,index-3),last=Math.min(nextPages.length-1,index+5);
        const wanted=new Set<number>();
        for(let number=first;number<=last;number++)wanted.add(number);
        if(keepIndex!==undefined)for(let number=Math.max(0,keepIndex-3);number<=Math.min(nextPages.length-1,keepIndex+5);number++)wanted.add(number);
        flushSync(()=>{
          for(const number of wanted){
            let entry=mounted.get(number);
            if(!entry){entry={root:createRoot(nodes[number]),element:nodes[number]};mounted.set(number,entry);
              entry.root.render(renderLeafRef.current(nextPages[number],number,count===1));
            }
          }
        });
        // Commit the destination before discarding the previous spread.
        for(const [number,entry] of mounted){if(!wanted.has(number)){entry.root.unmount();mounted.delete(number);}}
      };
      renderWindowRef.current=renderWindow;
      renderWindow(target);
      rootsRef.current = pageRoots;
      const report = (index: number, saveAnchor = true) => {
        const safe = clamp(index, 0, nextPages.length - 1);
        setPageIndex(safe);
        setSelectedLeaf(null);
        renderWindow(safe);
        if(saveAnchor){frontRequestedRef.current=safe<prefix.length;anchorRef.current=frontRequestedRef.current?null:nextPages[safe].fragments[0]??body[bodyCount-1]?.fragments[0]??null;}

      };
      try {
        instance = new PageFlip(host, {
          width, height, size: SizeType.FIXED, minWidth: width, maxWidth: width,
          minHeight: height, maxHeight: height, startPage: target,
          usePortrait: count === 1, autoSize: false, showCover: false,
          drawShadow: true, maxShadowOpacity: 0.18, flippingTime: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 360,
          mobileScrollSupport: true, swipeDistance: 30, useMouseEvents: true,
          clickEventForward: true, showPageCorners: false, disableFlipByClick: false,
        });
        // Update only this reader after the curl settles; no persisted reading history.
        instance.on('flip', event => { if (!cancelled) report(Number(event.data)); });
        instance.on('changeState',event=>{
          if(!cancelled){if(host)host.dataset.flipState=String(event.data);if(event.data!=='read')setAssetPreview(current=>current&&!current.closing?{...current,closing:true}:current);}
          if(event.data==='read'&&queuedTurnRef.current){
            const direction=queuedTurnRef.current;queuedTurnRef.current=null;
            const revision=navigationRevisionRef.current;
            queuedFrame=requestAnimationFrame(()=>{if(!cancelled&&revision===navigationRevisionRef.current)turnRef.current(direction);});
          }
        });
        instance.on('init',()=>{
          if(cancelled)return;
          // The engine's deferred layout update must finish before revealing prose.
          setPages(nextPages);setContentCount(bodyCount);setSpread(count);
          pagesReadyRef.current=true;setLoading(false);finishCalculation();
        });
        instance.loadFromHTML(nodes);
        flipRef.current = instance;
        instance.setInteractionEnabled(!blockedRef.current&&!drawerRef.current);
        report(instance.getCurrentPageIndex(), !anchorRef.current);
      } catch {
        // A partially initialized engine has already hidden its pages. It is
        // not a readable fallback and must never signal successful opening.
        throw new Error('Reader initialization failed');
      }
      } catch {
        if(cancelled)return;
        const message='책 화면을 준비하지 못했어요. 다시 시도해 주세요.';
        setError(message);setLoading(false);
        if(!openedRef.current)openErrorRef.current?.(message);
      } finally {finishCalculation();}
    });});
    return () => {
      cancelled = true;finishCalculation();
      pagesReadyRef.current=false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(calculationFrame);
      cancelAnimationFrame(queuedFrame);
      queuedTurnRef.current=null;
      flipRef.current = null;
      // PageFlip removes its host; React owns only the content inside each page.
      rootsRef.current = [];
      const mounted=mountedPagesRef.current;
      mountedPagesRef.current=new Map();
      renderWindowRef.current=()=>{};
      // Defer nested React root disposal until this component's effect cleanup ends.
      queueMicrotask(() => {
        pageRoots.forEach(root => root.unmount());
        mounted.forEach(entry=>entry.root.unmount());
        mounted.clear();
        instance?.destroy();
        host?.remove();
      });
    };
  }, [book.id, contentKey, dimensions.width, dimensions.height, fontSize, fontRevision,fontsReady,fullscreen,viewport,openRevision,dataPending]);

  // Highlighting does not repaginate: marks have exactly the same font metrics.
  useEffect(() => {
    const currentBook = bookRef.current;
    mountedPagesRef.current.forEach(({root}, index) => {
      const page = pagesRef.current[index];
      if (!page) return;
      root.render(renderLeafRef.current(page,index,spread===1));
    });
  }, [deferredQuery,pages,editing,leafRevision,shelfBookmark,bookmarkImage,characterIcon,bookmarkBusy,saving,book.bookmarks,book.color,selectedLeaf,pageIndex,selectingQuote]);

  const jump = (page: number) => {
    if(saving||nextConfirm||leaveConfirm||!pagesReadyRef.current||!pagesRef.current.length)return;
    navigationRevisionRef.current++;
    queuedTurnRef.current=null;
    flipRef.current?.cancelUserTouch();
    const safe = clamp(page, 0, Math.max(0, pagesRef.current.length - 1));
    anchorRef.current = pagesRef.current[safe]?.fragments[0] ?? null;
    renderWindowRef.current(safe);
    const flip=flipRef.current;
    if(flip){
      flip.turnToPage(safe);
      const visible=clamp(flip.getCurrentPageIndex(),0,pagesRef.current.length-1);
      renderWindowRef.current(visible);setPageIndex(visible);setSelectedLeaf(null);
      anchorRef.current=pagesRef.current[visible]?.fragments[0]??anchorRef.current;
    }
    if (error) mountRef.current?.querySelectorAll('.reader-page')[safe]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const goToAnchor = (anchor: Anchor) => {
    jump(pageForAnchor(pagesRef.current, anchor));
    anchorRef.current = anchor;
    setPanel(null);
  };
  const turn = (direction: 'previous' | 'next') => {
    const flip = flipRef.current;
    if (!flip||blockedRef.current||selectingQuote||!pagesReadyRef.current) return;
    // Release a held curl so keyboard and wheel input cannot stay queued forever.
    if(flip.getState()==='user_fold'){
      // Settling may synchronously emit 'read'; enqueue before releasing the gesture.
      queuedTurnRef.current=direction;
      flip.settleUserTouch();
      if(flip.getState()==='read'&&queuedTurnRef.current){queuedTurnRef.current=null;turnRef.current(direction);}
      return;
    }
    if(flip.getState()==='flipping'){queuedTurnRef.current=direction;return;}
    if(direction==='next'&&flip.getCurrentPageIndex()+spread>=pagesRef.current.length&&nextVolumeRef.current){requestNextRef.current();return;}
    if (direction === 'previous') flip.flipPrev(FlipCorner.BOTTOM);
    else flip.flipNext(FlipCorner.BOTTOM);
  };
  const turnRef = useRef(turn);
  const jumpRef = useRef(jump);
  turnRef.current = turn;
  jumpRef.current = jump;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if(event.key==='Escape'&&assetPreviewRef.current){event.preventDefault();setAssetPreview(null);return;}
      if(blockedRef.current)return;
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        if (panel) { setPanel(null); panelButtonRefs.current[panel]?.focus(); }
        else if(drawerRef.current){closeDrawer();}
        else if(fullscreenRef.current){setDrawerClosing(false);setDrawerOpen(true);}
        else requestCloseRef.current();
        return;
      }
      if(drawerRef.current)return;
      const field=target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if ((field && !field.matches('input[type="range"].reader-progress')) || event.ctrlKey || event.metaKey || event.altKey || panel) return;
      if(event.key===' '&&target?.closest('button, a, input'))return;
      if (['ArrowRight', 'PageDown', ' ', 'ArrowLeft', 'PageUp', 'Home', 'End'].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) turnRef.current('next');
      if (event.key === 'ArrowLeft' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) turnRef.current('previous');
      if (event.key === 'Home') jumpRef.current(0);
      if (event.key === 'End') jumpRef.current(pagesRef.current.length - 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [panel]);

  useEffect(()=>{
    const stage=stageRef.current;if(!stage)return;
    let accumulated=0,last=-Infinity,lastInput=0;
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey||blockedRef.current||panel||drawerRef.current){accumulated=0;return;}
      event.preventDefault();
      const now=performance.now();
      if(now-lastInput>180)accumulated=0;
      lastInput=now;
      if(now-last<450){accumulated=0;return;}
      const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
      const amount=delta*(event.deltaMode===1?16:event.deltaMode===2?stage.clientHeight:1);
      if(Math.sign(amount)!==Math.sign(accumulated))accumulated=0;
      accumulated+=amount;
      if(Math.abs(accumulated)>=40){turnRef.current(accumulated>0?'next':'previous');last=performance.now();accumulated=0;}
    };
    stage.addEventListener('wheel',wheel,{passive:false});
    return()=>stage.removeEventListener('wheel',wheel);
  },[panel]);

  useEffect(() => {
    if (panel === 'search') searchRef.current?.focus();
    else if (panel) panelRef.current?.focus();
  }, [panel]);

  function closeDrawer(){setDrawerClosing(!matchMedia('(prefers-reduced-motion: reduce)').matches);setWindowEntering(false);setPanel(null);setDrawerOpen(false);requestAnimationFrame(()=>drawerHandleRef.current?.focus({preventScroll:true}));}
  function transitionFullwindow(next:boolean){
    const stage=stageRef.current, before=stage?.getBoundingClientRect();
    const oldWidth=pageGeometry.width*pageGeometry.count,oldHeight=pageGeometry.height;
    zoomAnimation.current?.cancel();setDrawerClosing(false);
    flushSync(()=>{setWindowEntering(next&&!matchMedia('(prefers-reduced-motion: reduce)').matches);setLoading(true);setFullscreen(next);setDrawerOpen(false);setPanel(null);});
    if(stage&&before&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const after=stage.getBoundingClientRect(),style=getComputedStyle(readerRef.current!);
      const width=parseFloat(style.getPropertyValue('--reader-book-width')),height=parseFloat(style.getPropertyValue('--paper-height'));
      if(width>0&&height>0)zoomAnimation.current=stage.animate([
        {transform:`translate(${before.x+before.width/2-after.x-after.width/2}px,${before.y+before.height/2-after.y-after.height/2}px) scale(${oldWidth/width},${oldHeight/height})`},
        {transform:'none'}
      ],{duration:320,easing:'cubic-bezier(.22,.7,.25,1)'});
    }
  }
  function enterFullwindow(){transitionFullwindow(true);}
  function exitFullwindow(){if(device!=='phone')transitionFullwindow(false);}
  function startDrawerDrag(event:ReactPointerEvent<HTMLButtonElement>){
    if(!event.isPrimary||event.button!==0)return;
    event.stopPropagation();suppressHandleClick.current=false;
    drawerDrag.current={id:event.pointerId,x:event.clientX,y:event.clientY,opened:false};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrawerDrag(event:ReactPointerEvent<HTMLButtonElement>){
    const drag=drawerDrag.current;if(!drag||drag.id!==event.pointerId)return;
    event.stopPropagation();
    if(event.clientY-drag.y>=24&&event.clientY-drag.y>Math.abs(event.clientX-drag.x)){
      drag.opened=true;suppressHandleClick.current=true;setDrawerClosing(false);setDrawerOpen(true);
    }
  }
  function endDrawerDrag(event:ReactPointerEvent<HTMLButtonElement>){
    if(drawerDrag.current?.id!==event.pointerId)return;
    event.stopPropagation();drawerDrag.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  useEffect(()=>{
    const cancel=()=>{
      const drag=drawerDrag.current;drawerDrag.current=null;
      if(!drag)return;
      suppressHandleClick.current=true;
      const handle=drawerHandleRef.current;
      if(handle?.hasPointerCapture(drag.id))handle.releasePointerCapture(drag.id);
    };
    window.addEventListener('blur',cancel);
    return()=>{window.removeEventListener('blur',cancel);cancel();};
  },[]);
  const previousWindowMode=useRef(fullscreen);
  useEffect(()=>{
    if(previousWindowMode.current===fullscreen)return;
    previousWindowMode.current=fullscreen;
    if(fullscreen)drawerHandleRef.current?.focus();
    else windowModeButtonRef.current?.focus();
  },[fullscreen]);
  useEffect(()=>{
    if(advancedEditing||editing||nextConfirm||leaveConfirm||panel||drawerOpen||bookmarkBusy||selectingQuote){navigationRevisionRef.current++;queuedTurnRef.current=null;}
    const flip=flipRef.current;
    const enabled=!advancedEditing&&!editing&&!nextConfirm&&!leaveConfirm&&!drawerOpen&&!panel&&!bookmarkBusy&&!selectingQuote;
    // Reapplying false cancels a gesture; only update on an actual transition.
    if(flip&&flip.isInteractionEnabled()!==enabled)flip.setInteractionEnabled(enabled);
  },[advancedEditing,editing,nextConfirm,leaveConfirm,loading,panel,drawerOpen,bookmarkBusy,selectingQuote]);
  useEffect(()=>{if(selectingQuote){setPanel(null);setDrawerOpen(false);setAssetPreview(null);}},[selectingQuote]);
  useEffect(()=>{if(!editing&&!nextConfirm&&!leaveConfirm){setViewport(previous=>{const next=readReaderViewport();return previous.width===next.width&&previous.height===next.height&&previous.touch===next.touch&&previous.horizontalSegments===next.horizontalSegments&&previous.screenWidth===next.screenWidth&&previous.screenHeight===next.screenHeight?previous:next;});const stage=stageRef.current;if(stage){const box=stage.getBoundingClientRect();setDimensions(previous=>{const next={width:Math.floor(box.width),height:Math.floor(box.height)};return previous.width===next.width&&previous.height===next.height?previous:next;});}}},[editing,nextConfirm,leaveConfirm]);
  useEffect(()=>{setAssetPreview(null);hoverSuppressedRef.current.clear();},[pageIndex,editing,drawerOpen,panel,loading]);
  const onEdit:EditFragment=(fragment,text)=>{draftsRef.current.set(`${fragment.message}:${fragment.char}`,text);};
  const flowEdit=(fragment:Fragment,text:string,element:HTMLParagraphElement):string|undefined=>{
    const fragments=pagesRef.current.flatMap(page=>page.fragments),index=fragments.findIndex(entry=>fragmentKey(entry)===fragmentKey(fragment)),next=fragments[index+1];
    // Keep hidden source blocks, assets, roles and chapter boundaries intact.
    if(!next||next.hidden||next.asset||next.chapter!==undefined||next.message!==fragment.message||next.char!==fragment.end)return;
    const content=element.closest<HTMLElement>('.reader-page-content');if(!content)return;
    const selection=getSelection();let caret=text.length;
    if(selection?.rangeCount&&element.contains(selection.focusNode)){const range=document.createRange();range.selectNodeContents(element);range.setEnd(selection.focusNode!,selection.focusOffset);caret=range.toString().length;}
    let low=0,high=text.length;
    while(low<high){let mid=Math.ceil((low+high)/2);element.textContent=text.slice(0,mid);if(content.scrollHeight<=content.clientHeight+2)low=mid;else high=mid-1;}
    if(low>0&&/[\uD800-\uDBFF]/.test(text.charAt(low-1)))low--;
    if(!low||low>=text.length){element.textContent=text;return;}
    const prefix=text.slice(0,low),suffix=text.slice(low),nextKey=fragmentKey(next);
    element.textContent=prefix;draftsRef.current.set(nextKey,suffix+(draftsRef.current.get(nextKey)??next.text));
    requestAnimationFrame(()=>{
      const target=caret>low?next:fragment;
      if(caret>low){const page=pagesRef.current.findIndex(page=>page.fragments.includes(next));if(page>=0&&(page<pageIndex||page>=pageIndex+spread))jump(page);}
      flushSync(()=>{mountedPagesRef.current.forEach(({root},index)=>root.render(renderLeafRef.current(pagesRef.current[index],index,spread===1)));});
      const field=readerRef.current?.querySelector<HTMLElement>(`[data-edit-key="${fragmentKey(target)}"]`);if(!field)return;
      field.focus({preventScroll:true});const offset=caret>low?caret-low:Math.min(caret,low);const walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT);let remaining=offset,node=walker.nextNode();
      while(node&&remaining>node.textContent!.length){remaining-=node.textContent!.length;node=walker.nextNode();}
      const range=document.createRange();if(node)range.setStart(node,Math.min(remaining,node.textContent!.length));else{range.selectNodeContents(field);range.collapse(false);}range.collapse(true);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);
    });
    return prefix;
  };

  useEffect(()=>{
    setSelectedBookmarkStyle(displayBookmarkStyle(shelfBookmark ? shelfBookmark.style ?? 'normal' : bookmarkStyle ?? book.bookmarkStyle ?? 'normal'));
  },[bookmarkStyle,book.bookmarkStyle,shelfBookmark?.style,!!shelfBookmark]);
  async function changeBookmark(anchor:(Anchor & {label?:string;progress?:number})|null,dragged?:HTMLElement){
    if(!onBookmarkChange||bookmarkBusyRef.current||editing)return;
    bookmarkBusyRef.current=true;setBookmarkBusy(true);setEditError('');
    const save=async()=>{try{await onBookmarkChange(anchor,selectedBookmarkStyle);return true;}catch{setBookmarkToast('책갈피를 저장하지 못했어요.');return false;}};
    try{if(bookmarkMotionRef.current)await bookmarkMotionRef.current.change(save,!!anchor,dragged);else await save();}
    finally{bookmarkBusyRef.current=false;setBookmarkBusy(false);}
  }
  async function chooseBookmarkStyle(next:BookmarkStyle){
    if(bookmarkBusyRef.current||(next==='image'&&!ribbonImage))return;
    const previous=selectedBookmarkStyle;
    setSelectedBookmarkStyle(next);
    const update=onBookmarkStyleChange?()=>onBookmarkStyleChange(next):shelfBookmark?.bookId===book.id&&onBookmarkChange?()=>onBookmarkChange({message:shelfBookmark.message,char:shelfBookmark.char,label:shelfBookmark.label,progress:shelfBookmark.progress},next):null;
    if(!update)return;
    bookmarkBusyRef.current=true;setBookmarkBusy(true);setEditError('');
    try{await update();}catch{setSelectedBookmarkStyle(previous);setBookmarkToast('책갈피 모양을 저장하지 못했어요.');}
    finally{bookmarkBusyRef.current=false;setBookmarkBusy(false);}
  }
  function toggleBookmark(index:number){
    const target=bookmarkLeaf(pagesRef.current,index,device==='phone');
    if(shelfBookmark?.bookId===book.id&&bookmarkPage(pagesRef.current,shelfBookmark,device==='phone')===target){void changeBookmark(null);return;}
    const anchor=bookmarkAnchor(pagesRef.current,index,contentCount,device==='phone');if(anchor)void changeBookmark(anchor);
  }
  reinsertBookmarkRef.current=()=>{
    if(editing||saving||bookmarkBusyRef.current||loading||drawerOpen||panel||flipRef.current?.getState()!=='read')return;
    const anchor=bookmarkAnchor(pagesRef.current,selectedLeaf??pageIndex,contentCount,device==='phone');
    if(anchor)void changeBookmark(anchor);
  };
  const bookmarkActionsRef=useRef<{activate:()=>void;remove:(source:HTMLElement)=>void;allowed:()=>boolean}>({activate:()=>{},remove:()=>{},allowed:()=>false});
  bookmarkActionsRef.current.allowed=()=>!selectingQuote&&!editing&&!saving&&!bookmarkBusyRef.current&&!blockedRef.current&&!drawerRef.current&&!panel&&pagesReadyRef.current&&shelfBookmark?.bookId===bookRef.current.id&&flipRef.current?.getState()==='read';
  bookmarkActionsRef.current.activate=()=>{
    if(!bookmarkActionsRef.current.allowed()||!shelfBookmark)return;
    const saved=bookmarkPage(pagesRef.current,shelfBookmark,device==='phone');
    const flip=flipRef.current;if(saved<0||!flip)return;
    const target=bookmarkLeaf(pagesRef.current,saved,device==='phone');
    if(flip.getPageCollection().getSpreadIndexByPage(target)===flip.getPageCollection().getCurrentSpreadIndex())return;
    navigationRevisionRef.current++;queuedTurnRef.current=null;
    renderWindowRef.current(target,flip.getCurrentPageIndex());
    flip.flip(target,FlipCorner.TOP);
  };
  bookmarkActionsRef.current.remove=source=>{if(bookmarkActionsRef.current.allowed()&&onBookmarkChange)void changeBookmark(null,source);};
  const bookmarkInteraction={disabled:selectingQuote||editing||saving||bookmarkBusy,canInteract:()=>bookmarkActionsRef.current.allowed(),onActivate:()=>bookmarkActionsRef.current.activate(),onRemove:onBookmarkChange?(source:HTMLElement)=>bookmarkActionsRef.current.remove(source):undefined};
  const ribbonIcon=shelfBookmark?.icon??characterIcon??book.characterIcon;
  const ribbonImage=shelfBookmark?.image??bookmarkImage??ribbonIcon;
  const ribbonStyle=displayBookmarkStyle(shelfBookmark ? shelfBookmark.style ?? 'normal' : selectedBookmarkStyle);
  renderLeafRef.current=(page,index,mobile)=><EditOverflowContext.Provider value={flowEdit}><EditNoticeContext.Provider value={message=>notifyEdit(message)}><PageLeaf page={page} book={editingSourceRef.current??bookRef.current} query={queryRef.current} index={index} mobile={mobile} editing={editing} onEdit={onEdit} drafts={draftsRef.current} onPreview={previewAsset} onNext={nextVolumeRef.current?()=>requestNextRef.current():undefined} onClose={()=>requestCloseRef.current()} bookmark={device!=='phone'&&shelfBookmark?.bookId===bookRef.current.id&&bookmarkPage(pagesRef.current,shelfBookmark)===index?{...bookmarkInteraction,style:ribbonStyle,icon:ribbonIcon,image:ribbonImage,title:shelfBookmark.title,color:bookRef.current.color,side:index<(selectedLeaf??pageIndex)?'before':'after'}:undefined}/></EditNoticeContext.Provider></EditOverflowContext.Provider>;
  useEffect(()=>{if(!onSaveBook&&editing){draftsRef.current.clear();editingSourceRef.current=null;setEditing(false);setLeafRevision(value=>value+1);}},[onSaveBook,editing]);
  function cancelEditing(){editingSourceRef.current=null;draftsRef.current.clear();setEditing(false);setEditError('');setLeafRevision(value=>value+1);}
  async function saveEditing(){
    if(!onSaveBook||saving)return;const source=editingSourceRef.current??bookRef.current;
    const {messages,mapAnchor}=draftsRef.current.size?editedMessages(source,draftsRef.current,new Map(),[],pagesRef.current.flatMap(page=>page.fragments),[],false):{messages:source.messages,mapAnchor:(point:Anchor)=>point};
    const existingMark=shelfBookmark?.bookId===source.id?shelfBookmark:undefined;
    const adjustedMark=existingMark?{...mapAnchor(editBookmarkRef.current??existingMark),label:existingMark.label}:undefined;
    const nextAnchor=anchorRef.current?mapAnchor(anchorRef.current):null;
    setSaving(true);setEditError('');try{await onSaveBook({...source,displayPrompt:editPrompt,messages,...(adjustedMark?{bookmarks:[adjustedMark]}:{}),updatedAt:new Date().toISOString()});anchorRef.current=nextAnchor;activeMessagesRef.current=messages;if(adjustedMark&&onBookmarkChange)await onBookmarkChange(adjustedMark,shelfBookmark?.style??selectedBookmarkStyle);draftsRef.current.clear();editingSourceRef.current=null;setEditing(false);setLeafRevision(value=>value+1);}catch{setEditError('저장하지 못했어요. 다시 시도하세요.');}finally{setSaving(false);}
  }
  function currentAnchor(){return bookmarkAnchor(pagesRef.current,Math.min(selectedLeaf??pageIndex,pagesRef.current.length-1),contentCount,device==='phone');}
  requestCloseRef.current=()=>{
    if(dataPending){closeRef.current();return;}
    if(editing||saving||bookmarkBusy)return;
    const marked=shelfBookmark?.bookId===bookRef.current.id?bookmarkPage(pagesRef.current,shelfBookmark,device==='phone'):-1;
    if(pagesRef.current.slice(pageIndex,pageIndex+spread).some(page=>page.kind==='back-cover'||page.kind==='end'||page.kind==='front-cover'||page.kind==='front-endpaper')||!onBookmarkChange||!currentAnchor()||(marked>=pageIndex&&marked<pageIndex+spread)){closeRef.current();return;}
    flipRef.current?.cancelUserTouch();queuedTurnRef.current=null;setLeaveError('');setLeaveConfirm(true);
  };
  async function saveBeforeLeaving(){
    const anchor=currentAnchor();if(!anchor||!onBookmarkChange||bookmarkBusyRef.current)return;
    bookmarkBusyRef.current=true;setBookmarkBusy(true);setLeaveError('');
    try{await onBookmarkChange(anchor,selectedBookmarkStyle);closeRef.current();}catch{setLeaveError('책갈피를 저장하지 못했어요. 다시 시도하세요.');}finally{bookmarkBusyRef.current=false;setBookmarkBusy(false);}
  }
  const activeLeaf=selectedLeaf??pageIndex;
  const activeBookmarked=shelfBookmark?.bookId===book.id&&bookmarkPage(pages,shelfBookmark,device==='phone')===bookmarkLeaf(pages,activeLeaf,device==='phone');
  const markedPage=shelfBookmark?.bookId===book.id?bookmarkPage(pages,shelfBookmark,device==='phone'):-1;
  const peekBookmark=markedPage>=0&&(markedPage<pageIndex||markedPage>=pageIndex+spread);
  const bookmarkAction=activeBookmarked?'책갈피 제거':shelfBookmark?'현재 위치로 책갈피 옮기기':'현재 위치에 책갈피';
  const togglePanel = (next: Exclude<Panel, null>) => setPanel(value => value === next ? null : next);
  const proseStart=bodyStart(pages);
  const visibleEnd = Math.min(contentCount,pageIndex+spread-proseStart);
  const bodyPosition=Math.max(0,pageIndex-proseStart);
  const atFront=pageIndex<proseStart,atEnd=pageIndex>=proseStart+contentCount;
  const percent = !pages.length||atFront?0:atEnd?100:Math.round(Math.min(1,bodyPosition/Math.max(1,contentCount-1))*100);
  const positionLabel=!pages.length?'책장을 준비하고 있어요':atFront?'표지':atEnd?'끝':`전체 ${contentCount}쪽 중 ${bodyPosition+1}${visibleEnd>bodyPosition+1?`–${visibleEnd}`:''}쪽`;
  const style = { '--reader-font-size': `${fontSize}px`, '--book-cover':book.color, '--reader-book-width':`${pageGeometry.width*pageGeometry.count}px`, '--paper-width':`${pageGeometry.width}px`, '--paper-height':`${pageGeometry.height}px`, '--reader-page-padding':`${pageGeometry.padding}px`, '--reader-content-top':`${pageGeometry.contentTop}px`, '--reader-content-bottom':`${pageGeometry.contentBottom}px` } as CSSProperties;

  return <div ref={readerRef} className={`reader reader-theme-${theme}${theme === 'dark' ? ' dark' : ''}${fullscreen?' reader-fullscreen':''}${editing?' reader-is-editing':''}`} data-device={device} data-window-entering={windowEntering||undefined} data-drawer-closing={drawerClosing||undefined} data-drawer-open={drawerOpen||undefined} data-flush-covers={fullscreen&&device!=='desktop'||undefined} data-selecting-quote={selectingQuote||undefined} data-page-layout={spread===2?'spread':'single'} data-bookmark-current={markedPage>=pageIndex&&markedPage<pageIndex+spread||undefined} style={style} lang="ko">
    {fullscreen&&<button ref={drawerHandleRef} className="reader-drawer-handle" data-no-flip aria-label="독서 메뉴" aria-expanded={drawerOpen} aria-controls="reader-drawer" onPointerDown={startDrawerDrag} onPointerMove={moveDrawerDrag} onPointerUp={endDrawerDrag} onPointerCancel={event=>{suppressHandleClick.current=true;endDrawerDrag(event);}} onLostPointerCapture={()=>{drawerDrag.current=null;}} onClick={()=>{if(suppressHandleClick.current){suppressHandleClick.current=false;return;}if(drawerOpen)closeDrawer();else {setWindowEntering(false);setDrawerClosing(false);setDrawerOpen(true);}}}><span/></button>}
    {fullscreen&&drawerOpen&&<button className="reader-drawer-backdrop" aria-label="독서 메뉴 닫기" onClick={closeDrawer} tabIndex={-1}/>}
    <div id="reader-drawer" className="reader-drawer" hidden={fullscreen&&!drawerOpen&&!windowEntering&&!drawerClosing} inert={fullscreen&&!drawerOpen} aria-hidden={fullscreen&&!drawerOpen||undefined}>
    <header className="reader-toolbar">
      <button className="reader-icon-button reader-navigation-back" onClick={()=>requestCloseRef.current()} aria-label="책을 닫고 서재로 돌아가기" title="서재로 돌아가기" disabled={editing||saving}><ChevronLeft size={19} /></button>
      <div className="reader-toolbar-title"><span>{book.title||<span className="skeleton-fill reader-title-loading" aria-label="책 제목을 불러오는 중"/>}</span><small>{book.title?bookAuthor(book):''}</small></div>
      <div className="reader-tools">
        {onShare&&<button className="reader-icon-button" aria-label="책 공유" title="공유" disabled={editing||saving||loading||bookmarkBusy} onClick={()=>{setPanel(null);onShare();}}><Share2 size={18}/></button>}
        {onSaveBook&&<button className={`reader-icon-button ${editing?'reader-active':''}`} aria-label="본문 편집" title="간단 수정" aria-pressed={editing} disabled={saving||loading||dataPending} onClick={()=>{if(editing){cancelEditing();return;}setPanel(null);draftsRef.current.clear();setEditError('');setDrawerOpen(false);editingSourceRef.current=bookRef.current;setEditPrompt(normalizeDisplayPrompt(bookRef.current.displayPrompt));editBookmarkRef.current=shelfBookmark?.bookId===book.id?shelfBookmark:null;setEditing(true);}}><Pencil size={18}/></button>}
        {onBookmarkChange&&<button className={`reader-icon-button ${activeBookmarked?'reader-active':''}`} aria-label={bookmarkAction} title={bookmarkAction} aria-pressed={activeBookmarked} disabled={editing||saving||bookmarkBusy||loading||(!activeBookmarked&&!bookmarkAnchor(pages,activeLeaf,contentCount,device==='phone'))} onClick={()=>void toggleBookmark(activeLeaf)}><Bookmark size={18} fill={activeBookmarked?'currentColor':'none'}/></button>}
        {device!=='phone'&&<button ref={windowModeButtonRef} className="reader-icon-button" aria-label={fullscreen?'전체창 해제':'전체창'} title={fullscreen?'전체창 해제':'전체창'} disabled={editing} onClick={()=>fullscreen?exitFullwindow():enterFullwindow()}><Maximize size={18}/></button>}
        <button ref={element => { panelButtonRefs.current.contents = element; }} className={`reader-icon-button ${panel === 'contents' ? 'reader-active' : ''}`} aria-label="목차 보기" title="목차" disabled={editing} aria-expanded={panel === 'contents'} aria-controls="reader-contents" onClick={() => togglePanel('contents')}><List size={20} /></button>
        <button ref={element => { panelButtonRefs.current.search = element; }} className={`reader-icon-button ${panel === 'search' ? 'reader-active' : ''}`} aria-label="책 속에서 검색" title="책 속 검색" disabled={editing} aria-expanded={panel === 'search'} aria-controls="reader-search" onClick={() => togglePanel('search')}><Search size={19} /></button>
        <button ref={element => { panelButtonRefs.current.appearance = element; }} className={`reader-icon-button ${panel === 'appearance' ? 'reader-active' : ''}`} aria-label="독서 화면 설정" title="독서 화면 설정" disabled={editing} aria-expanded={panel === 'appearance'} aria-controls="reader-appearance" onClick={() => togglePanel('appearance')}><Type size={21} /></button>
      </div>
    </header>

    {fullscreen&&<button className="reader-drawer-close reader-icon-button" aria-label="메뉴 닫기" onClick={closeDrawer}><X size={18}/></button>}
    </div>

    <main className="reader-main" aria-label={`${book.title} 읽기`}>
      <div className="reader-stage" ref={stageRef} aria-busy={loading} data-book-closed={pages.slice(pageIndex,pageIndex+spread).some(page=>page.kind==='back-cover'||page.kind==='front-cover')}>
        {!loading&&device!=='phone'&&<div className="reader-cover-boards" aria-hidden="true" inert><span className="reader-cover-board-left"/><span className="reader-cover-board-right"/></div>}
        <div className="reader-book-mount" ref={mountRef} onPointerDownCapture={event=>{const page=(event.target as HTMLElement).closest<HTMLElement>('[data-reader-page-index]');if(page&&!page.dataset.flipCopy)setSelectedLeaf(Number(page.dataset.readerPageIndex));}}/>
        {!loading&&device!=='phone'&&peekBookmark&&shelfBookmark&&<div className={`reader-bookmark-peek reader-bookmark-peek-${markedPage<pageIndex?'before':'after'}`} aria-label="페이지 사이 책갈피"><BookmarkSlip {...bookmarkInteraction} style={ribbonStyle} icon={ribbonIcon} image={ribbonImage} title={shelfBookmark.title} color={book.color} side={markedPage<pageIndex?'before':'after'}/></div>}
        {!loading&&device==='phone'&&markedPage>=0&&shelfBookmark&&<div className="reader-phone-bookmark" data-current={markedPage===pageIndex} aria-label="책갈피"><BookmarkSlip {...bookmarkInteraction} style={ribbonStyle} icon={ribbonIcon} image={ribbonImage} title={shelfBookmark.title} color={book.color} side="after"/></div>}
      {selectingQuote&&onQuoteSelected&&<ShareQuoteSelection host={mountRef} onDone={onQuoteSelected} onPrevious={()=>jump(Math.max(0,pageIndex-spread))} onNext={()=>jump(Math.min(pages.length-1,pageIndex+spread))}/>}
      {editing&&<div className="reader-edit-navigation" data-no-flip><button type="button" aria-label="편집 이전 페이지" disabled={saving||loading||pageIndex===0} onClick={()=>jump(Math.max(0,pageIndex-spread))}><span aria-hidden="true">&lt;</span></button><button type="button" aria-label="편집 다음 페이지" disabled={saving||loading||pageIndex+spread>=pages.length} onPointerDown={event=>event.preventDefault()} onClick={()=>jump(Math.min(pages.length-1,pageIndex+spread))}><span aria-hidden="true">&gt;</span></button></div>}
        {(loading||dataPending) && <ReadingSkeleton embedded pages={readerPageCount(dimensions.width||viewport.width,viewport)} fullwindow={fullscreen}/>}
      </div>
      {error && <p className="reader-error" role="alert">{error} <button type="button" className="secondary-btn" onClick={()=>setOpenRevision(value=>value+1)}>다시 시도</button></p>}
      {editError&&<p className="reader-error" role="alert">{editError}</p>}

      {editing&&<SimpleEditTools prompt={editPrompt} onPromptChange={setEditPrompt} saving={saving} onAdvanced={()=>{if(draftsRef.current.size||JSON.stringify(editPrompt)!==JSON.stringify(normalizeDisplayPrompt(book.displayPrompt))){notifyEdit('변경 내용을 저장하거나 취소한 뒤 고급 수정을 열어 주세요.');return;}cancelEditing();setAdvancedEditing(true);}} onCancel={cancelEditing} onSave={()=>void saveEditing()}/>}

    </main>

    <footer className={`reader-footer${fullscreen&&!drawerOpen&&!editing?' reader-footer-concealed':''}`} inert={fullscreen&&!drawerOpen&&!editing} aria-hidden={fullscreen&&!drawerOpen&&!editing||undefined}>
      <div className="reader-progress-label"><span>{positionLabel}</span><span>{percent}% 읽음</span></div>
      <input className="reader-progress" type="range" min={0} max={Math.max(0, pages.length - 1)} value={Math.min(pageIndex, Math.max(0, pages.length - 1))} disabled={saving || loading || pages.length < 2} onChange={event => jump(Number(event.target.value))} aria-label="읽는 위치 이동" aria-valuetext={positionLabel} style={{ '--reader-progress': `${pages.length>1?Math.min(pageIndex,pages.length-1)/(pages.length-1)*100:0}%` } as CSSProperties} />
      <span className="reader-sr-only" aria-live="polite">{!loading&&positionLabel}</span>
    </footer>



    {panel && <>
      <button className="reader-panel-backdrop" aria-label="독서 패널 닫기" onClick={() => setPanel(null)} tabIndex={-1} />
      <div className={`reader-panel reader-panel-${panel}`} ref={panelRef} tabIndex={-1} role="region" aria-labelledby="reader-panel-title" id={`reader-${panel}`}>
        <div className="reader-panel-heading"><h2 id="reader-panel-title">{panel === 'contents' ? '목차' : panel === 'search' ? '책 속 검색' : '독서 설정'}</h2><button className="reader-icon-button" aria-label="패널 닫기" onClick={() => { setPanel(null); panelButtonRefs.current[panel]?.focus(); }}><X size={18} /></button></div>
        {panel === 'contents' && <>
          <p className="reader-panel-description">챕터 {chapterEntries.length}개 · 전체 {contentCount}쪽</p>
          <nav className="reader-contents-list" aria-label="이야기 목차">
            <button className="reader-contents-item" onClick={() => { jump(0); setPanel(null); }}><span className="reader-contents-number"><BookOpen size={16} /></span><span><strong>{book.title}</strong><small>책의 처음으로</small></span><span className="reader-contents-page">1</span></button>
            {chapterEntries.map(({message,index,char,number},chapterIndex) => {
              const page = pageForAnchor(pages, { message: index, char });
              return <button className={`reader-contents-item ${page <= pageIndex && pageIndex < (chapterIndex+1<chapterEntries.length?pageForAnchor(pages,{message:chapterEntries[chapterIndex+1].index,char:chapterEntries[chapterIndex+1].char}):pages.length) ? 'reader-current-passage' : ''}`} key={`${index}:${char}`} onClick={() => goToAnchor({ message: index, char })}>
                <span className="reader-contents-number">{String(number).padStart(2, '0')}</span><span><strong>{chapterLabel(number,message.chapterTitle)}</strong><small>{visibleProse(message.content.slice(char),book.displayPrompt).slice(0, 95) || '아직 내용이 없어요'}</small></span><span className="reader-contents-page">{Math.max(1,page-proseStart+1)}</span>
              </button>;
            })}
          </nav>
        </>}
        {panel === 'search' && <>
          <div className="reader-search-field"><Search size={17} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="기억에 남은 단어나 문장을 찾아보세요" aria-label="검색할 단어나 문장" type="search" /><button className="reader-icon-button" aria-label="검색어 지우기" disabled={!query} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={15} /></button></div>
          <p className="reader-panel-description" role="status">{!deferredQuery ? '책 전체에서 단어나 문장을 찾아보세요.' : hits.length ? `검색 결과 ${hits.length}개${hits.length === 200 ? ' 이상 · 처음 200개만 표시해요' : ''}` : '검색 결과가 없어요. 다른 단어로 찾아보세요.'}</p>
          <div className="reader-search-results">{hits.map(hit => <button className="reader-search-result" key={`${hit.message}:${hit.char}`} onClick={() => goToAnchor(hit)}><span>{hit.name} <small>· {Math.max(1,pageForAnchor(pages,hit)-proseStart+1)}쪽</small></span><p><Highlight text={hit.excerpt} query={deferredQuery} /></p></button>)}</div>
        </>}
        {panel === 'appearance' && <>
          <div className="reader-setting-label"><span>책갈피</span></div>
          <div className="reader-bookmark-options">{(['normal','image'] as const).map(option=><button key={option} type="button" title={option==='image'&&!ribbonImage?'책장 이미지에서 선택하세요':undefined} aria-pressed={selectedBookmarkStyle===option} disabled={option==='image'&&!ribbonImage||bookmarkBusy||!!shelfBookmark&&!onBookmarkStyleChange&&(shelfBookmark.bookId!==book.id||!onBookmarkChange)} onClick={()=>void chooseBookmarkStyle(option)}>{option==='normal'?<Bookmark size={22}/>:ribbonImage?<img src={ribbonImage} alt=""/>:<BookOpen size={22}/>}<span>{option==='normal'?'기본':'이미지'}</span>{selectedBookmarkStyle===option&&<Check size={14}/>}</button>)}</div>
          <div className="reader-setting-label"><span>글자 크기</span><small>{fontSize}픽셀</small></div>
          <div className="reader-font-control"><button aria-label="글자 작게" disabled={fontSize <= 14} onClick={() => setFontSize(size => Math.max(14, size - 1))}><Minus size={17} /><Type size={15} /></button><span className="reader-font-preview">가나다</span><button aria-label="글자 크게" disabled={fontSize >= 28} onClick={() => setFontSize(size => Math.min(28, size + 1))}><Type size={22} /><Plus size={17} /></button></div>
          <div className="reader-setting-label"><span>책장 색</span></div>
          <ThemePicker value={theme} onChange={value=>{setTheme(value);saveTheme(value);}}/>
        </>}
      </div>
    </>}
    {assetPreview&&createPortal(<div className={`reader-asset-preview${assetPreview.pinned?' reader-asset-preview-pinned':''}${assetPreview.closing?' reader-asset-preview-closing':''}`} role="region" aria-label="이미지 미리보기"><button type="button" data-flip-asset key={assetPreview.owner} className="reader-asset-preview-expand" tabIndex={assetPreview.pinned?0:-1} aria-label="이미지 미리보기 접기" onClick={event=>{event.stopPropagation();hoverSuppressedRef.current.add(assetPreview.owner);setAssetPreview(null);}} style={{left:assetPreview.left,top:assetPreview.top,width:assetPreview.width,height:assetPreview.height,'--preview-clip-x':`${Math.max(0,(assetPreview.width-assetPreview.size)/2)}px`,'--preview-clip-bottom':`${Math.max(0,assetPreview.height-assetPreview.size)}px`} as CSSProperties}><img src={assetPreview.asset.src} alt={assetPreview.asset.name} draggable={false}/></button></div>,assetPreview.container)}
    <div ref={measureRef} className="reader-measure reader-page-content" aria-hidden="true" />
    {editToast.message&&<Toast key={editToast.id} {...editToast} onDismiss={dismissEdit}/>}
    {advancedEditing&&onSaveBook&&<AdvancedBookEditor book={book} onSave={async updated=>{const point=anchorRef.current,previous=bookRef.current;const next=point&&previous.messages[point.message]&&updated.messages[point.message]?{message:point.message,char:createOffsetMapper(previous.messages[point.message].content,updated.messages[point.message].content)(point.char)}:point;await onSaveBook(updated);activeMessagesRef.current=updated.messages;anchorRef.current=next;}} onClose={()=>setAdvancedEditing(false)}/>}
    {bookmarkToast&&<Toast message={bookmarkToast} tone="error" onDismiss={()=>setBookmarkToast('')}/> }
    {leaveConfirm&&<LeaveDialog moving={!!shelfBookmark} busy={bookmarkBusy} error={leaveError} onCancel={()=>{setLeaveConfirm(false);setLeaveError('');}} onLeave={()=>closeRef.current()} onSave={()=>void saveBeforeLeaving()}/>}
    {nextConfirm&&onNextVolume&&<NextVolumeDialog title={nextVolumeTitle} onClose={()=>setNextConfirm(false)} onConfirm={()=>{setNextConfirm(false);onNextVolume();}}/>}
  </div>;
}

export default Reader;

