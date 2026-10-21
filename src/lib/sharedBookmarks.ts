import type {Book,BookBookmark} from './library';
export type SharedBookmark={anchor:BookBookmark|null;style:NonNullable<Book['bookmarkStyle']>};
const key=(shareId:string)=>`galpi.shared-bookmark.v1:${shareId}`;
const styleValid=(style:unknown):style is SharedBookmark['style']=>style==='normal'||style==='image'||style==='character';
export function readSharedBookmark(shareId:string,book:Book):SharedBookmark{
 const fallback:SharedBookmark={anchor:null,style:book.bookmarkStyle??'normal'};
 try{
  const raw=localStorage.getItem(key(shareId));if(!raw||raw.length>5000)return fallback;
  const value=JSON.parse(raw) as Partial<SharedBookmark>;
  const style=styleValid(value.style)?value.style:fallback.style;
  if(!value.anchor)return {anchor:null,style};
  const {message,char,progress}=value.anchor;
  if(!Number.isSafeInteger(message)||message<0||!book.messages[message]||!Number.isSafeInteger(char)||char<0||char>book.messages[message].content.length)return {anchor:null,style};
  return {anchor:{message,char,...(typeof progress==='number'&&Number.isFinite(progress)&&progress>=0&&progress<=1?{progress}:{})},style};
 }catch{return fallback;}
}
/** Reader-only state. This does not modify the publisher's book or call an API. */
export function saveSharedBookmark(shareId:string,value:SharedBookmark){
 localStorage.setItem(key(shareId),JSON.stringify({style:value.style,anchor:value.anchor?{message:value.anchor.message,char:value.anchor.char,...(value.anchor.progress!==undefined?{progress:value.anchor.progress}:{})}:null}));
}
export function sharedBookmarkStorageKey(shareId:string){return key(shareId);}
