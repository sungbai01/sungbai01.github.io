import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PageFlip } from '../vendor/page-flip/PageFlip';
import { SizeType } from '../vendor/page-flip/Settings';
import { FlipCorner } from '../vendor/page-flip/Flip/Flip';
import { ArrowRight, BookOpen, Bookmark, Check, ChevronLeft, List, Maximize, Minus, Moon, Pencil, Plus, Search, Sun, Type, X } from 'lucide-react';
import { extractAssetSegments } from '../lib/assets';
import type { Book, BookAsset } from '../lib/library';
import { MAX_VOLUME_PAGES, splitBookByPages } from '../lib/volumes';
import './reader.css';

export interface ReaderProps {
  book: Book;
  onClose: () => void;
  /** Zero-based physical page index, matching Book.lastPage. */
  onProgress: (page: number) => void;
  onSplit?: (book: Book, volumes: Book[]) => Promise<void>;
  onNextVolume?: () => void;
  nextVolumeTitle?: string;
  onSaveBook?: (book:Book)=>Promise<void>;
  shelfBookmark?: { bookId: string; message: number; char: number; label?: string; style?: BookmarkStyle; icon?: string; title: string };
  onBookmarkChange?: (anchor: (Anchor & { label?: string }) | null, style?: BookmarkStyle) => Promise<void>;
  onBookmarkStyleChange?: (style: BookmarkStyle) => Promise<void>;
  onGoBookmark?: () => void;
  bookmarkJumpRequest?: number;
  bookmarkStyle?: BookmarkStyle;
  characterIcon?: string;
}

type BookmarkStyle = 'normal' | 'character';
type Anchor = { message: number; char: number };
type Fragment = Anchor & { end: number; name: string; text: string };
type PaperPage = { fragments: Fragment[]; intro: boolean; asset?: BookAsset; kind?: 'paper'|'asset'|'padding'|'back-cover'|'end' };
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

function speakerName(message: Book['messages'][number]) {
  const roles: Record<string, string> = { user: '독자', assistant: '이야기', system: '안내', developer: '설정', tool: '도구', narrator: '서술자' };
  return message.name || roles[message.role] || '서술자';
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pageForAnchor(pages: PaperPage[], anchor: Anchor) {
  const found = pages.findIndex(page => page.fragments.some(fragment =>
    fragment.message === anchor.message && fragment.char <= anchor.char &&
    (anchor.char < fragment.end || fragment.char === fragment.end),
  ));
  return found < 0 ? Math.max(0, pages.length - 1) : found;
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

// Emoji are hidden in the reader; source offsets remain intact for bookmarks.
function cleanText(text:string){return text.replace(/[#*0-9]\uFE0F?\u20E3|[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu,'');}
function RisuText({text,query}:{text:string;query:string}){
 const value=cleanText(text);const parts=value.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|“[^”]+”|「[^」]+」)/g);
 return <>{parts.map((part,i)=>part.startsWith('**')?<strong key={i}><Highlight text={part.slice(2,-2)} query={query}/></strong>:/^[*_]/.test(part)&&part.length>2?<em key={i}><Highlight text={part.slice(1,-1)} query={query}/></em>:/^[“「]/.test(part)?<span className="reader-dialogue" key={i}><Highlight text={part} query={query}/></span>:<Highlight key={i} text={part} query={query}/>)}</>;
}
type EditFragment=(fragment:Fragment,text:string)=>void;
function EditablePassage({fragment,onEdit,draft}:{fragment:Fragment;onEdit:EditFragment;draft?:string}){
 const ref=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(ref.current)ref.current.textContent=draft??cleanText(fragment.text);},[]);
 return <p ref={ref} className="reader-prose reader-live-passage" role="textbox" aria-label="페이지 본문 편집" contentEditable suppressContentEditableWarning data-no-flip onInput={e=>onEdit(fragment,e.currentTarget.innerText)} onPaste={e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));}}/>;
}
function PageContent({page,query,editing,onEdit,drafts}:{page:PaperPage;query:string;editing:boolean;onEdit:EditFragment;drafts:Map<string,string>}){
 return <>{page.fragments.map(fragment=><section className="reader-fragment" data-message={fragment.message} data-char={fragment.char} key={`${fragment.message}:${fragment.char}`}>
 {fragment.char===0&&<div className="reader-message-name">{cleanText(fragment.name)}</div>}
 {editing?<EditablePassage fragment={fragment} onEdit={onEdit} draft={drafts.get(`${fragment.message}:${fragment.char}`)}/>:<p className="reader-prose"><RisuText text={fragment.text} query={query}/></p>}
 </section>)}</>;
}
function PageLeaf({page,book,query,index,onNext,onClose,mobile,editing,onEdit,drafts}:{page:PaperPage;book:Book;query:string;index:number;onNext?:()=>void;onClose:()=>void;mobile:boolean;editing:boolean;onEdit:EditFragment;drafts:Map<string,string>}) {
 const action=<button className="reader-end-action" data-no-flip onClick={onNext??onClose}>{onNext?'다음 권 읽기':'서재로'}<ArrowRight size={18}/></button>;
 if(page.kind==='back-cover')return <div className="reader-back-cover reader-true-back" style={{'--book-cover':book.color} as CSSProperties}>{book.backCover&&<img className="reader-back-cover-art" src={book.backCover} alt="뒷표지"/>}<div className="reader-back-imprint"><span className="reader-back-colophon">{cleanText(book.author)}</span><span className="reader-back-mark">갈피</span><span className="reader-back-volume">{book.volumeNumber?`${book.volumeNumber}권`:''}</span><span className="reader-back-barcode" aria-hidden="true"/>{mobile&&action}</div></div>;
 if(page.kind==='end')return <div className="reader-end-half">{action}</div>;
 if(page.kind==='padding')return <div className="reader-paper-shell"/>;
 return <div className="reader-paper-shell">{page.kind==='asset'?<figure className="reader-asset-page"><img src={page.asset!.src} alt={page.asset!.name}/></figure>:<div className={`reader-page-content${editing?' reader-page-content-editing':''}`}><PageContent page={page} query={query} editing={editing} onEdit={onEdit} drafts={drafts}/></div>}<div className="reader-page-number">{index+1}</div></div>;
}

function NextVolumeDialog({title,onConfirm,onClose}:{title?:string;onConfirm:()=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="reader-next-dialog" aria-label="다음 권 읽기" onCancel={e=>{e.preventDefault();onClose();}}><h2>다음 권을 읽을까요?</h2><p>{title}</p><div><button autoFocus onClick={onClose}>취소</button><button onClick={onConfirm}>읽기<ArrowRight size={17}/></button></div></dialog>;
}

/** Measures the same blocks and typography used by the visible React pages. */
export function paginate(book: Book, measure: HTMLDivElement): PaperPage[] {
 const pages:PaperPage[]=[{fragments:[],intro:false}];let current=pages[0];measure.replaceChildren();
 const nextPage=()=>{current={fragments:[],intro:false};pages.push(current);measure.replaceChildren();};
 book.messages.forEach((message,messageIndex)=>{
  const content=message.content||'',name=speakerName(message);
  const segments=extractAssetSegments(content,book.assets??[]);
  if(!segments.length&&content.length===0){current.fragments.push({message:messageIndex,char:0,end:0,name,text:''});return;}
  for(const segment of segments){
   if(segment.type==='asset'){
    if(current.fragments.length)nextPage();
    // Physical page one is the left leaf. Keep illustrations on odd pages even on mobile.
    if((pages.length-1)%2===1){current.kind='padding';nextPage();}
    current.kind='asset';current.asset=segment.asset;current.fragments.push({message:messageIndex,char:segment.start,end:segment.end,name,text:content.slice(segment.start,segment.end)});nextPage();continue;
   }
   let offset=segment.start;
   while(offset<segment.end){
    const section=document.createElement('section');section.className='reader-fragment';
    if(offset===0){const label=document.createElement('div');label.className='reader-message-name';label.textContent=cleanText(name);section.append(label);}
    const paragraph=document.createElement('p');paragraph.className='reader-prose';section.append(paragraph);measure.append(section);
    const fits=(end:number)=>{paragraph.textContent=cleanText(content.slice(offset,end));return measure.scrollHeight<=measure.clientHeight;};
    let low=offset,high=Math.min(segment.end,offset+256),upperFits=fits(high);
    while(upperFits&&high<segment.end){low=high;high=Math.min(segment.end,offset+(high-offset)*2);upperFits=fits(high);}
    let end=high;
    if(!upperFits){
     while(low<high){const mid=Math.ceil((low+high)/2);if(fits(mid))low=mid;else high=mid-1;}end=low;
     if(end>offset&&/[\uD800-\uDBFF]/.test(content.charAt(end-1)))end--;
     if(end===offset){section.remove();if(current.fragments.length){nextPage();continue;}end=offset+(content.codePointAt(offset)!>0xffff?2:1);measure.append(section);}
     else{const tail=content.slice(offset,end),boundary=Math.max(tail.lastIndexOf('\n'),tail.lastIndexOf(' '),tail.lastIndexOf('\t'));if(boundary>tail.length*.72)end=offset+boundary+1;}
     paragraph.textContent=cleanText(content.slice(offset,end));
    }
    current.fragments.push({message:messageIndex,char:offset,end,name,text:content.slice(offset,end)});offset=end;
    if(offset<segment.end)nextPage();
   }
  }
 });
 if(pages.length>1&&!current.fragments.length&&current.kind!=='asset')pages.pop();
 return pages;
}

export function Reader({ book, onClose, onProgress, onSplit, onNextVolume, nextVolumeTitle, onSaveBook, shelfBookmark, onBookmarkChange, onBookmarkStyleChange, onGoBookmark, bookmarkJumpRequest, bookmarkStyle, characterIcon }: ReaderProps) {
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
  const ribbonDragRef = useRef<{ pointerId: number; startY: number; offset: number } | null>(null);
  const suppressRibbonClickRef = useRef(false);
  const [ribbonOffset, setRibbonOffset] = useState(0);
  const [paperSize, setPaperSize] = useState({ width: 0, height: 0 });
  const appliedBookmarkJumpRef = useRef<number | undefined>(bookmarkJumpRequest === 0 ? 0 : undefined);
  const navigationRevisionRef = useRef(0);
  const pagesReadyRef = useRef(false);
  const renderLeafRef=useRef<(page:PaperPage,index:number,mobile:boolean)=>ReactNode>(()=>null);
  const [nextConfirm,setNextConfirm]=useState(false);
  const blockedRef=useRef(false);blockedRef.current=editing||nextConfirm;
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
  const [spread, setSpread] = useState(2);
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
  const splitRef = useRef(onSplit);
  const nextVolumeRef = useRef(onNextVolume);
  const queuedTurnRef=useRef<'previous'|'next'|null>(null);
  const [splitRevision,setSplitRevision] = useState(0);
  const splitFailureRef = useRef(false);
  const splittingMessagesRef=useRef<Book['messages']|null>(null);
  const activeMessagesRef=useRef<Book['messages']|null>(null);
  const pagesRef = useRef<PaperPage[]>([]);
  const anchorRef = useRef<Anchor | null>(null);
  const activeBookRef = useRef<string | null>(null);
  const callbackRef = useRef(onProgress);
  const closeRef = useRef(onClose);
  const bookRef = useRef(book);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelButtonRefs = useRef<Partial<Record<Exclude<Panel, null>, HTMLButtonElement | null>>>({});
  const lastReportedRef = useRef('');
  callbackRef.current = onProgress;
  closeRef.current = onClose;
  bookRef.current = book;
  queryRef.current = deferredQuery;
  splitRef.current = onSplit;
  nextVolumeRef.current=onNextVolume;
  // Stable content dependencies prevent a parent's progress update rebuilding the book.
  const contentKey = useMemo(() => ({ title: book.title, author: book.author, messages: book.messages,assets:book.assets }),
    [book.title, book.author, book.messages,book.assets]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ theme, fontSize }));
    } catch {
      // Reading controls remain usable when browser storage is unavailable.
    }
  }, [theme, fontSize]);

  const hits = useMemo(() => {
    const results: SearchHit[] = [];
    if (!deferredQuery) return results;
    const pattern = new RegExp(escapeRegExp(deferredQuery), 'giu');
    for (let message = 0; message < book.messages.length; message++) {
      const entry = book.messages[message];
      for (const match of entry.content.matchAll(pattern)) {
        const char = match.index ?? 0;
        results.push({ message, char, length: match[0].length, name: speakerName(entry),
          excerpt: `${char > 35 ? '…' : ''}${entry.content.slice(Math.max(0, char - 35), char + match[0].length + 80)}${char + match[0].length + 80 < entry.content.length ? '…' : ''}` });
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
        splitFailureRef.current=false;
        lastReportedRef.current = '';
      }
      const count = dimensions.width >= 760 ? 2 : 1;
      const width = Math.max(120, Math.min(fullscreen?Infinity:540, Math.floor((dimensions.width - 16) / count)));
      const height = Math.max(300, Math.min(fullscreen?Infinity:790, dimensions.height - 44));
      const padding = width < 350 ? 22 : width < 440 ? 32 : 46;
      const measure = measureRef.current;
      measure.style.width = `${width - padding * 2}px`;
      measure.style.height = `${height - 92}px`;
      measure.style.fontSize = `${fontSize}px`;
      const nextPages = paginate(currentBook, measure);
      const bodyCount=nextPages.length;
      if (nextPages.length > MAX_VOLUME_PAGES && splitRef.current && !splitFailureRef.current) {
        if(splittingMessagesRef.current===currentBook.messages)return;
        splittingMessagesRef.current=currentBook.messages;
        try {
          const volumes=splitBookByPages(currentBook,nextPages);
          void splitRef.current(currentBook,volumes).catch(()=>{
            if(!cancelled){splitFailureRef.current=true;splittingMessagesRef.current=null;setSplitRevision(value=>value+1);}
          });
          return;
        } catch {
          splitFailureRef.current=true;
        }
      }
      if(count===2&&nextPages.length%2)nextPages.push({fragments:[],intro:false,kind:'padding'});
      nextPages.push({fragments:[],intro:false,kind:'back-cover'});
      if(count===2)nextPages.push({fragments:[],intro:false,kind:'end'});
      pagesRef.current = nextPages;
      const target = anchorRef.current ? pageForAnchor(nextPages, anchorRef.current)
        : clamp(Math.floor(Number.isFinite(currentBook.lastPage) ? currentBook.lastPage! : 0), 0, nextPages.length - 1);
      setPaperSize({ width: width * count, height });
      host = document.createElement('div');
      host.className = 'reader-flip-host';
      host.style.width = `${width * count}px`;
      host.style.height = `${height}px`;
      host.style.setProperty('--reader-page-padding', `${padding}px`);
      host.style.setProperty('--reader-font-size', `${fontSize}px`);
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
        const key = `${currentBook.id}:${safe}`;
        if (lastReportedRef.current !== key) {
          lastReportedRef.current = key;
          callbackRef.current(safe);
        }
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
        // Publish progress after the curl settles, not while it is drawing.
        instance.on('flip', event => { if (!cancelled) report(Number(event.data)); });
        instance.on('changeState',event=>{
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
  }, [book.id, contentKey, dimensions.width, dimensions.height, fontSize, fontRevision,splitRevision,fullscreen]);

  // Highlighting does not repaginate: marks have exactly the same font metrics.
  useEffect(() => {
    const currentBook = bookRef.current;
    mountedPagesRef.current.forEach(({root}, index) => {
      const page = pagesRef.current[index];
      if (!page) return;
      root.render(renderLeafRef.current(page,index,spread===1));
    });
  }, [deferredQuery, pages,editing,leafRevision,book.backCover,book.color]);

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
        else closeRef.current();
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
    if(editing||nextConfirm||panel){navigationRevisionRef.current++;queuedTurnRef.current=null;}
    const flip=flipRef.current;
    const enabled=!editing&&!nextConfirm;
    // Reapplying false cancels a gesture; only update on an actual transition.
    if(flip&&flip.isInteractionEnabled()!==enabled)flip.setInteractionEnabled(enabled);
  },[editing,nextConfirm,loading,panel]);
  useEffect(()=>{if(!editing){const stage=stageRef.current;if(stage){const box=stage.getBoundingClientRect();setDimensions(previous=>{const next={width:Math.floor(box.width),height:Math.floor(box.height)};return previous.width===next.width&&previous.height===next.height?previous:next;});}}},[editing]);
  const onEdit:EditFragment=(fragment,text)=>{draftsRef.current.set(`${fragment.message}:${fragment.char}`,text);};
  useEffect(()=>{
    setSelectedBookmarkStyle(shelfBookmark ? shelfBookmark.style ?? 'normal' : bookmarkStyle ?? book.bookmarkStyle ?? 'normal');
  },[bookmarkStyle,book.bookmarkStyle,shelfBookmark?.style,!!shelfBookmark]);
  useEffect(()=>{
    if(!bookmarkJumpRequest||appliedBookmarkJumpRef.current===bookmarkJumpRequest||loading||!pagesReadyRef.current||editing||nextConfirm||activeBookRef.current!==book.id||shelfBookmark?.bookId!==book.id||!pages.length)return;
    jumpRef.current(pageForAnchor(pagesRef.current,shelfBookmark));
    anchorRef.current={message:shelfBookmark.message,char:shelfBookmark.char};
    appliedBookmarkJumpRef.current=bookmarkJumpRequest;
  },[bookmarkJumpRequest,book.id,shelfBookmark,loading,pages,editing,nextConfirm]);
  async function changeBookmark(anchor:(Anchor & {label?:string})|null){
    if(!onBookmarkChange||bookmarkBusyRef.current||editing)return;
    bookmarkBusyRef.current=true;setBookmarkBusy(true);setEditError('');
    try{await onBookmarkChange(anchor,selectedBookmarkStyle);}catch{setEditError('책갈피를 저장하지 못했어요.');}
    finally{bookmarkBusyRef.current=false;setBookmarkBusy(false);}
  }
  async function chooseBookmarkStyle(next:BookmarkStyle){
    if(bookmarkBusyRef.current)return;
    const previous=selectedBookmarkStyle;
    setSelectedBookmarkStyle(next);
    const update=onBookmarkStyleChange?()=>onBookmarkStyleChange(next):shelfBookmark?.bookId===book.id&&onBookmarkChange?()=>onBookmarkChange({message:shelfBookmark.message,char:shelfBookmark.char,label:shelfBookmark.label},next):null;
    if(!update)return;
    bookmarkBusyRef.current=true;setBookmarkBusy(true);setEditError('');
    try{await update();}catch{setSelectedBookmarkStyle(previous);setEditError('책갈피 모양을 저장하지 못했어요.');}
    finally{bookmarkBusyRef.current=false;setBookmarkBusy(false);}
  }
  function toggleBookmark(index:number){
    if(shelfBookmark){void changeBookmark(null);return;}
    const page=pagesRef.current[index],fragment=page?.fragments[0];
    if(fragment)void changeBookmark({message:fragment.message,char:fragment.char,label:cleanText(fragment.text).slice(0,60)||page.asset?.name||'책갈피'});
  }
  function goBookmark(){
    if(onGoBookmark){onGoBookmark();return;}
    if(shelfBookmark?.bookId===book.id)goToAnchor(shelfBookmark);
  }
  const ribbonIcon=shelfBookmark?.icon??characterIcon??book.characterIcon;
  const ribbonStyle=shelfBookmark ? shelfBookmark.style ?? 'normal' : selectedBookmarkStyle;
  renderLeafRef.current=(page,index,mobile)=><PageLeaf page={page} book={bookRef.current} query={queryRef.current} index={index} mobile={mobile} editing={editing} onEdit={onEdit} drafts={draftsRef.current} onNext={nextVolumeRef.current?()=>requestNextRef.current():undefined} onClose={()=>closeRef.current()}/>;
  useEffect(()=>{if(!onSaveBook&&editing){draftsRef.current.clear();setEditing(false);setLeafRevision(value=>value+1);}},[onSaveBook,editing]);
  function cancelEditing(){draftsRef.current.clear();setEditing(false);setEditError('');setLeafRevision(value=>value+1);}
  async function saveEditing(){
    if(!onSaveBook||saving)return;const source=bookRef.current;
    const patches=new Map<number,{start:number;end:number;text:string}[]>();
    for(const page of pagesRef.current)for(const fragment of page.fragments){const value=draftsRef.current.get(`${fragment.message}:${fragment.char}`);if(value===undefined)continue;const list=patches.get(fragment.message)??[];list.push({start:fragment.char,end:fragment.end,text:value});patches.set(fragment.message,list);}
    const messages=source.messages.map((message,index)=>{let content=message.content;for(const patch of (patches.get(index)??[]).sort((a,b)=>b.start-a.start))content=content.slice(0,patch.start)+patch.text+content.slice(patch.end);return content===message.content?message:{...message,content};});
    const existingMark=shelfBookmark?.bookId===source.id?shelfBookmark:undefined;
    let adjustedMark:(Anchor & {label?:string})|undefined;
    if(existingMark){let char=existingMark.char;for(const patch of (patches.get(existingMark.message)??[]).sort((a,b)=>a.start-b.start)){if(existingMark.char>=patch.end)char+=patch.text.length-(patch.end-patch.start);else if(existingMark.char>=patch.start)char+=patch.start-existingMark.char;}if(char!==existingMark.char)adjustedMark={message:existingMark.message,char:Math.max(0,char),label:existingMark.label};}
    setSaving(true);setEditError('');try{await onSaveBook({...source,messages,lastPage:pageIndex,updatedAt:new Date().toISOString()});if(adjustedMark&&onBookmarkChange)await onBookmarkChange(adjustedMark,shelfBookmark?.style??selectedBookmarkStyle);draftsRef.current.clear();setEditing(false);setLeafRevision(value=>value+1);}catch{setEditError('저장하지 못했어요. 다시 시도하세요.');}finally{setSaving(false);}
  }
  const activeLeaf=selectedLeaf??pageIndex;
  const activeBookmarked=!!shelfBookmark;
  const togglePanel = (next: Exclude<Panel, null>) => setPanel(value => value === next ? null : next);
  const visibleEnd = Math.min(pages.length, pageIndex + spread);
  const percent = !pages.length?0:pageIndex>=contentCount?100:Math.round(Math.min(1,pageIndex/Math.max(1,contentCount-1))*100);
  const style = { '--reader-font-size': `${fontSize}px` } as CSSProperties;

  return <div ref={readerRef} className={`reader reader-theme-${theme}${theme === 'dark' ? ' dark' : ''}${fullscreen?' reader-fullscreen':''}${editing?' reader-is-editing':''}`} style={style} lang="ko">
    {fullscreen&&<div className="reader-fullscreen-exit"><button aria-label="전체화면 해제" title="전체화면 해제 (Esc)" onClick={()=>void exitFullscreen()}><X size={22}/></button></div>}
    <header className="reader-toolbar">
      <button className="reader-back" onClick={onClose} aria-label="책을 닫고 서재로 돌아가기" title="서재로 돌아가기" disabled={editing||saving}><ChevronLeft size={19} /><span>서재</span></button>
      <div className="reader-toolbar-title"><span>{book.title}</span><small>{book.author || readerCopy.unknownAuthor}</small></div>
      <div className="reader-tools">
        {onSaveBook&&<button className={`reader-icon-button ${editing?'reader-active':''}`} aria-label="본문 편집" title="페이지에서 편집" aria-pressed={editing} disabled={saving} onClick={()=>{if(editing){cancelEditing();return;}setPanel(null);draftsRef.current.clear();setEditError('');setEditing(true);}}><Pencil size={18}/></button>}
        {onBookmarkChange&&<button className={`reader-icon-button ${activeBookmarked?'reader-active':''}`} aria-label={activeBookmarked?'선반 책갈피 제거':'현재 위치에 책갈피'} title={activeBookmarked?'선반 책갈피 제거':'현재 위치에 책갈피'} aria-pressed={activeBookmarked} disabled={editing||saving||bookmarkBusy||loading||(!shelfBookmark&&!pages[activeLeaf]?.fragments.length)} onClick={()=>void toggleBookmark(activeLeaf)}><Bookmark size={18} fill={activeBookmarked?'currentColor':'none'}/></button>}
        <button className="reader-icon-button" aria-label="전체화면" title="전체화면" disabled={editing} onClick={()=>void enterFullscreen()}><Maximize size={18}/></button>
        <button ref={element => { panelButtonRefs.current.contents = element; }} className={`reader-icon-button ${panel === 'contents' ? 'reader-active' : ''}`} aria-label="목차 보기" title="목차" disabled={editing} aria-expanded={panel === 'contents'} aria-controls="reader-contents" onClick={() => togglePanel('contents')}><List size={20} /></button>
        <button ref={element => { panelButtonRefs.current.search = element; }} className={`reader-icon-button ${panel === 'search' ? 'reader-active' : ''}`} aria-label="책 속에서 검색" title="책 속 검색" disabled={editing} aria-expanded={panel === 'search'} aria-controls="reader-search" onClick={() => togglePanel('search')}><Search size={19} /></button>
        <button ref={element => { panelButtonRefs.current.appearance = element; }} className={`reader-icon-button ${panel === 'appearance' ? 'reader-active' : ''}`} aria-label="독서 화면 설정" title="독서 화면 설정" disabled={editing} aria-expanded={panel === 'appearance'} aria-controls="reader-appearance" onClick={() => togglePanel('appearance')}><Type size={21} /></button>
      </div>
    </header>

    <main className="reader-main" aria-label={`${book.title} 읽기`}>
      <div className="reader-stage" ref={stageRef} aria-busy={loading} data-book-closed={pages[pageIndex]?.kind==='back-cover'}>
        <div className="reader-book-mount" ref={mountRef} onPointerDownCapture={event=>{const page=(event.target as HTMLElement).closest<HTMLElement>('[data-reader-page-index]');if(page&&!page.dataset.flipCopy)setSelectedLeaf(Number(page.dataset.readerPageIndex));}}/>
        {shelfBookmark&&<button type="button" data-no-flip className={`reader-floating-ribbon reader-ribbon-${ribbonStyle}${ribbonOffset<=-40?' reader-ribbon-removing':''}`} aria-label={`${shelfBookmark.title} 책갈피로 이동`} title={`${shelfBookmark.title} · 클릭하여 이동, 위로 끌어 제거`} disabled={editing||bookmarkBusy||!paperSize.width} style={{'--ribbon-offset':`${ribbonOffset}px`,'--paper-width':`${paperSize.width}px`,'--paper-height':`${paperSize.height}px`} as CSSProperties}
          onPointerDown={event=>{event.stopPropagation();if(event.button!==0||!event.isPrimary)return;suppressRibbonClickRef.current=false;ribbonDragRef.current={pointerId:event.pointerId,startY:event.clientY,offset:0};event.currentTarget.setPointerCapture(event.pointerId);}}
          onPointerMove={event=>{event.stopPropagation();const drag=ribbonDragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;drag.offset=Math.min(0,event.clientY-drag.startY);if(Math.abs(event.clientY-drag.startY)>6)suppressRibbonClickRef.current=true;setRibbonOffset(drag.offset);}}
          onPointerUp={event=>{event.stopPropagation();const drag=ribbonDragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;ribbonDragRef.current=null;setRibbonOffset(0);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(Math.min(drag.offset,event.clientY-drag.startY)<=-40){suppressRibbonClickRef.current=true;void changeBookmark(null);}}}
          onPointerCancel={event=>{event.stopPropagation();ribbonDragRef.current=null;suppressRibbonClickRef.current=true;setRibbonOffset(0);}}
          onLostPointerCapture={event=>{event.stopPropagation();ribbonDragRef.current=null;setRibbonOffset(0);}}
          onMouseDown={event=>event.stopPropagation()} onMouseUp={event=>event.stopPropagation()} onTouchStart={event=>event.stopPropagation()} onTouchEnd={event=>event.stopPropagation()}
          onClick={event=>{event.stopPropagation();if(suppressRibbonClickRef.current&&event.detail!==0){suppressRibbonClickRef.current=false;return;}goBookmark();}}>
          {ribbonStyle==='character'?<>{ribbonIcon?<img src={ribbonIcon} alt="" draggable={false}/>:<BookOpen size={23}/>}<span>{shelfBookmark.title}</span></>:<Bookmark size={17}/>}<span className="reader-sr-only">위로 끌어 책갈피 제거</span>
        </button>}
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
          <p className="reader-panel-description">이야기 {book.messages.length}개 · 전체 {pages.length}쪽</p>
          <nav className="reader-contents-list" aria-label="이야기 목차">
            <button className="reader-contents-item" onClick={() => { jump(0); setPanel(null); }}><span className="reader-contents-number"><BookOpen size={16} /></span><span><strong>{book.title}</strong><small>책의 처음으로</small></span><span className="reader-contents-page">1</span></button>
            {book.messages.map((message, index) => {
              const page = pageForAnchor(pages, { message: index, char: 0 });
              return <button className={`reader-contents-item ${page <= pageIndex && pageIndex < (index + 1 < book.messages.length ? pageForAnchor(pages, { message: index + 1, char: 0 }) : pages.length) ? 'reader-current-passage' : ''}`} key={index} onClick={() => goToAnchor({ message: index, char: 0 })}>
                <span className="reader-contents-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{speakerName(message)}</strong><small>{message.content.slice(0, 95) || '아직 내용이 없어요'}</small></span><span className="reader-contents-page">{page + 1}</span>
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
          <div className="reader-bookmark-options">{(['normal','character'] as const).map(option=><button key={option} type="button" aria-pressed={selectedBookmarkStyle===option} disabled={bookmarkBusy||!!shelfBookmark&&!onBookmarkStyleChange&&(shelfBookmark.bookId!==book.id||!onBookmarkChange)} onClick={()=>void chooseBookmarkStyle(option)}>{option==='normal'?<Bookmark size={22}/>:ribbonIcon?<img src={ribbonIcon} alt=""/>:<BookOpen size={22}/>}<span>{option==='normal'?'리본':'캐릭터'}</span>{selectedBookmarkStyle===option&&<Check size={14}/>}</button>)}</div>
          <div className="reader-setting-label"><span>글자 크기</span><small>{fontSize}픽셀</small></div>
          <div className="reader-font-control"><button aria-label="글자 작게" disabled={fontSize <= 14} onClick={() => setFontSize(size => Math.max(14, size - 1))}><Minus size={17} /><Type size={15} /></button><span className="reader-font-preview">가나다</span><button aria-label="글자 크게" disabled={fontSize >= 28} onClick={() => setFontSize(size => Math.min(28, size + 1))}><Type size={22} /><Plus size={17} /></button></div>
          <div className="reader-setting-label"><span>책장 색</span></div>
          <div className="reader-theme-options">{(['paper', 'warm', 'dark'] as const).map(option => <button key={option} className={`reader-theme-option reader-swatch-${option}`} onClick={() => setTheme(option)} aria-pressed={theme === option}><span>{option === 'dark' ? <Moon size={19} /> : <Sun size={19} />}{theme === option && <Check size={15} />}</span><strong>{option === 'paper' ? '종이' : option === 'warm' ? '따뜻하게' : '어둡게'}</strong></button>)}</div>
        </>}
      </div>
    </>}
    <div ref={measureRef} className="reader-measure reader-page-content" aria-hidden="true" />
    {nextConfirm&&onNextVolume&&<NextVolumeDialog title={nextVolumeTitle} onClose={()=>setNextConfirm(false)} onConfirm={()=>{setNextConfirm(false);onNextVolume();}}/>}
  </div>;
}

export default Reader;
