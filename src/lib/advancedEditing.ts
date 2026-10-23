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

export type ManuscriptPiece={text:string;message:number|null};
export type Manuscript={text:string;pieces:ManuscriptPiece[];anchors:number[];affinity?:{offset:number;message:number}};
/** One field, with source ownership retained separately from visible text.
 * Separating blank lines are editor layout and never rewrite untouched logs. */
export function createManuscript(book:Book):Manuscript{
 const pieces:ManuscriptPiece[]=[],anchors:number[]=[];let text='';
 book.messages.forEach((message,index)=>{
  if(index){pieces.push({text:'\n\n',message:null});text+='\n\n';}
  anchors.push(text.length);pieces.push({text:message.content,message:index});text+=message.content;
 });
 return {text,pieces,anchors};
}
export function updateManuscript(document:Manuscript,text:string):Manuscript{
 if(text===document.text)return document;
 let start=0,suffix=0;const shared=Math.min(document.text.length,text.length);
 while(start<shared&&document.text[start]===text[start])start++;
 while(suffix<shared-start&&document.text[document.text.length-1-suffix]===text[text.length-1-suffix])suffix++;
 const end=document.text.length-suffix,inserted=text.slice(start,text.length-suffix);
 let cursor=0,owner=0;
 for(let index=0;index<document.anchors.length;index++){if(document.anchors[index]<=start)owner=index;else break;}
 if(document.affinity?.offset===start)owner=document.affinity.message;
 const before:ManuscriptPiece[]=[],after:ManuscriptPiece[]=[];cursor=0;
 for(const piece of document.pieces){
  const next=cursor+piece.text.length;
  if(cursor<start){const value=piece.text.slice(0,Math.min(piece.text.length,start-cursor));if(value)before.push({...piece,text:value});}
  if(next>end){const value=piece.text.slice(Math.max(0,end-cursor));if(value)after.push({...piece,text:value});}
  cursor=next;
 }
 const pieces:ManuscriptPiece[]=[];
 for(const piece of [...before,...(inserted?[{text:inserted,message:owner}]:[]),...after]){
  const last=pieces.at(-1);if(last&&last.message===piece.message)last.text+=piece.text;else pieces.push({...piece});
 }
 const delta=inserted.length-(end-start);
 return {text,pieces,affinity:{offset:start+inserted.length,message:owner},anchors:document.anchors.map(point=>point<=start?point:point>=end?point+delta:start)};
}
export function applyManuscript(book:Book,document:Manuscript,titles:ReadonlyMap<number,string>=new Map()):Book{
 if(document.text===createManuscript(book).text){const drafts=new Map<number,AdvancedMessageDraft>();for(const [index,chapterTitle] of titles)drafts.set(index,{chapterTitle});return applyAdvancedEdits(book,drafts);}
 const contents=book.messages.map(()=> '');
 for(const piece of document.pieces)if(piece.message!==null&&contents[piece.message]!==undefined)contents[piece.message]+=piece.text;
 const drafts=new Map<number,AdvancedMessageDraft>();
 book.messages.forEach((message,index)=>{const content=contents[index],chapterTitle=titles.get(index);if(content!==message.content||chapterTitle!==undefined&&chapterTitle!==message.chapterTitle)drafts.set(index,{content,...(chapterTitle!==undefined?{chapterTitle}:{})});});
 return applyAdvancedEdits(book,drafts);
}
