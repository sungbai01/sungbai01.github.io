import type { Book, BookAsset } from './library';
import { extractAssetSegments, imageReferenceRanges, type AssetSegment } from './assets';
import { systemRanges, visibleProse } from './prose';

export type Anchor = { message: number; char: number };
export type Fragment = Anchor & { end: number; name: string; text: string; hidden?: boolean; chapter?: number };
export type PaperPage = { fragments: Fragment[]; intro: boolean; asset?: BookAsset; chapter?: number; kind?: 'paper' | 'asset' | 'padding' | 'endpaper' | 'back-cover' | 'end' };

export const CHAPTER_HEADER_RATIO = .25;

/** Two extra lines above/below prose; keep room for short mobile chapters. */
export function pageTextInsets(height: number, fontSize: number): { top: number; bottom: number } {
  const top = height < 300 ? 22 : 36;
  const bottom = height < 300 ? 32 : 56;
  const line = fontSize * 1.75;
  const extra = Math.max(0, Math.min(line * 2, (height * (1 - CHAPTER_HEADER_RATIO) - top - bottom - line * 2) / 2));
  return { top: top + extra, bottom: bottom + extra };
}

/** Only contiguous, nonblank explicit chapter IDs group messages together. */
export function startsChapter(book: Book, index: number): boolean {
  if (index < 0 || index >= book.messages.length) return false;
  if (index === 0) return true;
  const chapter = book.messages[index]!.chapter?.trim();
  return !chapter || chapter !== book.messages[index - 1]!.chapter?.trim();
}

export function chapterNumber(book: Book, messageIndex: number): number {
  if (messageIndex < 0 || messageIndex >= book.messages.length) return 0;
  let number = 0;
  for (let index = 0; index <= messageIndex; index++) if (startsChapter(book, index)) number++;
  return number;
}

export interface PaginationOptions { pageHeight?: number; contentTop?: number }

/** Removes complete emoji sequences, leaving ordinary digits and punctuation.
 * This changes offsets: use at import confirmation, before pagination, or for
 * display only. Never use its output to infer positions in the original text.
 */
export function cleanText(text: string): string {
  return text.replace(/[#*0-9]\uFE0F?\u20E3|[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?|\p{Emoji_Modifier}/gu, '');
}

export function speakerName(message: Book['messages'][number]): string {
  const roles: Record<string, string> = { user: '독자', assistant: '이야기', system: '안내', developer: '설정', tool: '도구', narrator: '서술자' };
  return message.name || roles[message.role] || '서술자';
}

/** Render the same small Markdown subset as Reader, via text nodes only. */
function measureText(target: HTMLElement, text: string): void {
  const prose = visibleProse(text);
  const visible = target.classList.contains('reader-chapter-opening') ? prose.trimStart() : prose;
  const parts = visible.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|“[^”]+”|「[^」]+」)/g);
  target.replaceChildren();
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      const node = document.createElement('strong'); node.textContent = part.slice(2, -2); target.append(node);
    } else if (/^[*_]/.test(part) && part.length > 2) {
      const node = document.createElement('em'); node.textContent = part.slice(1, -1); target.append(node);
    } else if (/^[“「]/.test(part)) {
      const node = document.createElement('span'); node.className = 'reader-dialogue'; node.textContent = part; target.append(node);
    } else target.append(document.createTextNode(part));
  }
}

/** Pure source partitioning plus DOM measurement; never saves or splits books.
 * Fragment text is always the exact original slice, including raw asset tokens.
 * Physical-left leaves have zero-based even indexes, including padding pages.
 * Emoji retained at import remain visible/measured; this function never strips.
 */
export function paginate(book: Book, measure: HTMLDivElement, options: PaginationOptions = {}): PaperPage[] {
  const originalHeight = measure.style.height;
  const baseHeight = measure.clientHeight;
  const normalTop = options.contentTop ?? (baseHeight < 246 ? 22 : 36);
  const cssHeight = parseFloat(measure.style.getPropertyValue('--paper-height') || measure.style.getPropertyValue('--reader-page-height'));
  const physicalHeight = options.pageHeight ?? (Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : baseHeight + normalTop + (baseHeight < 246 ? 32 : 56));
  // Reader places prose below the quarter-page header PLUS its usual top
  // inset; subtract the full physical reservation from the base text height.
  const chapterHeight = Math.max(1, baseHeight - physicalHeight * CHAPTER_HEADER_RATIO);
  const pages: PaperPage[] = [{ fragments: [], intro: false }];
  let current = pages[0]!;
  let number = 0;
  let pendingHeading = false;
  measure.replaceChildren();
  const nextPage = () => { current = { fragments: [], intro: false }; pages.push(current); measure.replaceChildren(); measure.style.height = `${baseHeight}px`; };
  try {
  book.messages.forEach((message, messageIndex) => {
    if (startsChapter(book, messageIndex)) {
      number++; pendingHeading = true;
      if (current.fragments.length) nextPage();
    }
    const content = message.content || '', name = speakerName(message);
    const extracted = extractAssetSegments(content, book.assets ?? [],book.imageRules??[]);
    const references = imageReferenceRanges(content);
    const unresolved = references.filter(range => !extracted.some(segment => segment.type === 'asset' && segment.start === range.start && segment.end === range.end));
    const hiddenRanges: { start: number; end: number }[] = [];
    for (const range of [...systemRanges(content, references), ...unresolved].sort((a, b) => a.start - b.start)) {
      const previous = hiddenRanges[hiddenRanges.length - 1];
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else hiddenRanges.push({ ...range });
    }
    // Partition system ranges atomically, retaining every source character in
    // hidden fragments for volume slicing and bookmark offsets. Protected image
    // references can interrupt a system block without exposing its suffix.
    const segments = extracted.flatMap<AssetSegment & { hidden?: boolean }>(segment => {
      if (segment.type === 'asset') return [segment];
      const pieces: { type: 'text'; text: string; start: number; end: number; hidden?: boolean }[] = [];
      let cursor = segment.start;
      for (const range of hiddenRanges) {
        const start = Math.max(segment.start, range.start), end = Math.min(segment.end, range.end);
        if (end <= start) continue;
        if (cursor < start) pieces.push({ type: 'text', text: content.slice(cursor, start), start: cursor, end: start });
        pieces.push({ type: 'text', text: content.slice(start, end), start, end, hidden: true }); cursor = end;
      }
      if (cursor < segment.end) pieces.push({ type: 'text', text: content.slice(cursor, segment.end), start: cursor, end: segment.end });
      return pieces;
    });
    if (!content.length) { current.fragments.push({ message: messageIndex, char: 0, end: 0, name, text: '', hidden: true }); return; }
    for (const segment of segments) {
      if (segment.type === 'text' && 'hidden' in segment && segment.hidden) {
        current.fragments.push({ message: messageIndex, char: segment.start, end: segment.end, name,
          text: content.slice(segment.start, segment.end), hidden: true });
        continue;
      }
      if (segment.type === 'asset') {
        if (current.fragments.length && current.kind !== 'asset') nextPage();
        if ((pages.length - 1) % 2 === 1) { current.kind = 'padding'; nextPage(); }
        current.kind = 'asset'; current.asset = segment.asset;
        current.fragments.push({ message: messageIndex, char: segment.start, end: segment.end, name, text: content.slice(segment.start, segment.end) });
        nextPage(); continue;
      }
      if (!visibleProse(content.slice(segment.start, segment.end)).trim()) {
        current.fragments.push({ message: messageIndex, char: segment.start, end: segment.end, name,
          text: content.slice(segment.start, segment.end), hidden: true });
        continue;
      }
      let offset = segment.start;
      while (offset < segment.end) {
        const heading = pendingHeading;
        if (heading) { current.chapter = number; measure.style.height = `${chapterHeight}px`; }
        const section = document.createElement('section'); section.className = 'reader-fragment';
        const paragraph = document.createElement('p'); paragraph.className = heading ? 'reader-prose reader-chapter-opening' : 'reader-prose';
        if (heading) paragraph.style.textIndent = '1em';
        section.append(paragraph); measure.append(section);
        const fits = (end: number) => { measureText(paragraph, content.slice(offset, end)); return measure.scrollHeight <= measure.clientHeight; };
        let low = offset, high = Math.min(segment.end, offset + 256), upperFits = fits(high);
        while (upperFits && high < segment.end) { low = high; high = Math.min(segment.end, offset + (high - offset) * 2); upperFits = fits(high); }
        let end = high;
        if (!upperFits) {
          while (low < high) { const mid = Math.ceil((low + high) / 2); if (fits(mid)) low = mid; else high = mid - 1; }
          end = low;
          if (end > offset && /[\uD800-\uDBFF]/.test(content.charAt(end - 1))) end--;
          if (end === offset) {
            section.remove();
            if (current.fragments.some(fragment => !fragment.hidden)) { if (heading) delete current.chapter; nextPage(); continue; }
            end = offset + (content.codePointAt(offset)! > 0xffff ? 2 : 1); measure.append(section);
          } else {
            const tail = content.slice(offset, end), boundary = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf(' '), tail.lastIndexOf('\t'));
            if (boundary > tail.length * .72) end = offset + boundary + 1;
          }
          measureText(paragraph, content.slice(offset, end));
        }
        current.fragments.push({ message: messageIndex, char: offset, end, name, text: content.slice(offset, end), ...(heading ? { chapter: number } : {}) });
        pendingHeading = false;
        offset = end;
        if (offset < segment.end) nextPage();
      }
    }
  });
  if (pages.length > 1 && !current.fragments.length && current.kind !== 'asset') pages.pop();
  return pages;
  } finally { measure.style.height = originalHeight; measure.replaceChildren(); }
}
