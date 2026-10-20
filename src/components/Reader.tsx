import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PageFlip } from '../vendor/page-flip/PageFlip';
import { SizeType } from '../vendor/page-flip/Settings';
import { FlipCorner } from '../vendor/page-flip/Flip/Flip';
import { ArrowRight, BookOpen, Bookmark, Check, ChevronLeft, List, Maximize, Minus, Pencil, Plus, Search, Type, X } from 'lucide-react';
import type { Book } from '../lib/library';
import { paginate, cleanText, startsChapter, chapterNumber } from '../lib/pagination';
import type { Anchor, Fragment, PaperPage } from '../lib/pagination';
import { readerPageCount, readReaderViewport } from '../lib/readerLayout';
import BackBarcode from './BackBarcode';
import ThemePicker from './ThemePicker';
import {readTheme,saveTheme,THEME_EVENT} from '../lib/appearance';
import {visibleProse,systemRanges} from '../lib/prose';
import {imageReferenceRanges} from '../lib/assets';
import './reader.css';

export interface ReaderProps {
  book: Book;
  onClose: () => void;
  initialBookmark?: { message: number; char: number };
  onNextVolume?: () => void;
  nextVolumeTitle?: string;
  onSaveBook?: (book:Book)=>Promise<void>;
  shelfBookmark?: { bookId: string; message: number; char: number; label?: string; progress?:number; style?: BookmarkStyle; icon?: string; title: string };
  onBookmarkChange?: (anchor: (Anchor & { label?: string; progress?:number }) | null, style?: BookmarkStyle) => Promise<void>;
  onBookmarkStyleChange?: (style: BookmarkStyle) => Promise<void>;
  bookmarkStyle?: BookmarkStyle;
  characterIcon?: string;
}

type BookmarkStyle = 'normal' | 'character';
type Panel = 'contents' | 'search' | 'appearance' | null;
type Theme = 'paper' | 'warm' | 'dark';
type SearchHit = Anchor & { length: number; excerpt: string; name: string };
type ReaderPreferences = { theme: Theme; fontSize: number };

const PREFERENCES_KEY = 'galpi.reader.appearance.v1';
const readerCopy = {
  unknownAuthor: '지은이 미상',
};

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
  return 0;
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
 const value=visibleProse(text);const parts=value.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|“[^”]+”|「[^」]+」)/g);
 return <>{parts.map((part,i)=>part.startsWith('**')?<strong key={i}><Highlight text={part.slice(2,-2)} query={query}/></strong>:/^[*_]/.test(part)&&part.length>2?<em key={i}><Highlight text={part.slice(1,-1)} query={query}/></em>:/^[“「]/.test(part)?<span className="reader-dialogue" key={i}><Highlight text={part} query={query}/></span>:<Highlight key={i} text={part} query={query}/>)}</>;
}
type EditFragment=(fragment:Fragment,text:string)=>void;
function EditablePassage({fragment,onEdit,draft}:{fragment:Fragment;onEdit:EditFragment;draft?:string}){
 const ref=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(ref.current)ref.current.textContent=draft??visibleProse(fragment.text);},[]);
 return <p ref={ref} className="reader-prose reader-live-passage" role="textbox" aria-label="페이지 본문 편집" contentEditable suppressContentEditableWarning data-no-flip onInput={e=>onEdit(fragment,e.currentTarget.innerText)} onPaste={e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));}}/>;
}
function PageContent({page,query,editing,onEdit,drafts}:{page:PaperPage;query:string;editing:boolean;onEdit:EditFragment;drafts:Map<string,string>}){
 return <>{page.fragments.filter(fragment=>!fragment.hidden).map(fragment=><section className="reader-fragment" data-message={fragment.message} data-char={fragment.char} key={`${fragment.message}:${fragment.char}`}>
 {editing?<EditablePassage fragment={fragment} onEdit={onEdit} draft={drafts.get(`${fragment.message}:${fragment.char}`)}/>:<p className="reader-prose"><RisuText text={fragment.text} query={query}/></p>}
 </section>)}</>;
}
type BookmarkSlipProps={style:BookmarkStyle;icon?:string;title:string;color:string;side?:'before'|'after'};
function BookmarkSlip({style,icon,title,color,side='after'}:BookmarkSlipProps){
 return <span data-no-flip data-bookmark-side={side} className={`reader-bookmark-slip reader-bookmark-${style}`} role="img" aria-label="책갈피" style={{'--bookmark-color':color} as CSSProperties}>
 <span className="reader-bookmark-punch"/><span className="reader-bookmark-string"/>{style==='character'&&<>{icon&&<img src={icon} alt="" draggable={false}/>}<strong>{cleanText(title).replace(/\s*·\s*\d+권\s*$/,'')}</strong></>}
 </span>;
}
function PageLeaf({page,book,query,index,onNext,onClose,mobile,editing,onEdit,drafts,bookmark}:{page:PaperPage;book:Book;query:string;index:number;onNext?:()=>void;onClose:()=>void;mobile:boolean;editing:boolean;onEdit:EditFragment;drafts:Map<string,string>;bookmark?:BookmarkSlipProps}) {
 const action=<button className="reader-end-action" data-no-flip disabled={editing} onClick={onNext??onClose}>{onNext?'다음 권 읽기':'서재로'}<ArrowRight size={18}/></button>;
 if(page.kind==='back-cover')return <div className="reader-back-cover reader-true-back" style={{'--book-cover':book.color} as CSSProperties}><div className="reader-back-imprint"><span className="reader-back-colophon">{cleanText(book.author)}</span><span className="reader-back-mark">{cleanText(book.title).replace(/\s*·\s*\d+권\s*$/,'')}</span><span className="reader-back-volume">{book.volumeNumber?String(book.volumeNumber).padStart(2,'0'):''}</span><BackBarcode/>{mobile&&action}</div></div>;
 if(page.kind==='end')return <div className="reader-end-half">{action}</div>;
 if(page.kind==='padding'||page.kind==='endpaper')return <div className={`reader-paper-shell${page.kind==='endpaper'?' reader-endpaper':''}`}/>;
 return <div className="reader-paper-shell">{bookmark&&<BookmarkSlip {...bookmark}/>} {page.chapter!==undefined&&<div className="reader-chapter-heading">챕터 {String(page.chapter).padStart(2,'0')}</div>}{page.kind==='asset'?<figure className="reader-asset-page"><img src={page.asset!.src} alt={page.asset!.name}/></figure>:<div className={`reader-page-content${page.chapter!==undefined?' reader-page-chapter-content':''}${editing?' reader-page-content-editing':''}`}><PageContent page={page} query={query} editing={editing} onEdit={onEdit} drafts={drafts}/></div>}<div className="reader-page-number">{index+1}</div></div>;
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

export function Reader({ book, onClose, initialBookmark, onNextVolume, nextVolumeTitle, onSaveBook, shelfBookmark, onBookmarkChange, onBookmarkStyleChange, bookmarkStyle, characterIcon }: ReaderProps) {
  const [editing,setEditing]=useState(false);
  const [saving,setSaving]=useState(false);
  const [editError,setEditError]=useState('');
  const [leafRevision,setLeafRevision]=useState(0);
  const draftsRef=useRef(new Map<string,string>());
  const [fullscreen,setFullscreen]=useState(false);
  const fullscreenRef=useRef(false);fullscreenRef.current=fullscreen;
  const readerRef=useRef<HTMLDivElement>(null);
  const [selectedLeaf,setSelectedLeaf]=useState<number|null>(null);
  const [selectedBookmarkStyle, setSelectedBookmarkStyle] = useState<BookmarkStyle>(shelfBookmark ? shelfBookmark.style ?? 'normal' : bookmarkStyle ?? book.bookmarkStyle ?? 'normal');
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const bookmarkBusyRef = useRef(false);
  const [leaveConfirm,setLeaveConfirm]=useState(false);
  const [leaveError,setLeaveError]=useState('');
  const requestCloseRef=useRef<()=>void>(()=>{});
  const initialBookmarkRef=useRef(initialBookmark);initialBookmarkRef.current=initialBookmark;
  const navigationRevisionRef = useRef(0);
  const pagesReadyRef = useRef(false);
  const renderLeafRef=useRef<(page:PaperPage,index:number,mobile:boolean)=>ReactNode>(()=>null);
  const [nextConfirm,setNextConfirm]=useState(false);
  const blockedRef=useRef(false);blockedRef.current=editing||nextConfirm||leaveConfirm;
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
  const [spread, setSpread] = useState(1);
  const [viewport, setViewport] = useState(readReaderViewport);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const rootsRef = useRef<Root[]>([]);
  const mountedPagesRef = useRef(new Map<number, { root: Root; element: HTMLElement }>());
  const renderWindowRef = useRef<(index:number)=>void>(()=>{});
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
  const contentKey = useMemo(() => ({ title: book.title, author: book.author, messages: book.messages,assets:book.assets }),
    [book.title, book.author, book.messages,book.assets]);

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

  const chapterEntries=useMemo(()=>{let number=0;return book.messages.flatMap((message,index)=>startsChapter(book,index)?[{message,index,number:++number}]:[]);},[book.messages]);

  const hits = useMemo(() => {
    const results: SearchHit[] = [];
    if (!deferredQuery) return results;
    const pattern = new RegExp(escapeRegExp(deferredQuery), 'giu');
    for (let message = 0; message < book.messages.length; message++) {
      const entry = book.messages[message];
      const images=imageReferenceRanges(entry.content);const hidden=[...systemRanges(entry.content,images),...images];
      for (const match of entry.content.matchAll(pattern)) {
        const char = match.index ?? 0;
        if(hidden.some(range=>char<range.end&&char+match[0].length>range.start))continue;
        const before=visibleProse(entry.content.slice(0,char)),after=visibleProse(entry.content.slice(char+match[0].length));
        results.push({ message, char, length: match[0].length, name: `챕터 ${String(chapterNumber(book,message)).padStart(2,'0')}`,
          excerpt: `${before.length>35?'…':''}${before.slice(-35)}${match[0]}${after.slice(0,80)}${after.length>80?'…':''}` });
        if (results.length >= 200) return results;
      }
    }
    return results;
  }, [contentKey, deferredQuery]);

  useEffect(() => {
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if(blockedRef.current)return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setDimensions(previous => {
        const next = { width: Math.floor(width), height: Math.floor(height) };
        return next.width === previous.width && next.height === previous.height ? previous : next;
      }));
    });
    observer.observe(stage);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  // Font loading can change wrapping independently of the viewport.
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () => { if (alive&&!blockedRef.current) setFontRevision(value => value + 1); };
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener('loadingdone', refresh);
    return () => { alive = false; document.fonts.removeEventListener('loadingdone', refresh); };
  }, []);

  useEffect(() => {
    if (!dimensions.width || !dimensions.height) return;
    let cancelled = false;
    let instance: PageFlip | null = null;
    let pageRoots: Root[] = [];
    let host: HTMLDivElement | null = null;
    let queuedFrame=0;
    pagesReadyRef.current=false;
    setLoading(true);
    setError('');
    const frame = requestAnimationFrame(() => {
      if (cancelled || !mountRef.current || !measureRef.current) return;
      const currentBook = bookRef.current;
      if (activeBookRef.current !== currentBook.id || activeMessagesRef.current!==currentBook.messages) {
        anchorRef.current = null;
        activeBookRef.current = currentBook.id;
        activeMessagesRef.current=currentBook.messages;
      }
      const count = readerPageCount(dimensions.width, viewport);
      const width = Math.max(120, Math.min(fullscreen?Infinity:540, Math.floor((dimensions.width - 16) / count)));
      const height = Math.max(100, Math.min(fullscreen?Infinity:790, dimensions.height - Math.min(56, dimensions.height * .12)));
      const padding = width < 350 ? 22 : width < 440 ? 32 : 46;
      const contentTop = height < 300 ? 22 : 36;
      const contentBottom = height < 300 ? 32 : 56;
      const measure = measureRef.current;
      measure.style.width = `${width - padding * 2}px`;
      measure.style.height = `${Math.max(1,height - contentTop - contentBottom)}px`;
      measure.style.fontSize = `${fontSize}px`;
      measure.style.setProperty('--paper-height',`${height}px`);
      const nextPages = paginate(currentBook, measure,{pageHeight:height,contentTop});
      const bodyCount=nextPages.length;
      nextPages.push({fragments:[],intro:false,kind:'endpaper'});
      if(count===2&&nextPages.length%2)nextPages.push({fragments:[],intro:false,kind:'endpaper'});
      nextPages.push({fragments:[],intro:false,kind:'back-cover'});
      if(count===2)nextPages.push({fragments:[],intro:false,kind:'end'});
      pagesRef.current = nextPages;
      const target = anchorRef.current ? pageForAnchor(nextPages, anchorRef.current)
        : initialBookmarkRef.current ? pageForAnchor(nextPages,initialBookmarkRef.current) : 0;
      host = document.createElement('div');
      host.className = 'reader-flip-host';
      host.style.width = `${width * count}px`;
      host.style.height = `${height}px`;
      host.style.setProperty('--reader-page-padding', `${padding}px`);
      host.style.setProperty('--reader-font-size', `${fontSize}px`);
      host.style.setProperty('--reader-content-top', `${contentTop}px`);
      host.style.setProperty('--reader-content-bottom', `${contentBottom}px`);
      host.style.setProperty('--paper-width',`${width}px`);host.style.setProperty('--paper-height',`${height}px`);host.dataset.flipState='read';
      stageRef.current?.style.setProperty('--paper-width',`${width}px`);stageRef.current?.style.setProperty('--paper-height',`${height}px`);
      mountRef.current.append(host);
      const nodes = nextPages.map((page, index) => {
        const element = document.createElement('div');
        element.className = `reader-page ${index % 2 === 0 ? 'reader-page-left' : 'reader-page-right'}`;
        element.dataset.pageKind=page.kind??'paper';
        element.dataset.readerPageIndex=String(index);
        element.setAttribute('data-density', page.kind==='back-cover'?'hard':'soft');
        element.setAttribute('role', 'article');
        element.setAttribute('aria-label', `${index + 1}쪽`);
        element.setAttribute('lang', 'ko');
        host!.append(element);
        return element;
      });
      const mounted=new Map<number,{root:Root;element:HTMLElement}>();
      mountedPagesRef.current=mounted;
      const renderWindow=(index:number)=>{
        const first=Math.max(0,index-3),last=Math.min(nextPages.length-1,index+5);
        for(const [number,entry] of mounted){if(number<first||number>last){entry.root.unmount();mounted.delete(number);}}
        flushSync(()=>{
          for(let number=first;number<=last;number++){
            let entry=mounted.get(number);
            if(!entry){entry={root:createRoot(nodes[number]),element:nodes[number]};mounted.set(number,entry);
              entry.root.render(renderLeafRef.current(nextPages[number],number,count===1));
            }
          }
        });
      };
      renderWindowRef.current=renderWindow;
      renderWindow(target);
      rootsRef.current = pageRoots;
      const report = (index: number, saveAnchor = true) => {
        const safe = clamp(index, 0, nextPages.length - 1);
        setPageIndex(safe);
        setSelectedLeaf(null);
        renderWindow(safe);
        if (saveAnchor) anchorRef.current = nextPages[safe].fragments[0] ?? nextPages[Math.min(safe,bodyCount-1)].fragments[0] ?? null;

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
          if(!cancelled){if(host)host.dataset.flipState=String(event.data);}
          if(event.data==='read'&&queuedTurnRef.current){
            const direction=queuedTurnRef.current;queuedTurnRef.current=null;
            const revision=navigationRevisionRef.current;
            queuedFrame=requestAnimationFrame(()=>{if(!cancelled&&revision===navigationRevisionRef.current)turnRef.current(direction);});
          }
        });
        instance.loadFromHTML(nodes);
        flipRef.current = instance;
        instance.setInteractionEnabled(!blockedRef.current);
        report(instance.getCurrentPageIndex(), !anchorRef.current);
      } catch {
        setError('책장 넘기기를 사용할 수 없어요. 화면을 스크롤해 계속 읽어 주세요.');
        host.classList.add('reader-flip-fallback');
        report(target, false);
      }
      setPages(nextPages);
      setContentCount(bodyCount);
      setSpread(count);
      pagesReadyRef.current=true;
      setLoading(false);
    });
    return () => {
      cancelled = true;
      pagesReadyRef.current=false;
      cancelAnimationFrame(frame);
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
  }, [book.id, contentKey, dimensions.width, dimensions.height, fontSize, fontRevision,fullscreen,viewport]);

  // Highlighting does not repaginate: marks have exactly the same font metrics.
  useEffect(() => {
    const currentBook = bookRef.current;
    mountedPagesRef.current.forEach(({root}, index) => {
      const page = pagesRef.current[index];
      if (!page) return;
      root.render(renderLeafRef.current(page,index,spread===1));
    });
  }, [deferredQuery,pages,editing,leafRevision,shelfBookmark,bookmarkBusy,book.bookmarks,book.color,selectedLeaf,pageIndex]);

  const jump = (page: number) => {
    if(blockedRef.current || !pagesReadyRef.current || !pagesRef.current.length)return;
    navigationRevisionRef.current++;
    queuedTurnRef.current=null;
    flipRef.current?.cancelUserTouch();
    const safe = clamp(page, 0, Math.max(0, pagesRef.current.length - 1));
    anchorRef.current = pagesRef.current[safe]?.fragments[0] ?? null;
    renderWindowRef.current(safe);
    flipRef.current?.turnToPage(safe);
    if (error) mountRef.current?.querySelectorAll('.reader-page')[safe]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const goToAnchor = (anchor: Anchor) => {
    jump(pageForAnchor(pagesRef.current, anchor));
    anchorRef.current = anchor;
    setPanel(null);
  };
  const turn = (direction: 'previous' | 'next') => {
    const flip = flipRef.current;
    if (!flip||blockedRef.current||!pagesReadyRef.current) return;
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
      if(blockedRef.current)return;
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        if (panel) { setPanel(null); panelButtonRefs.current[panel]?.focus(); }
        else if(fullscreenRef.current)void exitFullscreen();
        else requestCloseRef.current();
        return;
      }
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
      if(event.ctrlKey||blockedRef.current||panel)return;
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

  useEffect(()=>{
    const change=()=>setFullscreen(document.fullscreenElement===readerRef.current);
    document.addEventListener('fullscreenchange',change);
    return()=>document.removeEventListener('fullscreenchange',change);
  },[]);
  async function enterFullscreen(){
    try{if(readerRef.current?.requestFullscreen)await readerRef.current.requestFullscreen();setFullscreen(true);}catch{setFullscreen(true);}
  }
  async function exitFullscreen(){
    if(document.fullscreenElement)try{await document.exitFullscreen();}catch{}
    setFullscreen(false);
  }
  useEffect(()=>{
    if(editing||nextConfirm||leaveConfirm||panel){navigationRevisionRef.current++;queuedTurnRef.current=null;}
    const flip=flipRef.current;
    const enabled=!editing&&!nextConfirm&&!leaveConfirm;
    // Reapplying false cancels a gesture; only update on an actual transition.
    if(flip&&flip.isInteractionEnabled()!==enabled)flip.setInteractionEnabled(enabled);
  },[editing,nextConfirm,leaveConfirm,loading,panel]);
  useEffect(()=>{if(!editing&&!nextConfirm&&!leaveConfirm){setViewport(previous=>{const next=readReaderViewport();return previous.width===next.width&&previous.height===next.height&&previous.touch===next.touch&&previous.horizontalSegments===next.horizontalSegments?previous:next;});const stage=stageRef.current;if(stage){const box=stage.getBoundingClientRect();setDimensions(previous=>{const next={width:Math.floor(box.width),height:Math.floor(box.height)};return previous.width===next.width&&previous.height===next.height?previous:next;});}}},[editing,nextConfirm,leaveConfirm]);
  const onEdit:EditFragment=(fragment,text)=>{draftsRef.current.set(`${fragment.message}:${fragment.char}`,text);};
  useEffect(()=>{
    setSelectedBookmarkStyle(shelfBookmark ? shelfBookmark.style ?? 'normal' : bookmarkStyle ?? book.bookmarkStyle ?? 'normal');
  },[bookmarkStyle,book.bookmarkStyle,shelfBookmark?.style,!!shelfBookmark]);
  async function changeBookmark(anchor:(Anchor & {label?:string;progress?:number})|null){
    if(!onBookmarkChange||bookmarkBusyRef.current||editing)return;
    bookmarkBusyRef.current=true;setBookmarkBusy(true);setEditError('');
    try{await onBookmarkChange(anchor,selectedBookmarkStyle);}catch{setEditError('책갈피를 저장하지 못했어요.');}
    finally{bookmarkBusyRef.current=false;setBookmarkBusy(false);}
  }
  async function chooseBookmarkStyle(next:BookmarkStyle){
    if(bookmarkBusyRef.current)return;
    const previous=selectedBookmarkStyle;
    setSelectedBookmarkStyle(next);
    const update=onBookmarkStyleChange?()=>onBookmarkStyleChange(next):shelfBookmark?.bookId===book.id&&onBookmarkChange?()=>onBookmarkChange({message:shelfBookmark.message,char:shelfBookmark.char,label:shelfBookmark.label,progress:shelfBookmark.progress},next):null;
    if(!update)return;
    bookmarkBusyRef.current=true;setBookmarkBusy(true);setEditError('');
    try{await update();}catch{setSelectedBookmarkStyle(previous);setEditError('책갈피 모양을 저장하지 못했어요.');}
    finally{bookmarkBusyRef.current=false;setBookmarkBusy(false);}
  }
  function toggleBookmark(index:number){
    if(shelfBookmark?.bookId===book.id&&pageForAnchor(pagesRef.current,shelfBookmark)===index){void changeBookmark(null);return;}
    const page=pagesRef.current[index],fragment=page?.fragments[0];
    if(fragment)void changeBookmark({message:fragment.message,char:fragment.char,progress:Math.min(1,index/Math.max(1,contentCount-1)),label:visibleProse(fragment.text).slice(0,60)||page.asset?.name||'책갈피'});
  }
  const ribbonIcon=shelfBookmark?.icon??characterIcon??book.characterIcon;
  const ribbonStyle=shelfBookmark ? shelfBookmark.style ?? 'normal' : selectedBookmarkStyle;
  renderLeafRef.current=(page,index,mobile)=><PageLeaf page={page} book={bookRef.current} query={queryRef.current} index={index} mobile={mobile} editing={editing} onEdit={onEdit} drafts={draftsRef.current} onNext={nextVolumeRef.current?()=>requestNextRef.current():undefined} onClose={()=>requestCloseRef.current()} bookmark={shelfBookmark?.bookId===bookRef.current.id&&pageForAnchor(pagesRef.current,shelfBookmark)===index?{style:ribbonStyle,icon:ribbonIcon,title:shelfBookmark.title,color:bookRef.current.color,side:index<(selectedLeaf??pageIndex)?'before':'after'}:undefined}/>;
  useEffect(()=>{if(!onSaveBook&&editing){draftsRef.current.clear();setEditing(false);setLeafRevision(value=>value+1);}},[onSaveBook,editing]);
  function cancelEditing(){draftsRef.current.clear();setEditing(false);setEditError('');setLeafRevision(value=>value+1);}
  async function saveEditing(){
    if(!onSaveBook||saving)return;const source=bookRef.current;
    const patches=new Map<number,{start:number;end:number;text:string}[]>();
    for(const page of pagesRef.current)for(const fragment of page.fragments){const value=draftsRef.current.get(`${fragment.message}:${fragment.char}`);if(value===undefined)continue;const list=patches.get(fragment.message)??[];list.push({start:fragment.char,end:fragment.end,text:value});patches.set(fragment.message,list);}
    const messages=source.messages.map((message,index)=>{let content=message.content;for(const patch of (patches.get(index)??[]).sort((a,b)=>b.start-a.start))content=content.slice(0,patch.start)+patch.text+content.slice(patch.end);return content===message.content?message:{...message,content};});
    const existingMark=shelfBookmark?.bookId===source.id?shelfBookmark:undefined;
    let adjustedMark:(Anchor & {label?:string;progress?:number})|undefined;
    if(existingMark){let char=existingMark.char;for(const patch of (patches.get(existingMark.message)??[]).sort((a,b)=>a.start-b.start)){if(existingMark.char>=patch.end)char+=patch.text.length-(patch.end-patch.start);else if(existingMark.char>=patch.start)char+=patch.start-existingMark.char;}if(char!==existingMark.char)adjustedMark={message:existingMark.message,char:Math.min(messages[existingMark.message].content.length,Math.max(0,char)),label:existingMark.label};}
    setSaving(true);setEditError('');try{await onSaveBook({...source,messages,...(adjustedMark?{bookmarks:[adjustedMark]}:{}),updatedAt:new Date().toISOString()});if(adjustedMark&&onBookmarkChange)await onBookmarkChange(adjustedMark,shelfBookmark?.style??selectedBookmarkStyle);draftsRef.current.clear();setEditing(false);setLeafRevision(value=>value+1);}catch{setEditError('저장하지 못했어요. 다시 시도하세요.');}finally{setSaving(false);}
  }
  function currentAnchor(){
    const all=pagesRef.current;let index=Math.min(selectedLeaf??pageIndex,all.length-1);
    while(index>=0){const page=all[index];const fragment=page?.fragments[0];if(fragment)return {message:fragment.message,char:fragment.char,progress:Math.min(1,index/Math.max(1,contentCount-1)),label:page.asset?.name??visibleProse(fragment.text).slice(0,60)};index--;}
    return null;
  }
  requestCloseRef.current=()=>{
    if(editing||saving||bookmarkBusy)return;
    const marked=shelfBookmark?.bookId===bookRef.current.id?pageForAnchor(pagesRef.current,shelfBookmark):-1;
    if(!onBookmarkChange||!currentAnchor()||(marked>=pageIndex&&marked<pageIndex+spread)){closeRef.current();return;}
    flipRef.current?.cancelUserTouch();queuedTurnRef.current=null;setLeaveError('');setLeaveConfirm(true);
  };
  async function saveBeforeLeaving(){
    const anchor=currentAnchor();if(!anchor||!onBookmarkChange||bookmarkBusyRef.current)return;
    bookmarkBusyRef.current=true;setBookmarkBusy(true);setLeaveError('');
    try{await onBookmarkChange(anchor,selectedBookmarkStyle);closeRef.current();}catch{setLeaveError('책갈피를 저장하지 못했어요. 다시 시도하세요.');}finally{bookmarkBusyRef.current=false;setBookmarkBusy(false);}
  }
  const activeLeaf=selectedLeaf??pageIndex;
  const activeBookmarked=shelfBookmark?.bookId===book.id&&pageForAnchor(pages,shelfBookmark)===activeLeaf;
  const markedPage=shelfBookmark?.bookId===book.id?pageForAnchor(pages,shelfBookmark):-1;
  const peekBookmark=markedPage>=0&&(markedPage<pageIndex||markedPage>=pageIndex+spread);
  const bookmarkAction=activeBookmarked?'책갈피 제거':shelfBookmark?'현재 위치로 책갈피 옮기기':'현재 위치에 책갈피';
  const togglePanel = (next: Exclude<Panel, null>) => setPanel(value => value === next ? null : next);
  const visibleEnd = Math.min(pages.length, pageIndex + spread);
  const percent = !pages.length?0:pageIndex>=contentCount?100:Math.round(Math.min(1,pageIndex/Math.max(1,contentCount-1))*100);
  const style = { '--reader-font-size': `${fontSize}px` } as CSSProperties;

  return <div ref={readerRef} className={`reader reader-theme-${theme}${theme === 'dark' ? ' dark' : ''}${fullscreen?' reader-fullscreen':''}${editing?' reader-is-editing':''}`} data-page-layout={spread===2?'spread':'single'} style={style} lang="ko">
    {fullscreen&&<div className="reader-fullscreen-exit"><button aria-label="전체화면 해제" title="전체화면 해제 (Esc)" onClick={()=>void exitFullscreen()}><X size={22}/></button></div>}
    <header className="reader-toolbar">
      <button className="reader-back" onClick={()=>requestCloseRef.current()} aria-label="책을 닫고 서재로 돌아가기" title="서재로 돌아가기" disabled={editing||saving}><ChevronLeft size={19} /><span>서재</span></button>
      <div className="reader-toolbar-title"><span>{book.title}</span><small>{book.author || readerCopy.unknownAuthor}</small></div>
      <div className="reader-tools">
        {onSaveBook&&<button className={`reader-icon-button ${editing?'reader-active':''}`} aria-label="본문 편집" title="페이지에서 편집" aria-pressed={editing} disabled={saving} onClick={()=>{if(editing){cancelEditing();return;}setPanel(null);draftsRef.current.clear();setEditError('');setEditing(true);}}><Pencil size={18}/></button>}
        {onBookmarkChange&&<button className={`reader-icon-button ${activeBookmarked?'reader-active':''}`} aria-label={bookmarkAction} title={bookmarkAction} aria-pressed={activeBookmarked} disabled={editing||saving||bookmarkBusy||loading||(!activeBookmarked&&!pages[activeLeaf]?.fragments.length)} onClick={()=>void toggleBookmark(activeLeaf)}><Bookmark size={18} fill={activeBookmarked?'currentColor':'none'}/></button>}
        <button className="reader-icon-button" aria-label="전체화면" title="전체화면" disabled={editing} onClick={()=>void enterFullscreen()}><Maximize size={18}/></button>
        <button ref={element => { panelButtonRefs.current.contents = element; }} className={`reader-icon-button ${panel === 'contents' ? 'reader-active' : ''}`} aria-label="목차 보기" title="목차" disabled={editing} aria-expanded={panel === 'contents'} aria-controls="reader-contents" onClick={() => togglePanel('contents')}><List size={20} /></button>
        <button ref={element => { panelButtonRefs.current.search = element; }} className={`reader-icon-button ${panel === 'search' ? 'reader-active' : ''}`} aria-label="책 속에서 검색" title="책 속 검색" disabled={editing} aria-expanded={panel === 'search'} aria-controls="reader-search" onClick={() => togglePanel('search')}><Search size={19} /></button>
        <button ref={element => { panelButtonRefs.current.appearance = element; }} className={`reader-icon-button ${panel === 'appearance' ? 'reader-active' : ''}`} aria-label="독서 화면 설정" title="독서 화면 설정" disabled={editing} aria-expanded={panel === 'appearance'} aria-controls="reader-appearance" onClick={() => togglePanel('appearance')}><Type size={21} /></button>
      </div>
    </header>

    <main className="reader-main" aria-label={`${book.title} 읽기`}>
      <div className="reader-stage" ref={stageRef} aria-busy={loading} data-book-closed={pages[pageIndex]?.kind==='back-cover'}>
        <div className="reader-book-mount" ref={mountRef} onPointerDownCapture={event=>{const page=(event.target as HTMLElement).closest<HTMLElement>('[data-reader-page-index]');if(page&&!page.dataset.flipCopy)setSelectedLeaf(Number(page.dataset.readerPageIndex));}}/>
        {!loading&&peekBookmark&&shelfBookmark&&<div className={`reader-bookmark-peek reader-bookmark-peek-${markedPage<pageIndex?'before':'after'}`} aria-label="페이지 사이 책갈피"><BookmarkSlip style={ribbonStyle} icon={ribbonIcon} title={shelfBookmark.title} color={book.color}/></div>}
        {loading && <div className="reader-loading" role="status"><BookOpen size={25} /><span>읽던 곳을 펼치고 있어요…</span></div>}
      </div>
      {error && <p className="reader-error" role="status">{error}</p>}
      {editError&&<p className="reader-error" role="alert">{editError}</p>}
      {editing&&<div className="reader-inline-actions"><span>페이지 편집</span><button disabled={saving} onClick={cancelEditing}>취소</button><button disabled={saving} onClick={()=>void saveEditing()}><Check size={16}/>{saving?'저장 중…':'저장'}</button></div>}

    </main>

    <footer className="reader-footer">
      <div className="reader-progress-label"><span>{pages.length ? pageIndex>=contentCount?'끝':`전체 ${contentCount}쪽 중 ${pageIndex + 1}${Math.min(visibleEnd,contentCount) > pageIndex + 1 ? `–${Math.min(visibleEnd,contentCount)}` : ''}쪽` : '책장을 준비하고 있어요'}</span><span>{percent}% 읽음</span></div>
      <input className="reader-progress" type="range" min={0} max={Math.max(0, pages.length - 1)} value={Math.min(pageIndex, Math.max(0, pages.length - 1))} disabled={editing || loading || pages.length < 2} onChange={event => jump(Number(event.target.value))} aria-label="읽는 위치 이동" aria-valuetext={pages.length ? `전체 ${pages.length}쪽 중 ${pageIndex + 1}쪽` : '책장을 준비하고 있어요'} style={{ '--reader-progress': `${percent}%` } as CSSProperties} />
      <span className="reader-sr-only" aria-live="polite">{!loading && `전체 ${pages.length}쪽 중 ${pageIndex + 1}쪽`}</span>
    </footer>

    {panel && <>
      <button className="reader-panel-backdrop" aria-label="독서 패널 닫기" onClick={() => setPanel(null)} tabIndex={-1} />
      <div className={`reader-panel reader-panel-${panel}`} ref={panelRef} tabIndex={-1} role="region" aria-labelledby="reader-panel-title" id={`reader-${panel}`}>
        <div className="reader-panel-heading"><h2 id="reader-panel-title">{panel === 'contents' ? '목차' : panel === 'search' ? '책 속 검색' : '독서 설정'}</h2><button className="reader-icon-button" aria-label="패널 닫기" onClick={() => { setPanel(null); panelButtonRefs.current[panel]?.focus(); }}><X size={18} /></button></div>
        {panel === 'contents' && <>
          <p className="reader-panel-description">챕터 {chapterEntries.length}개 · 전체 {pages.length}쪽</p>
          <nav className="reader-contents-list" aria-label="이야기 목차">
            <button className="reader-contents-item" onClick={() => { jump(0); setPanel(null); }}><span className="reader-contents-number"><BookOpen size={16} /></span><span><strong>{book.title}</strong><small>책의 처음으로</small></span><span className="reader-contents-page">1</span></button>
            {chapterEntries.map(({message,index,number},chapterIndex) => {
              const page = pageForAnchor(pages, { message: index, char: 0 });
              return <button className={`reader-contents-item ${page <= pageIndex && pageIndex < (chapterIndex+1<chapterEntries.length?pageForAnchor(pages,{message:chapterEntries[chapterIndex+1].index,char:0}):pages.length) ? 'reader-current-passage' : ''}`} key={index} onClick={() => goToAnchor({ message: index, char: 0 })}>
                <span className="reader-contents-number">{String(number).padStart(2, '0')}</span><span><strong>챕터 {String(number).padStart(2,'0')}</strong><small>{visibleProse(message.content).slice(0, 95) || '아직 내용이 없어요'}</small></span><span className="reader-contents-page">{page + 1}</span>
              </button>;
            })}
          </nav>
        </>}
        {panel === 'search' && <>
          <div className="reader-search-field"><Search size={17} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="기억에 남은 단어나 문장을 찾아보세요" aria-label="검색할 단어나 문장" type="search" /><button className="reader-icon-button" aria-label="검색어 지우기" disabled={!query} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={15} /></button></div>
          <p className="reader-panel-description" role="status">{!deferredQuery ? '책 전체에서 단어나 문장을 찾아보세요.' : hits.length ? `검색 결과 ${hits.length}개${hits.length === 200 ? ' 이상 · 처음 200개만 표시해요' : ''}` : '검색 결과가 없어요. 다른 단어로 찾아보세요.'}</p>
          <div className="reader-search-results">{hits.map(hit => <button className="reader-search-result" key={`${hit.message}:${hit.char}`} onClick={() => goToAnchor(hit)}><span>{hit.name} <small>· {pageForAnchor(pages, hit) + 1}쪽</small></span><p><Highlight text={hit.excerpt} query={deferredQuery} /></p></button>)}</div>
        </>}
        {panel === 'appearance' && <>
          <div className="reader-setting-label"><span>책갈피</span></div>
          <div className="reader-bookmark-options">{(['normal','character'] as const).map(option=><button key={option} type="button" aria-pressed={selectedBookmarkStyle===option} disabled={bookmarkBusy||!!shelfBookmark&&!onBookmarkStyleChange&&(shelfBookmark.bookId!==book.id||!onBookmarkChange)} onClick={()=>void chooseBookmarkStyle(option)}>{option==='normal'?<Bookmark size={22}/>:ribbonIcon?<img src={ribbonIcon} alt=""/>:<BookOpen size={22}/>}<span>{option==='normal'?'기본':'캐릭터'}</span>{selectedBookmarkStyle===option&&<Check size={14}/>}</button>)}</div>
          <div className="reader-setting-label"><span>글자 크기</span><small>{fontSize}픽셀</small></div>
          <div className="reader-font-control"><button aria-label="글자 작게" disabled={fontSize <= 14} onClick={() => setFontSize(size => Math.max(14, size - 1))}><Minus size={17} /><Type size={15} /></button><span className="reader-font-preview">가나다</span><button aria-label="글자 크게" disabled={fontSize >= 28} onClick={() => setFontSize(size => Math.min(28, size + 1))}><Type size={22} /><Plus size={17} /></button></div>
          <div className="reader-setting-label"><span>책장 색</span></div>
          <ThemePicker value={theme} onChange={value=>{setTheme(value);saveTheme(value);}}/>
        </>}
      </div>
    </>}
    <div ref={measureRef} className="reader-measure reader-page-content" aria-hidden="true" />
    {leaveConfirm&&<LeaveDialog moving={!!shelfBookmark} busy={bookmarkBusy} error={leaveError} onCancel={()=>{setLeaveConfirm(false);setLeaveError('');}} onLeave={()=>closeRef.current()} onSave={()=>void saveBeforeLeaving()}/>}
    {nextConfirm&&onNextVolume&&<NextVolumeDialog title={nextVolumeTitle} onClose={()=>setNextConfirm(false)} onConfirm={()=>{setNextConfirm(false);onNextVolume();}}/>}
  </div>;
}

export default Reader;
