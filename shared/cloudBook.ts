import type {Book,Message} from '../src/lib/library';

/** Positive allowlist shared by client and server. No asset payload fields survive. */
export function cloudBook(book:Book):Book{
 const text=(value:string)=>value.replace(/data:image\/[^\s"'<>)]*/gi,'').replace(/blob:https?:\/\/[^\s"'<>)]*/gi,'');
 const messages:Message[]=book.messages.map(message=>({role:text(message.role),name:text(message.name),content:text(message.content),
  ...(message.chapter!==undefined?{chapter:text(message.chapter)}:{}),...(message.chapterTitle!==undefined?{chapterTitle:text(message.chapterTitle)}:{}),
  ...(message.chapterStart!==undefined?{chapterStart:message.chapterStart}:{}),...(message.pageBreakBefore!==undefined?{pageBreakBefore:message.pageBreakBefore}:{}),...(message.pageBreakAfter!==undefined?{pageBreakAfter:message.pageBreakAfter}:{})}));
 return {id:book.id,title:text(book.title),author:text(book.author),description:text(book.description),color:book.color,createdAt:book.createdAt,updatedAt:book.updatedAt,messages,
  ...(book.aiModel!==undefined?{aiModel:text(book.aiModel)}:{}),...(book.uploadedAt!==undefined?{uploadedAt:book.uploadedAt}:{}),...(book.customColor!==undefined?{customColor:book.customColor}:{}),
  ...(book.seriesId!==undefined?{seriesId:book.seriesId}:{}),...(book.seriesTitle!==undefined?{seriesTitle:text(book.seriesTitle)}:{}),
  ...(book.volumeNumber!==undefined?{volumeNumber:book.volumeNumber}:{}),...(book.volumeCount!==undefined?{volumeCount:book.volumeCount}:{}),...(book.volumePolicy!==undefined?{volumePolicy:book.volumePolicy}:{}),
  ...(book.bookmarks!==undefined?{bookmarks:book.bookmarks.filter(mark=>messages[mark.message]).slice(-1).map(mark=>({message:mark.message,char:Math.min(mark.char,messages[mark.message].content.length),...(mark.label!==undefined?{label:text(mark.label)}:{}),...(mark.progress!==undefined?{progress:mark.progress}:{})}))}:{}),bookmarkStyle:'normal'};
}
