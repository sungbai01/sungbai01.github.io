import type { Book } from './library';
import { cleanText, paginate, pageTextInsets } from './pagination';
import { CURRENT_VOLUME_POLICY, splitBookByPages } from './volumes';
import { imageReferenceRanges } from './assets';
import { systemRanges, visibleProse } from './prose';
import { applyBookDisplayRules } from './displayRules';
import '../components/reader.css';

/** Fixed import layout; reader font/viewport changes never regroup volumes. */
export const IMPORT_PAGE_LAYOUT = { width: 400, height: 650, padding: 32, contentWidth: 336, contentHeight: 432, fontSize: 18 } as const;

export type PrepareBooksOptions = { removeEmoji?: boolean; removeSquareBrackets?: boolean; removeAngleBrackets?: boolean };

function preprocessBook(book: Book, options: PrepareBooksOptions): Book {
  // Known image references are identifiers, not prose. Keep their original
  // spelling (including emoji in an asset name) so image resolution survives.
  const clean = (text: string) => options.removeEmoji !== false ? cleanText(text) : text;
  const strippedContent = (content: string, end = content.length) => {
    const references = imageReferenceRanges(content);
    const segments: { type: 'asset' | 'text'; start: number; end: number }[] = [];
    let cursor = 0;
    for (const range of references) {
      if (range.start > cursor) segments.push({ type: 'text', start: cursor, end: range.start });
      segments.push({ type: 'asset', ...range }); cursor = range.end;
    }
    if (cursor < content.length) segments.push({ type: 'text', start: cursor, end: content.length });
    const hidden = systemRanges(content, references);
    // Scan the complete source before slicing prefixes for bookmark/maps.
    // Even unresolved image identifiers survive so cards can be added later.
    let protectedIndex = 0, squareDepth = 0, squareStart = 0;
    for (let index = 0; index < content.length; index++) {
      while (references[protectedIndex] && references[protectedIndex]!.end <= index) protectedIndex++;
      const reference = references[protectedIndex];
      if (reference && index === reference.start) { index = reference.end - 1; protectedIndex++; continue; }
      if (options.removeSquareBrackets !== false) {
        if (content[index] === '[') { if (!squareDepth) squareStart = index; squareDepth++; }
        else if (content[index] === ']' && squareDepth && --squareDepth === 0) hidden.push({ start: squareStart, end: index + 1 });
      }
      if (options.removeAngleBrackets !== false && content[index] === '<') {
        let quote = '', end = index + 1;
        for (; end < content.length; end++) {
          const char = content[end]!;
          if (quote) { if (char === quote) quote = ''; }
          else if (char === '"' || char === "'") quote = char;
          else if (char === '>') break;
        }
        if (end < content.length) { hidden.push({ start: index, end: end + 1 }); index = end; }
      }
    }
    hidden.sort((left, right) => left.start - right.start || right.end - left.end);
    return segments.map(segment => {
      const limit = Math.min(end, segment.end);
      if (segment.start >= limit) return '';
      if (segment.type === 'asset')return content.slice(segment.start,limit);
      let value = '', cursor = segment.start;
      for (const range of hidden) {
        if (range.end <= cursor || range.start >= limit) continue;
        value += content.slice(cursor, Math.max(cursor, range.start)); cursor = Math.min(limit, range.end);
      }
      return clean(value + content.slice(cursor, limit));
    }).join('');
  };
  return { ...book, title: clean(book.title), author: clean(book.author), description: clean(visibleProse(book.description)),
    messages: book.messages.map(message => ({ ...message, name: clean(message.name), originalContent: message.originalContent ?? message.content,
      content: strippedContent(message.content),
      originalMap: (message.originalMap ?? [{ source: 0, output: 0 }, { source: (message.originalContent ?? message.content).length, output: message.content.length }])
        .map(point => ({ source: point.source, output: strippedContent(message.content, point.output).length })),
      ...(message.chapter === undefined ? {} : { chapter: clean(message.chapter) }) })),
    ...(book.bookmarks === undefined ? {} : { bookmarks: book.bookmarks.map(mark => ({ ...mark,
      char: strippedContent(book.messages[mark.message]?.content ?? '', mark.char).length,
      ...(mark.label === undefined ? {} : { label: clean(mark.label) }) })) }) };
}

/** Call ONLY on new import/text confirmation, never on Reader open, resize,
 * font change or backup restoration. Returns books; does not persist them.
 * Emoji, square-block and angle-tag removal default on, before measurement
 * and bookmark remapping. False retains that category. Image identifiers,
 * including unresolved references, are always protected; curly system prose
 * is still removed. Normal text between HTML tags is retained.
 */
export async function prepareBooks(books: Book[], options: PrepareBooksOptions = {}): Promise<Book[]> {
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
      const ruled = source.displayRules?.length ? await applyBookDisplayRules(source, source.displayRules) : source;
      if (source.volumePolicy === 'chapters-100-v1' || source.volumePolicy === CURRENT_VOLUME_POLICY) { result.push(ruled); continue; }
      const book = preprocessBook(ruled, options);
      result.push(...splitBookByPages(book, paginate(book, measure, { pageHeight: IMPORT_PAGE_LAYOUT.height, contentTop: insets.top })).map(volume => ({ ...volume, volumePolicy: CURRENT_VOLUME_POLICY })));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return result;
  } finally { if (timeout) clearTimeout(timeout); host.remove(); }
}

export default prepareBooks;
