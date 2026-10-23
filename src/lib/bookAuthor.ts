import type {Book} from './library';

/** Keep the stored author/model unchanged; compose the reading credit at display time. */
export function bookAuthor(book:Pick<Book,'author'|'aiModel'|'displayPrompt'>):string{
 const model=book.author?.trim()||book.aiModel?.trim()||'저자 미상';
 return `${model} · 기본 프롬프트`;
}
