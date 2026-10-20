import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PageFlip } from '../vendor/page-flip/PageFlip';
import { SizeType } from '../vendor/page-flip/Settings';
import { FlipCorner } from '../vendor/page-flip/Flip/Flip';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, List, Minus, Moon, Pencil, Plus, Search, Sun, Type, X } from 'lucide-react';
import BookEditor from './BookEditor';
import type { Book } from '../lib/library';
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
}

type Anchor = { message: number; char: number };
type Fragment = Anchor & { end: number; name: string; text: string };
type PaperPage = { fragments: Fragment[]; intro: boolean };
type Panel = 'contents' | 'search' | 'appearance' | null;
type Theme = 'paper' | 'warm' | 'dark';
type SearchHit = Anchor & { length: number; excerpt: string; name: string };
type ReaderPreferences = { theme: Theme; fontSize: number };

const PREFERENCES_KEY = 'galpi.reader.appearance.v1';
const readerCopy = {
  opening: '갈피에 담아 둔 이야기',
  unknownAuthor: '지은이 미상',
  continued: ' · 계속',
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

function PageContent({ page, book, query }: { page: PaperPage; book: Book; query: string }) {
  return <>
    {page.intro && <div className="reader-opening">
      <span className="reader-eyebrow">{readerCopy.opening}</span>
      <h1>{book.title}</h1>
      <p>{book.author || readerCopy.unknownAuthor}</p>
      <span className="reader-opening-rule" />
    </div>}
    {page.fragments.map(fragment => <section className="reader-fragment" key={`${fragment.message}:${fragment.char}`}>
      <div className="reader-message-name">{fragment.name}{fragment.char > 0 ? readerCopy.continued : ''}</div>
      <p className="reader-prose"><Highlight text={fragment.text} query={query} /></p>
    </section>)}
    {!book.messages.length && <p className="reader-prose reader-empty-copy">아직 담긴 이야기가 없어요.</p>}
  </>;
}

/** Measures the same blocks and typography used by the visible React pages. */
export function paginate(book: Book, measure: HTMLDivElement): PaperPage[] {
  const pages: PaperPage[] = [{ fragments: [], intro: true }];
  let current = pages[0];
  const opening = document.createElement('div');
  opening.className = 'reader-opening';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'reader-eyebrow';
  eyebrow.textContent = readerCopy.opening;
  const title = document.createElement('h1');
  title.textContent = book.title;
  const author = document.createElement('p');
  author.textContent = book.author || readerCopy.unknownAuthor;
  const rule = document.createElement('span');
  rule.className = 'reader-opening-rule';
  opening.append(eyebrow, title, author, rule);
  measure.replaceChildren(opening);
  // An unusually long title must never consume space needed for the actual text.
  if (measure.scrollHeight > measure.clientHeight * 0.65) {
    current.intro = false;
    measure.replaceChildren();
  }
  const nextPage = () => {
    current = { fragments: [], intro: false };
    pages.push(current);
    measure.replaceChildren();
  };
  book.messages.forEach((message, messageIndex) => {
    const content = message.content || '';
    const name = speakerName(message);
    let offset = 0;
    let emptyPending = content.length === 0;
    while (offset < content.length || emptyPending) {
      const section = document.createElement('section');
      section.className = 'reader-fragment';
      const label = document.createElement('div');
      label.className = 'reader-message-name';
      label.textContent = name + (offset > 0 ? readerCopy.continued : '');
      const paragraph = document.createElement('p');
      paragraph.className = 'reader-prose';
      section.append(label, paragraph);
      measure.append(section);
      const fits = (end: number) => {
        paragraph.textContent = content.slice(offset, end);
        return measure.scrollHeight <= measure.clientHeight;
      };
      // Probe only one page's worth of text. Laying out the entire remaining
      // message on every page made a single huge message quadratic in length.
      let low = offset;
      let high = Math.min(content.length,offset+256);
      let upperFits=fits(high);
      while(upperFits&&high<content.length){low=high;high=Math.min(content.length,offset+(high-offset)*2);upperFits=fits(high);}
      let end = high;
      if (!upperFits) {
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (fits(middle)) low = middle;
          else high = middle - 1;
        }
        end = low;
        // Avoid cutting a Unicode surrogate pair in half.
        if (end > offset && /[\uD800-\uDBFF]/.test(content.charAt(end - 1))) end--;
        if (end === offset) {
          section.remove();
          if (current.fragments.length || current.intro) { nextPage(); continue; }
          // Even at extreme viewport sizes, advance by a complete code point.
          end = offset + (content.codePointAt(offset)! > 0xffff ? 2 : 1);
          measure.append(section);
        } else {
          const tail = content.slice(offset, end);
          const boundary = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf(' '), tail.lastIndexOf('\t'));
          if (boundary > tail.length * 0.72) end = offset + boundary + 1;
        }
        paragraph.textContent = content.slice(offset, end);
      }
      current.fragments.push({ message: messageIndex, char: offset, end, name, text: content.slice(offset, end) });
      offset = end;
      emptyPending = false;
      if (offset < content.length) nextPage();
    }
  });
  return pages;
}

export function Reader({ book, onClose, onProgress, onSplit, onNextVolume, nextVolumeTitle, onSaveBook }: ReaderProps) {
  const [editing,setEditing]=useState(false);
  const editingRef=useRef(false);editingRef.current=editing;
  const [initialPreferences] = useState(readReaderPreferences);
  const [theme, setTheme] = useState<Theme>(initialPreferences.theme);
  const [fontSize, setFontSize] = useState(initialPreferences.fontSize);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState<PaperPage[]>([]);
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
  const contentKey = useMemo(() => ({ title: book.title, author: book.author, messages: book.messages }),
    [book.title, book.author, book.messages]);

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
    const refresh = () => { if (alive) setFontRevision(value => value + 1); };
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
      const width = Math.max(120, Math.min(540, Math.floor((dimensions.width - 16) / count)));
      const height = Math.max(300, Math.min(790, dimensions.height - 18));
      const padding = width < 350 ? 22 : width < 440 ? 32 : 46;
      const measure = measureRef.current;
      measure.style.width = `${width - padding * 2}px`;
      measure.style.height = `${height - 132}px`;
      measure.style.fontSize = `${fontSize}px`;
      const nextPages = paginate(currentBook, measure);
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
      pagesRef.current = nextPages;
      const target = anchorRef.current ? pageForAnchor(nextPages, anchorRef.current)
        : clamp(Math.floor(Number.isFinite(currentBook.lastPage) ? currentBook.lastPage! : 0), 0, nextPages.length - 1);
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
        element.setAttribute('data-density', 'soft');
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
              entry.root.render(<div className="reader-paper-shell"><div className="reader-running-head">{currentBook.title}</div><div className="reader-page-content"><PageContent page={nextPages[number]} book={currentBook} query={queryRef.current}/></div><div className="reader-page-number">{number+1}</div></div>);
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
        renderWindow(safe);
        if (saveAnchor) anchorRef.current = nextPages[safe].fragments[0] ?? { message: 0, char: 0 };
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
          clickEventForward: false, showPageCorners: true, disableFlipByClick: false,
        });
        // Publish progress after the curl settles, not while it is drawing.
        instance.on('flip', event => { if (!cancelled) report(Number(event.data)); });
        instance.on('changeState',event=>{
          if(event.data==='read'&&queuedTurnRef.current){
            const direction=queuedTurnRef.current;queuedTurnRef.current=null;
            queuedFrame=requestAnimationFrame(()=>{if(!cancelled)turnRef.current(direction);});
          }
        });
        instance.loadFromHTML(nodes);
        flipRef.current = instance;
        report(instance.getCurrentPageIndex(), !anchorRef.current);
      } catch {
        setError('책장 넘기기를 사용할 수 없어요. 화면을 스크롤해 계속 읽어 주세요.');
        host.classList.add('reader-flip-fallback');
        report(target, false);
      }
      setPages(nextPages);
      setSpread(count);
      setLoading(false);
    });
    return () => {
      cancelled = true;
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
  }, [book.id, contentKey, dimensions.width, dimensions.height, fontSize, fontRevision,splitRevision]);

  // Highlighting does not repaginate: marks have exactly the same font metrics.
  useEffect(() => {
    const currentBook = bookRef.current;
    mountedPagesRef.current.forEach(({root}, index) => {
      const page = pagesRef.current[index];
      if (!page) return;
      root.render(<div className="reader-paper-shell">
        <div className="reader-running-head">{currentBook.title}</div>
        <div className="reader-page-content"><PageContent page={page} book={currentBook} query={deferredQuery} /></div>
        <div className="reader-page-number">{index + 1}</div>
      </div>);
    });
  }, [deferredQuery, pages]);

  const jump = (page: number) => {
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
    if (!flip) return;
    // Corner hover isn't a committed turn. Let buttons override it immediately.
    if(flip.getState()==='flipping'||flip.getState()==='user_fold'){queuedTurnRef.current=direction;return;}
    if(direction==='next'&&flip.getCurrentPageIndex()+spread>=pagesRef.current.length&&nextVolumeRef.current){nextVolumeRef.current();return;}
    if (direction === 'previous') flip.flipPrev(FlipCorner.BOTTOM);
    else flip.flipNext(FlipCorner.BOTTOM);
  };
  const turnRef = useRef(turn);
  const jumpRef = useRef(jump);
  turnRef.current = turn;
  jumpRef.current = jump;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if(editingRef.current)return;
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        if (panel) { setPanel(null); panelButtonRefs.current[panel]?.focus(); }
        else closeRef.current();
        return;
      }
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey || panel) return;
      if (['ArrowRight', 'PageDown', ' ', 'ArrowLeft', 'PageUp', 'Home', 'End'].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) turnRef.current('next');
      if (event.key === 'ArrowLeft' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) turnRef.current('previous');
      if (event.key === 'Home') jumpRef.current(0);
      if (event.key === 'End') jumpRef.current(pagesRef.current.length - 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [panel]);

  useEffect(() => {
    if (panel === 'search') searchRef.current?.focus();
    else if (panel) panelRef.current?.focus();
  }, [panel]);

  const togglePanel = (next: Exclude<Panel, null>) => setPanel(value => value === next ? null : next);
  const visibleEnd = Math.min(pages.length, pageIndex + spread);
  const percent = pages.length <= 1 ? (pages.length ? 100 : 0) : Math.round(pageIndex / (pages.length - 1) * 100);
  const style = { '--reader-font-size': `${fontSize}px` } as CSSProperties;

  return <div className={`reader reader-theme-${theme}${theme === 'dark' ? ' dark' : ''}`} style={style} lang="ko">
    <header className="reader-toolbar">
      <button className="reader-back" onClick={onClose} aria-label="책을 닫고 서재로 돌아가기" title="서재로 돌아가기"><ChevronLeft size={19} /><span>서재</span></button>
      <div className="reader-toolbar-title"><span>{book.title}</span><small>{book.author || readerCopy.unknownAuthor}</small></div>
      <div className="reader-tools">
        {onSaveBook&&<button className="reader-icon-button" aria-label="본문 편집" title="본문 편집" onClick={()=>{setPanel(null);setEditing(true);}}><Pencil size={18}/></button>}
        <button ref={element => { panelButtonRefs.current.contents = element; }} className={`reader-icon-button ${panel === 'contents' ? 'reader-active' : ''}`} aria-label="목차 보기" title="목차" aria-expanded={panel === 'contents'} aria-controls="reader-contents" onClick={() => togglePanel('contents')}><List size={20} /></button>
        <button ref={element => { panelButtonRefs.current.search = element; }} className={`reader-icon-button ${panel === 'search' ? 'reader-active' : ''}`} aria-label="책 속에서 검색" title="책 속 검색" aria-expanded={panel === 'search'} aria-controls="reader-search" onClick={() => togglePanel('search')}><Search size={19} /></button>
        <button ref={element => { panelButtonRefs.current.appearance = element; }} className={`reader-icon-button ${panel === 'appearance' ? 'reader-active' : ''}`} aria-label="독서 화면 설정" title="독서 화면 설정" aria-expanded={panel === 'appearance'} aria-controls="reader-appearance" onClick={() => togglePanel('appearance')}><Type size={21} /></button>
      </div>
    </header>

    <main className="reader-main" aria-label={`${book.title} 읽기`}>
      <div className="reader-stage" ref={stageRef} aria-busy={loading}>
        <div className="reader-book-mount" ref={mountRef} />
        {loading && <div className="reader-loading" role="status"><BookOpen size={25} /><span>읽던 곳을 펼치고 있어요…</span></div>}
      </div>
      {error && <p className="reader-error" role="status">{error}</p>}
      <div className="reader-turn-controls">
        <button className="reader-icon-button" aria-label="이전 쪽" title="이전 쪽 (←)" disabled={loading || pageIndex === 0 || !!error} onClick={() => turn('previous')}><ArrowLeft size={20} /></button>
        <button className="reader-icon-button" aria-label={visibleEnd>=pages.length&&onNextVolume?'다음 권':'다음 쪽'} title={visibleEnd>=pages.length&&onNextVolume?nextVolumeTitle:'다음 쪽 (→)'} disabled={loading || (visibleEnd >= pages.length&&!onNextVolume) || !!error} onClick={() => visibleEnd>=pages.length&&onNextVolume?onNextVolume():turn('next')}><ArrowRight size={20} /></button>
      </div>
    </main>

    <footer className="reader-footer">
      <div className="reader-progress-label"><span>{pages.length ? `전체 ${pages.length}쪽 중 ${pageIndex + 1}${visibleEnd > pageIndex + 1 ? `–${visibleEnd}` : ''}쪽` : '책장을 준비하고 있어요'}</span><span>{percent}% 읽음</span></div>
      <input className="reader-progress" type="range" min={0} max={Math.max(0, pages.length - 1)} value={Math.min(pageIndex, Math.max(0, pages.length - 1))} disabled={loading || pages.length < 2} onChange={event => jump(Number(event.target.value))} aria-label="읽는 위치 이동" aria-valuetext={pages.length ? `전체 ${pages.length}쪽 중 ${pageIndex + 1}쪽` : '책장을 준비하고 있어요'} style={{ '--reader-progress': `${percent}%` } as CSSProperties} />
      <span className="reader-sr-only" aria-live="polite">{!loading && `전체 ${pages.length}쪽 중 ${pageIndex + 1}쪽`}</span>
    </footer>

    {panel && <>
      <button className="reader-panel-backdrop" aria-label="독서 패널 닫기" onClick={() => setPanel(null)} tabIndex={-1} />
      <div className={`reader-panel reader-panel-${panel}`} ref={panelRef} tabIndex={-1} role="region" aria-labelledby="reader-panel-title" id={`reader-${panel}`}>
        <div className="reader-panel-heading"><h2 id="reader-panel-title">{panel === 'contents' ? '목차' : panel === 'search' ? '책 속 검색' : '편안한 독서를 위해'}</h2><button className="reader-icon-button" aria-label="패널 닫기" onClick={() => { setPanel(null); panelButtonRefs.current[panel]?.focus(); }}><X size={18} /></button></div>
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
          <div className="reader-setting-label"><span>글자 크기</span><small>{fontSize}픽셀</small></div>
          <div className="reader-font-control"><button aria-label="글자 작게" disabled={fontSize <= 14} onClick={() => setFontSize(size => Math.max(14, size - 1))}><Minus size={17} /><Type size={15} /></button><span className="reader-font-preview">가나다</span><button aria-label="글자 크게" disabled={fontSize >= 28} onClick={() => setFontSize(size => Math.min(28, size + 1))}><Type size={22} /><Plus size={17} /></button></div>
          <div className="reader-setting-label"><span>책장 색</span></div>
          <div className="reader-theme-options">{(['paper', 'warm', 'dark'] as const).map(option => <button key={option} className={`reader-theme-option reader-swatch-${option}`} onClick={() => setTheme(option)} aria-pressed={theme === option}><span>{option === 'dark' ? <Moon size={19} /> : <Sun size={19} />}{theme === option && <Check size={15} />}</span><strong>{option === 'paper' ? '종이' : option === 'warm' ? '따뜻하게' : '어둡게'}</strong></button>)}</div>
        </>}
      </div>
    </>}
    <div ref={measureRef} className="reader-measure reader-page-content" aria-hidden="true" />
    {editing&&onSaveBook&&<BookEditor book={book} messageIndex={pagesRef.current[pageIndex]?.fragments[0]?.message??0} onSave={onSaveBook} onClose={()=>setEditing(false)}/>}
  </div>;
}

export default Reader;
