import type { Book, Message } from './library';

export type AdvancedMessageDraft = { content?: string; chapterTitle?: string };

const clamp = (value: number, length: number) => Math.max(0, Math.min(length, Number.isFinite(value) ? Math.trunc(value) : 0));

/** UTF-16 offsets, matching textarea selections and stored bookmarks.
 * Keep the unchanged prefix/suffix exact; clamp positions in replaced text.
 * Linear time and constant space even for a whole pasted chapter. */
export function createOffsetMapper(before: string, after: string): (offset: number) => number {
  let prefix = 0, suffix = 0;
  const shared = Math.min(before.length, after.length);
  while (prefix < shared && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  while (suffix < shared - prefix && before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)) suffix++;
  return offset => {
    const position = clamp(offset, before.length);
    if (position < prefix) return position;
    if (position >= before.length - suffix) return clamp(position + after.length - before.length, after.length);
    return Math.min(position, after.length - suffix);
  };
}

/** No mutation or normalization: whitespace, assets, names and unknown metadata survive. */
export function applyAdvancedEdits(book: Book, drafts: ReadonlyMap<number, AdvancedMessageDraft>, now = new Date().toISOString()): Book {
  const changed = new Map<number, Message>();
  const mappers = new Map<number, (offset: number) => number>();
  for (const [index, draft] of drafts) {
    const source = book.messages[index];
    if (!Number.isInteger(index) || !source) throw new Error('수정할 메시지를 찾지 못했어요.');
    const content = draft.content ?? source.content;
    const chapterTitle = draft.chapterTitle ?? source.chapterTitle;
    if (content === source.content && (chapterTitle ?? '') === (source.chapterTitle ?? '')) continue;
    const message = { ...source, content };
    if (draft.chapterTitle !== undefined) message.chapterTitle = chapterTitle;
    delete message.originalContent;
    delete message.originalMap;
    changed.set(index, message);
    if (content !== source.content) mappers.set(index, createOffsetMapper(source.content, content));
  }
  if (!changed.size) return book;
  const messages = book.messages.map((message, index) => changed.get(index) ?? message);
  const lengthChanged = [...changed].some(([index, message]) => message.content.length !== book.messages[index].content.length);
  const bookmarks = book.bookmarks?.map(mark => {
    const mapper = mappers.get(mark.message);
    if (!mapper && !lengthChanged) return mark;
    const next = { ...mark, char: mapper ? mapper(mark.char) : mark.char };
    // Progress describes the old pagination, including marks in other messages.
    if (lengthChanged) delete next.progress;
    return next;
  });
  return { ...book, messages, ...(bookmarks ? { bookmarks } : {}), updatedAt: now };
}
