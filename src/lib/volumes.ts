import type { Book } from './library';
import { startsChapter } from './pagination';
import { originalOffset } from './displayRules';

export const MAX_VOLUME_PAGES = 200;
export const CURRENT_VOLUME_POLICY = 'chapters-200-v1' as const;

/** Storage/import must wait for actual pagination before splitting. */
export function splitBookForStorage(book: Book): Book[] { return [book]; }

export type ChapterStart = { message: number; char: number };

/** Source offsets, including headings inside a message; speakers are irrelevant. */
export function chapterStarts(book: Book): ChapterStart[] {
  const starts: ChapterStart[] = [];
  book.messages.forEach((message, index) => {
    const offsets = new Set<number>();
    if (startsChapter(book, index)) offsets.add(0);
    const headings = /^(?:#{1,3}[ \t]+\S[^\r\n]*|제[ \t]*[0-9０-９]+[ \t]*장[^\r\n]*|Chapter[ \t]+[0-9]+\b[^\r\n]*)/gim;
    for (const match of message.content.matchAll(headings)) offsets.add(match.index!);
    for (const char of [...offsets].sort((a, b) => a - b)) starts.push({ message: index, char });
  });
  return starts;
}

type MeasuredPage = {
  fragments: { message: number; char: number; end: number; text: string; name: string }[];
  intro: boolean;
};

/** Prefer the last chapter-start page within 200 measured pages. A chapter
 * beginning inside a page moves that whole page to the next volume, preserving
 * every source offset. Long chapters fall back to exactly 200 measured pages.
 */
export function splitBookByPages(book: Book, pages: MeasuredPage[]): Book[] {
  if (pages.length <= MAX_VOLUME_PAGES) return [book];
  const starts = chapterStarts(book);
  const boundaries = new Set<number>();
  let nextStart = 0;
  pages.forEach((page, index) => {
    for (const fragment of page.fragments) {
      while (nextStart < starts.length) {
        const start = starts[nextStart]!;
        if (start.message > fragment.message ||
            (start.message === fragment.message && start.char >= fragment.end && fragment.end > fragment.char)) break;
        if (start.message === fragment.message && start.char >= fragment.char &&
            (start.char < fragment.end || start.char === fragment.char)) boundaries.add(index);
        nextStart++;
      }
    }
  });
  const ranges: { start: number; end: number }[] = [];
  for (let start = 0; start < pages.length;) {
    let end = Math.min(start + MAX_VOLUME_PAGES, pages.length);
    if (end < pages.length) {
      for (let boundary = end; boundary > start; boundary--) {
        if (boundaries.has(boundary)) { end = boundary; break; }
      }
    }
    ranges.push({ start, end });
    start = end;
  }
  const seriesId = book.seriesId ?? book.id;
  const seriesTitle = book.seriesTitle ?? book.title;
  let sourceMessage = 0;
  let sourceChar = 0;
  const volumes = ranges.map(({ start, end }, index): Book => {
    const messages: Book['messages'] = [];
    const spans: { source: number; start: number; end: number; local: number }[] = [];
    let previousMessage = -1;
    for (const page of pages.slice(start, end)) {
      for (const fragment of page.fragments) {
        const source = book.messages[fragment.message];
        if (!source || fragment.message !== sourceMessage || fragment.char !== sourceChar ||
            !Number.isSafeInteger(fragment.end) || fragment.end < fragment.char || fragment.end > source.content.length ||
            (fragment.end === fragment.char && source.content.length > 0)) {
          throw new RangeError('Measured pages must cover source messages in order without gaps or overlaps.');
        }
        const content = source.content.slice(fragment.char, fragment.end);
        if (previousMessage === fragment.message) {
          messages[messages.length - 1]!.content += content;
          spans[spans.length - 1]!.end = fragment.end;
        } else {
          messages.push({ ...source, content });
          spans.push({ source: fragment.message, start: fragment.char, end: fragment.end, local: messages.length - 1 });
        }
        previousMessage = fragment.message;
        sourceChar = fragment.end;
        if (sourceChar === source.content.length) { sourceMessage++; sourceChar = 0; }
      }
    }
    const volumeNumber = index + 1;
    for (const span of spans) {
      const source = book.messages[span.source]!;
      if (source.originalContent === undefined) continue;
      const start = originalOffset(source, span.start), end = span.end === source.content.length ? source.originalContent.length : originalOffset(source, span.end);
      const target = messages[span.local]!;
      target.originalContent = source.originalContent.slice(start, end);
      target.originalMap = [{ source: 0, output: 0 }, ...(source.originalMap ?? []).filter(point => point.source > start && point.source < end && point.output >= span.start && point.output <= span.end)
        .map(point => ({ source: point.source - start, output: point.output - span.start })), { source: end - start, output: span.end - span.start }];
    }
    return {
      ...book,
      id: index === 0 ? book.id : `${book.id}--part-${volumeNumber}`,
      title: `${seriesTitle} · ${volumeNumber}권`, seriesId, seriesTitle,
      volumeNumber, volumeCount: ranges.length, messages,
      ...(book.assets === undefined ? {} : { assets: book.assets.map(asset => ({ ...asset })) }),
      ...(book.bookmarks === undefined ? {} : { bookmarks: book.bookmarks.flatMap(mark => {
        const span = spans.find(span => span.source === mark.message && mark.char >= span.start &&
          (mark.char < span.end || (mark.char === span.end && span.end === book.messages[span.source]!.content.length)));
        const { progress: _progress, ...anchor } = mark;
        return span ? [{ ...anchor, message: span.local, char: mark.char - span.start }] : [];
      }) }),
      volumePolicy: CURRENT_VOLUME_POLICY,
    };
  });
  if (sourceMessage !== book.messages.length || sourceChar !== 0) {
    throw new RangeError('Measured pages must cover every source message completely.');
  }
  return volumes;
}

/** Collapse each explicitly identified series before remeasurement. Keep the
 * first volume's ID/book metadata and every message (including empty messages).
 * Persist via repackSeries, passing the removed sibling IDs as obsoleteIds.
 */
export function mergeLegacyVolumes(books: Book[]): Book[] {
  return groupBooks(books).map(({ books: siblings }) => {
    const first = siblings[0]!;
    if (siblings.length === 1) return first;
    let messageOffset = 0;
    const bookmarks: NonNullable<Book['bookmarks']> = [];
    const assets = new Map<string, NonNullable<Book['assets']>[number]>();
    for (const sibling of siblings) {
      for (const mark of sibling.bookmarks ?? []) {
        const { progress: _progress, ...anchor } = mark;
        bookmarks.push({ ...anchor, message: mark.message + messageOffset });
      }
      for (const asset of sibling.assets ?? []) if (!assets.has(asset.id)) assets.set(asset.id, { ...asset });
      messageOffset += sibling.messages.length;
    }
    return {
      ...first, title: first.seriesTitle ?? first.title,
      volumeNumber: 1, volumeCount: 1,
      messages: siblings.flatMap(book => book.messages.map(message => ({ ...message }))),
      ...(siblings.some(book => book.assets !== undefined) ? { assets: [...assets.values()] } : {}),
      ...(siblings.some(book => book.bookmarks !== undefined) ? { bookmarks } : {}),
      ...(siblings.some(book => book.backCover !== undefined) ? { backCover: first.backCover ?? siblings.find(book => book.backCover)?.backCover } : {}),
      ...(siblings.some(book => book.characterIcon !== undefined) ? { characterIcon: first.characterIcon ?? siblings.find(book => book.characterIcon)?.characterIcon } : {}),
      ...(siblings.some(book => book.bookmarkStyle !== undefined) ? { bookmarkStyle: first.bookmarkStyle ?? siblings.find(book => book.bookmarkStyle)?.bookmarkStyle } : {}),
      ...(siblings.some(book => book.customColor !== undefined) ? { customColor: first.customColor ?? siblings.find(book => book.customColor)?.customColor } : {}),
    };
  });
}

/** Preserve shelf group order and sort each series numerically without mutating input. */
export function groupBooks(books: Book[]): { id: string; title: string; books: Book[] }[] {
  const groups = new Map<string, { id: string; title: string; books: Book[] }>();
  for (const book of books) {
    const id = book.seriesId ?? book.id;
    let group = groups.get(id);
    if (!group) {
      group = { id, title: book.seriesTitle ?? book.title, books: [] };
      groups.set(id, group);
    }
    group.books.push(book);
  }
  for (const group of groups.values()) {
    group.books.sort((a, b) => (a.volumeNumber ?? 1) - (b.volumeNumber ?? 1));
  }
  return [...groups.values()];
}
