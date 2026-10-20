import type { Book } from './library';

export const MAX_VOLUME_PAGES = 100;

/** Storage/import must wait for actual pagination before splitting. */
export function splitBookForStorage(book: Book): Book[] { return [book]; }

export type ChapterStart = { message: number; char: number };

/** Source offsets, including headings inside a message; speakers are irrelevant. */
export function chapterStarts(book: Book): ChapterStart[] {
  const starts: ChapterStart[] = [];
  let previousChapter: string | undefined;
  book.messages.forEach((message, index) => {
    const offsets = new Set<number>();
    if (message.chapter?.trim()) {
      if (message.chapter !== previousChapter) offsets.add(0);
      previousChapter = message.chapter;
    }
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

/** Prefer the last chapter-start page within 100 measured pages. A chapter
 * beginning inside a page moves that whole page to the next volume, preserving
 * every source offset. Long chapters fall back to exactly 100 measured pages.
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
        if (previousMessage === fragment.message) messages[messages.length - 1]!.content += content;
        else messages.push({ ...source, content });
        previousMessage = fragment.message;
        sourceChar = fragment.end;
        if (sourceChar === source.content.length) { sourceMessage++; sourceChar = 0; }
      }
    }
    const volumeNumber = index + 1;
    return {
      ...book,
      id: index === 0 ? book.id : `${book.id}--part-${volumeNumber}`,
      title: `${seriesTitle} · ${volumeNumber}권`, seriesId, seriesTitle,
      volumeNumber, volumeCount: ranges.length, messages,
      volumePolicy: 'chapters-100-v1',
      ...(book.lastPage === undefined ? {} : {
        lastPage: Math.max(0, Math.min(end - start - 1, book.lastPage - start)),
      }),
    };
  });
  if (sourceMessage !== book.messages.length || sourceChar !== 0) {
    throw new RangeError('Measured pages must cover every source message completely.');
  }
  return volumes;
}

/** Collapse each explicitly identified series before remeasurement. Keep the
 * first volume's ID/book metadata and every message (including empty messages).
 * Progress cannot be mapped until measured again, so restart at page zero.
 * Persist via repackSeries, passing the removed sibling IDs as obsoleteIds.
 */
export function mergeLegacyVolumes(books: Book[]): Book[] {
  return groupBooks(books).map(({ books: siblings }) => {
    const first = siblings[0]!;
    if (siblings.length === 1) return first;
    return {
      ...first, title: first.seriesTitle ?? first.title,
      volumeNumber: 1, volumeCount: 1, lastPage: 0,
      messages: siblings.flatMap(book => book.messages.map(message => ({ ...message }))),
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
