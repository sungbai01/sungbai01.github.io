import type { Book } from './library';
import { cleanText, paginate } from './pagination';
import { splitBookByPages } from './volumes';
import { extractAssetSegments } from './assets';
import '../components/reader.css';

/** Fixed import layout; reader font/viewport changes never regroup volumes. */
export const IMPORT_PAGE_LAYOUT = { width: 400, height: 650, padding: 32, contentWidth: 336, contentHeight: 558, fontSize: 18 } as const;

function removeBookEmoji(book: Book): Book {
  // Known image references are identifiers, not prose. Keep their original
  // spelling (including emoji in an asset name) so image resolution survives.
  const strippedContent = (content: string, end = content.length) => extractAssetSegments(content, book.assets ?? []).map(segment => {
    const slice = content.slice(segment.start, Math.min(end, segment.end));
    return segment.start >= end ? '' : segment.type === 'asset' ? slice : cleanText(slice);
  }).join('');
  return { ...book, title: cleanText(book.title), author: cleanText(book.author), description: cleanText(book.description),
    messages: book.messages.map(message => ({ ...message, name: cleanText(message.name), content: strippedContent(message.content),
      ...(message.chapter === undefined ? {} : { chapter: cleanText(message.chapter) }) })),
    ...(book.bookmarks === undefined ? {} : { bookmarks: book.bookmarks.map(mark => ({ ...mark,
      char: strippedContent(book.messages[mark.message]?.content ?? '', mark.char).length,
      ...(mark.label === undefined ? {} : { label: cleanText(mark.label) }) })) }) };
}

/** Call ONLY on new import/text confirmation, never on Reader open, resize,
 * font change or backup restoration. Returns books; does not persist them.
 * Default emoji removal happens before measurement and bookmark remapping.
 * Passing false retains every message byte and source offset.
 */
export async function prepareBooks(books: Book[], options: { removeEmoji?: boolean } = {}): Promise<Book[]> {
  if (typeof document === 'undefined' || !document.body) throw new Error('가져오기 준비는 브라우저에서 사용해 주세요.');
  const host = document.createElement('div');
  host.className = 'reader reader-theme-paper';
  host.setAttribute('aria-hidden', 'true'); host.inert = true;
  Object.assign(host.style, { position: 'fixed', inset: 'auto', top: '0', left: '-100000px', width: '400px', height: '650px',
    visibility: 'hidden', pointerEvents: 'none', display: 'block', overflow: 'hidden' });
  host.style.setProperty('--reader-font-size', '18px'); host.style.setProperty('--reader-page-padding', '32px');
  const measure = document.createElement('div'); measure.className = 'reader-measure reader-page-content';
  Object.assign(measure.style, { width: '336px', height: '558px', fontSize: '18px', padding: '0', boxSizing: 'content-box' });
  host.append(measure); document.body.append(host);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Request the actual prose/name faces before awaiting readiness. Bound this
    // so an unavailable web font cannot leave import confirmation hanging.
    if (document.fonts) {
      const faces = Promise.allSettled([document.fonts.load('18px "Gowun Batang"'), document.fonts.load('600 10px "Noto Sans KR"')]);
      await Promise.race([faces.then(() => document.fonts.ready), new Promise<void>(resolve => { timeout = setTimeout(resolve, 2500); })]);
      if (timeout) clearTimeout(timeout);
    }
    const result: Book[] = [];
    for (const source of books) {
      // Already prepared volumes keep their grouping if a caller submits them
      // again. Backup restores must bypass this API to preserve all content.
      if (source.volumePolicy === 'chapters-100-v1') { result.push(source); continue; }
      const book = options.removeEmoji === false ? source : removeBookEmoji(source);
      result.push(...splitBookByPages(book, paginate(book, measure)).map(volume => ({ ...volume, volumePolicy: 'chapters-100-v1' as const })));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return result;
  } finally { if (timeout) clearTimeout(timeout); host.remove(); }
}

export default prepareBooks;
