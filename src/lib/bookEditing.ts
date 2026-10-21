import type {Book, Message} from './library';
import {startsChapter} from './pagination';
import type {Anchor,Fragment} from './pagination';

export type ChapterDraft={chapterTitle?:string;chapterStart?:boolean};
export type ChapterInsertion={id:string;fragment:Fragment;offset:number;chapterTitle?:string};
export const chapterLabel=(number:number,title?:string)=>title?.trim()&&!/^(?:CHAPTER\s*)?\d+$/i.test(title.trim())?title.trim():`CHAPTER ${String(number).padStart(2,'0')}`;
export const fragmentKey=(fragment:Fragment)=>`${fragment.message}:${fragment.char}`;

/** Apply fragment drafts once, then split at the new chapter boundaries.
 * The returned mapper preserves bookmarks and the reader anchor through both
 * text replacement and changes to message indexes. Nothing is saved here. */
export type PageInsertion={id:string;before:Anchor;fragment:Fragment;after?:boolean};
export function editedMessages(book:Book,drafts:Map<string,string>,chapterDrafts:Map<number,ChapterDraft>,insertions:ChapterInsertion[],fragments:Fragment[],pageInsertions:PageInsertion[]=[],trimEdges=true){
 const patches=new Map<number,{start:number;end:number;text:string}[]>(),seen=new Set<string>();
 for(const fragment of fragments){
  const key=fragmentKey(fragment),value=drafts.get(key);
  if(fragment.message<0||value===undefined||seen.has(key))continue;
  seen.add(key);const list=patches.get(fragment.message)??[];
  list.push({start:fragment.char,end:fragment.end,text:value});patches.set(fragment.message,list);
 }
 for(const list of patches.values())list.sort((a,b)=>a.start-b.start);
 const mapChar=(message:number,char:number)=>{
  let delta=0;
  for(const patch of patches.get(message)??[]){
   if(char>=patch.end)delta+=patch.text.length-(patch.end-patch.start);
   else if(char>=patch.start)return patch.start+delta+Math.min(char-patch.start,patch.text.length);
   else break;
  }
  return char+delta;
 };
 const messages:Message[]=[],ranges:{message:number;start:number;end:number;target:number;leading:number}[]=[];
 const emit=(source:Message,sourceIndex:number,start:number,end:number,text:string,chapterStart:boolean,title?:string)=>{
  const leading=trimEdges&&chapterStart?(/^(?:[\t ]*(?:\r\n?|\n))+/.exec(text)?.[0].length??0):0;
  const content=text.slice(leading);
  ranges.push({message:sourceIndex,start,end,target:messages.length,leading});
  const original=start===0&&end===source.content.length&&content===source.content?{}:{originalContent:content,originalMap:undefined};
  messages.push({...source,content,chapterStart,chapterTitle:title,...original});
 };
 const emitPage=(page:PageInsertion)=>{
  const content=drafts.get(fragmentKey(page.fragment))??'';
  const chapters=insertions.filter(entry=>entry.fragment.message===page.fragment.message).sort((a,b)=>a.offset-b.offset);
  const cuts=[...new Set([0,content.length,...chapters.map(entry=>Math.min(content.length,entry.offset))])].sort((a,b)=>a-b);
  const first=messages.length;
  for(let index=0;index<cuts.length;index++){
   const start=cuts[index]!,end=cuts[index+1]??content.length,chapter=chapters.find(entry=>entry.offset===start);
   if(start===end&&content.length&&!chapter)continue;
   emit({role:'assistant',name:page.fragment.name,content:''},page.fragment.message,start,end,content.slice(start,end),!!chapter,chapter?.chapterTitle);
  }
  if(messages.length===first)emit({role:'assistant',name:page.fragment.name,content:''},page.fragment.message,0,0,'',false);
  messages[first]!.pageBreakBefore=true;messages[messages.length-1]!.pageBreakAfter=true;
 };
 book.messages.forEach((source,index)=>{
  let content=source.content;
  for(const patch of [...(patches.get(index)??[])].reverse())content=content.slice(0,patch.start)+patch.text+content.slice(patch.end);
  const chapterPatch=chapterDrafts.get(index);
  const chapters=insertions.filter(entry=>entry.fragment.message===index).map(entry=>({char:Math.min(content.length,mapChar(index,entry.fragment.char)+entry.offset),title:entry.chapterTitle}));
  const sheets=pageInsertions.filter(page=>page.before.message===index).map(page=>({char:Math.min(content.length,mapChar(index,page.before.char)),page}));
  const cuts=[...new Set([0,content.length,...chapters.map(entry=>entry.char),...sheets.map(entry=>entry.char)])].sort((a,b)=>a-b);
  if(!content.length&&sheets.length&&sheets.every(entry=>entry.page.after)){
   emit(source,index,0,0,'',chapterPatch?.chapterStart??startsChapter(book,index),chapterPatch?.chapterTitle??source.chapterTitle);
   for(const sheet of sheets)emitPage(sheet.page);
   return;
  }
  const first=messages.length;
  for(let part=0;part<cuts.length;part++){
   const start=cuts[part]!,end=cuts[part+1]??content.length,chapter=chapters.find(entry=>entry.char===start);
   for(const sheet of sheets.filter(entry=>entry.char===start))emitPage(sheet.page);
   if(start===end&&content.length&&!chapter)continue;
   const begins=!!chapter||start===0&&(chapterPatch?.chapterStart??startsChapter(book,index));
   const title=chapter?chapter.title:start===0?(chapterPatch?.chapterTitle??source.chapterTitle):undefined;
   emit({...source,pageBreakBefore:start===0?source.pageBreakBefore:undefined,pageBreakAfter:end===content.length?source.pageBreakAfter:undefined},index,start,end,content.slice(start,end),begins,title);
  }
  if(messages.length===first)emit(source,index,0,0,'',chapterPatch?.chapterStart??startsChapter(book,index),chapterPatch?.chapterTitle??source.chapterTitle);
 });
 // Edge cleanup is deferred while typing so Enter can flow to a new leaf.
 if(trimEdges){
 let tail=-1;let blankTails:number[]=[];
 for(let index=0;index<=messages.length;index++){
  if(index===messages.length||messages[index]!.chapterStart){
   if(tail>=0){const message=messages[tail]!,content=message.content.trimEnd();if(content!==message.content)messages[tail]={...message,content,originalContent:content,originalMap:undefined};}
   for(const blank of blankTails)messages[blank]={...messages[blank]!,content:'',originalContent:'',originalMap:undefined};
   tail=-1;blankTails=[];
  }
  if(index<messages.length&&messages[index]!.content.trim()){tail=index;blankTails=[];}
  else if(index<messages.length)blankTails.push(index);
 }
 }
 const locate=(message:number,char:number):Anchor=>{
  const candidates=ranges.filter(range=>range.message===message);
  const range=[...candidates].reverse().find(range=>char>=range.start)??candidates[0];
  return range?{message:range.target,char:Math.max(0,Math.min(char-range.start-range.leading,messages[range.target]!.content.length))}:{message,char};
 };
 const mapAnchor=(anchor:Anchor):Anchor=>locate(anchor.message,mapChar(anchor.message,anchor.char));
 const mapDraftOffset=(fragment:Fragment,offset:number):Anchor=>locate(fragment.message,mapChar(fragment.message,fragment.char)+offset);
 return {messages,mapAnchor,mapDraftOffset};
}
