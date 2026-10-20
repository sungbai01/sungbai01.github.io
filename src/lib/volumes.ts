import type { Book } from './library';

export const MAX_VOLUME_PAGES = 60;
/** Conservative UTF-16 code-unit budget, matching string.length and DOM offsets. */
export const MAX_VOLUME_CHARACTERS = 10000;
export const MAX_VOLUME_MESSAGES = 100;

/** Bound initial DOM pagination work on load/import/restore, before measuring.
 * The caller splices these parts into the series, relabels all siblings, and
 * persists that full series with replaceBookWithVolumes in one transaction.
 * Titles/numbers are provisional. Page offsets cannot be migrated without
 * measurement, so split parts start at page zero; the caller chooses the route.
 */
export function splitBookForStorage(book: Book): Book[] {
  const characters = book.messages.reduce((total, message) => total + message.content.length, 0);
  if (characters <= MAX_VOLUME_CHARACTERS && book.messages.length <= MAX_VOLUME_MESSAGES) return [book];

  const groups: Book['messages'][] = [];
  let messages: Book['messages'] = [];
  let used = 0;
  const flush = () => {
    if (messages.length) groups.push(messages);
    messages = [];
    used = 0;
  };
  for (const source of book.messages) {
    let offset = 0;
    // Empty messages still consume a message slot and retain their metadata.
    do {
      if (messages.length === MAX_VOLUME_MESSAGES || used === MAX_VOLUME_CHARACTERS) flush();
      let end = Math.min(source.content.length, offset + MAX_VOLUME_CHARACTERS - used);
      // Do not introduce an unpaired surrogate when slicing a Unicode pair.
      if (end > offset && end < source.content.length &&
          /[\uD800-\uDBFF]/.test(source.content.charAt(end - 1)) &&
          /[\uDC00-\uDFFF]/.test(source.content.charAt(end))) end--;
      if (end === offset && offset < source.content.length) {
        flush();
        continue;
      }
      messages.push({ ...source, content: source.content.slice(offset, end) });
      used += end - offset;
      offset = end;
    } while (offset < source.content.length);
  }
  flush();

  const seriesId = book.seriesId ?? book.id;
  const seriesTitle = book.seriesTitle ?? book.title;
  return groups.map((messages, index) => ({
    ...book,
    id: index === 0 ? book.id : `${book.id}--part-${index + 1}`,
    title: `${seriesTitle} · ${index + 1}권`,
    seriesId,
    seriesTitle,
    volumeNumber: index + 1,
    volumeCount: groups.length,
    messages,
    lastPage: 0,
  }));
}

type MeasuredPage = {
  fragments: { message: number; char: number; end: number; text: string; name: string }[];
  intro: boolean;
};

/** Split measured pages without normalizing source text or speaker metadata.
 * The caller persists the returned books; this helper has no storage effects.
 */
export function splitBookByPages(book: Book, pages: MeasuredPage[]): Book[] {
  if (pages.length <= MAX_VOLUME_PAGES) return [book];

  const seriesId = book.seriesId ?? book.id;
  const seriesTitle = book.seriesTitle ?? book.title;
  const volumeCount = Math.ceil(pages.length / MAX_VOLUME_PAGES);
  const volumes: Book[] = [];
  let sourceMessage = 0;
  let sourceChar = 0;

  for (let start = 0; start < pages.length; start += MAX_VOLUME_PAGES) {
    const volumePages = pages.slice(start, start + MAX_VOLUME_PAGES);
    const messages: Book['messages'] = [];
    let previousMessage = -1;
    for (const page of volumePages) {
      for (const fragment of page.fragments) {
        const source = book.messages[fragment.message];
        // Reject incomplete/stale pagination rather than persist missing text.
        if (!source || fragment.message !== sourceMessage || fragment.char !== sourceChar ||
            !Number.isSafeInteger(fragment.end) || fragment.end < fragment.char || fragment.end > source.content.length) {
          throw new RangeError('Measured pages must cover source messages in order without gaps or overlaps.');
        }
        const content = source.content.slice(fragment.char, fragment.end);
        if (previousMessage === fragment.message) messages[messages.length - 1]!.content += content;
        else messages.push({ ...source, content });
        previousMessage = fragment.message;
        sourceChar = fragment.end;
        if (sourceChar === source.content.length) {
          sourceMessage++;
          sourceChar = 0;
        }
      }
    }
    const volumeNumber = volumes.length + 1;
    volumes.push({
      ...book,
      id: volumeNumber === 1 ? book.id : `${book.id}--part-${volumeNumber}`,
      title: `${seriesTitle} · ${volumeNumber}권`,
      seriesId,
      seriesTitle,
      volumeNumber,
      volumeCount,
      messages,
      ...(book.lastPage === undefined ? {} : {
        lastPage: Math.max(0, Math.min(volumePages.length - 1, book.lastPage - start)),
      }),
    });
  }
  if (sourceMessage !== book.messages.length || sourceChar !== 0) {
    throw new RangeError('Measured pages must cover every source message completely.');
  }
  return volumes;
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
