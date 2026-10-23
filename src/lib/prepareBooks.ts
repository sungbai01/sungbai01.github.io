import {beginSkeletonTask} from './loadingActivity';
import type { Book } from './library';
import { paginate, pageTextInsets, PAGE_LAYOUT_VERSION } from './pagination';
import { CURRENT_VOLUME_POLICY, splitBookByPages } from './volumes';
import {resolveDisplayImageReferences} from './displayRules';
import { normalizeDisplayPrompt } from '../../shared/displayPrompt';
import '../components/reader.css';

/** Fixed import layout; reader font/viewport changes never regroup volumes. */
export const IMPORT_PAGE_LAYOUT = { width: 400, height: 650, padding: 32, contentWidth: 336, contentHeight: 463.5, fontSize: 18 } as const;

async function withFixedMeasurement<T>(task:(measure:HTMLDivElement,insets:{top:number;bottom:number})=>Promise<T>):Promise<T> {
  if (typeof document === 'undefined' || !document.body) throw new Error('가져오기 준비는 브라우저에서 사용해 주세요.');
  const host = document.createElement('div');
  host.className = 'reader reader-theme-paper';
  host.setAttribute('aria-hidden', 'true'); host.inert = true;
  Object.assign(host.style, { position: 'fixed', inset: 'auto', top: '0', left: '-100000px', width: '400px', height: '650px',
    visibility: 'hidden', pointerEvents: 'none', display: 'block', overflow: 'hidden' });
  host.style.setProperty('--reader-font-size', '18px'); host.style.setProperty('--reader-page-padding', '32px');
  host.style.setProperty('--paper-height', '650px');
  const insets = pageTextInsets(IMPORT_PAGE_LAYOUT.height, IMPORT_PAGE_LAYOUT.fontSize);
  host.style.setProperty('--reader-content-top', `${insets.top}px`);
  host.style.setProperty('--reader-content-bottom', `${insets.bottom}px`);
  const measure = document.createElement('div'); measure.className = 'reader-measure reader-page-content';
  measure.style.setProperty('--paper-height', '650px');
  Object.assign(measure.style, { width: '336px', height: `${IMPORT_PAGE_LAYOUT.height - insets.top - insets.bottom}px`, fontSize: '18px', padding: '0', boxSizing: 'content-box' });
  host.append(measure); document.body.append(host);
  const finishLoading=beginSkeletonTask('pagination');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Request the actual prose/name faces before awaiting readiness. Bound this
    // so an unavailable web font cannot leave import confirmation hanging.
    if (document.fonts) {
      const faces = Promise.allSettled([document.fonts.load('18px "Gowun Batang"'), document.fonts.load('600 10px "Noto Sans KR"')]);
      await Promise.race([faces.then(() => document.fonts.ready), new Promise<void>(resolve => { timeout = setTimeout(resolve, 2500); })]);
      if (timeout) clearTimeout(timeout);
    }
    return await task(measure,insets);
  } finally { finishLoading();if (timeout) clearTimeout(timeout); host.remove(); }
}

/** Counts body leaves only: no preprocessing, splitting, bookmark remapping or storage. */
export async function measureBookPageCount(book:Book):Promise<number>{
  return withFixedMeasurement(async(measure,insets)=>paginate({...book,imageReferences:await resolveDisplayImageReferences(book)},measure,{pageHeight:IMPORT_PAGE_LAYOUT.height,contentTop:insets.top}).length);
}
/** Measure and split source messages without rewriting text or applying display rules. */
export async function prepareBooks(books:Book[]):Promise<Book[]>{
  return withFixedMeasurement(async(measure,insets)=>{
    const result: Book[] = [];
    for (const source of books) {
      // Already prepared volumes keep their grouping if a caller submits them
      // again. Canonical imports bypass this API to preserve all content.
      const book = {...source,seriesId:source.seriesId??source.id,seriesTitle:source.seriesTitle??source.title,volumeNumber:source.volumeNumber??1,volumeCount:source.volumeCount??1,displayPrompt: normalizeDisplayPrompt(source.displayPrompt)};
      const displayBook={...book,imageReferences:await resolveDisplayImageReferences(book)};
      if (source.volumePolicy === 'chapters-100-v1' || source.volumePolicy === CURRENT_VOLUME_POLICY) { result.push({...book,pageCount:paginate(displayBook,measure,{pageHeight:IMPORT_PAGE_LAYOUT.height,contentTop:insets.top}).length,pageLayoutVersion:PAGE_LAYOUT_VERSION}); continue; }
      const volumes=splitBookByPages(book,paginate(displayBook,measure,{pageHeight:IMPORT_PAGE_LAYOUT.height,contentTop:insets.top}));
      for(const volume of volumes){
        // A continuation volume may gain a heading/parity leaf at its new start.
        const pageCount=volumes.length>1?await measureBookPageCount(volume):volume.pageCount!;
        result.push({...volume,pageCount,pageLayoutVersion:PAGE_LAYOUT_VERSION,volumePolicy:CURRENT_VOLUME_POLICY});
        if(volumes.length>1)await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return result;
  });
}

export default prepareBooks;
