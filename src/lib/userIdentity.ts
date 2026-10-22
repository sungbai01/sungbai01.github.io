import type {Book} from './library';

export const DEFAULT_USER_NAME = '{{user}}';

/** Import-only aliases are deliberately never attached to the returned book.
 * userName is the replacement identity, so future rename UI needs no old name.
 */
export function replaceBookUserName(book:Book, aliases:string[], chosen:string):Book {
 const userName=chosen.trim().slice(0,80)||DEFAULT_USER_NAME;
 const names=[...new Set([...aliases,book.userName??DEFAULT_USER_NAME].map(name=>name.trim()).filter(name=>name&&name!==userName))].sort((a,b)=>b.length-a.length);
 const expression=names.length?new RegExp(names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g'):undefined;
 const replace=(text:string)=>expression?text.replace(expression,()=>userName):text;
 const position=(text:string,offset:number)=>{
  if(!expression)return offset;
  let shift=0;
  for(const match of text.matchAll(expression)){
   const start=match.index!;if(offset<=start)break;
   if(offset<start+match[0].length)return start+shift+Math.min(offset-start,userName.length);
   shift+=userName.length-match[0].length;
  }
  return offset+shift;
 };
 const optional=(text:string|undefined)=>text===undefined?undefined:replace(text);
 const messages=book.messages.map(message=>({...message,
  name:message.role==='user'?userName:replace(message.name),content:replace(message.content),
  originalContent:optional(message.originalContent),
  originalMap:message.originalMap?.map(point=>({source:position(message.originalContent??message.content,point.source),output:position(message.content,point.output)})),
  chapter:optional(message.chapter),chapterTitle:optional(message.chapterTitle),
 }));
 return {...book,userName,messages,title:replace(book.title),author:replace(book.author),description:replace(book.description),
  seriesTitle:optional(book.seriesTitle),aiModel:optional(book.aiModel),
  assets:book.assets?.map(asset=>({...asset,name:replace(asset.name)})),
  imageRules:book.imageRules?.map(rule=>({...rule,pattern:replace(rule.pattern),assetTemplates:rule.assetTemplates.map(replace)})),
  displayRules:book.displayRules?.map(rule=>({...rule,pattern:replace(rule.pattern),replacement:replace(rule.replacement)})),
  bookmarks:book.bookmarks?.map(mark=>({...mark,label:optional(mark.label),char:position(book.messages[mark.message]?.content??'',mark.char)})),
 };
}
