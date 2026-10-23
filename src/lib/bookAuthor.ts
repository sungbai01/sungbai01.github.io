import type {Book} from './library';
import {normalizeDisplayPrompt,type DisplayPrompt} from '../../shared/displayPrompt';

// The default prompt is implicit in author credits.
const promptCredits:Record<DisplayPrompt['id'],string>={default:'',soakma:'소악마'};

/** Keep the stored author/model unchanged; compose the reading credit at display time. */
export function bookAuthor(book:Pick<Book,'author'|'aiModel'|'displayPrompt'>,separator=' · '):string{
 const model=book.author?.trim()||book.aiModel?.trim()||'저자 미상';
 const prompt=promptCredits[normalizeDisplayPrompt(book.displayPrompt).id];
 return [model,prompt].filter(Boolean).join(separator);
}
