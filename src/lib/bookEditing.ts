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
export function editedMessages(book:Book,drafts:Map<string,string>,chapterDrafts:Map<number,ChapterDraft>,insertions:ChapterInsertion[],fragments:Fragment[]){
 const patches=new Map<number,{start:number;end:number;text:string}[]>();
 const seen=new Set<string>();
 for(const fragment of fragments){
  const key=fragmentKey(fragment),value=drafts.get(key);
  if(value===undefined||seen.has(key))continue;
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
 book.messages.forEach((source,index)=>{
  let content=source.content;
  for(const patch of [...(patches.get(index)??[])].reverse())content=content.slice(0,patch.start)+patch.text+content.slice(patch.end);
  const chapterPatch=chapterDrafts.get(index);
  const boundaries=insertions.filter(entry=>entry.fragment.message===index).map(entry=>({
   char:Math.min(content.length,mapChar(index,entry.fragment.char)+entry.offset),title:entry.chapterTitle,
  })).sort((a,b)=>a.char-b.char);
  const atStart=boundaries.find(entry=>entry.char===0);
  const pieces=[{char:0,title:atStart?atStart.title:chapterPatch?.chapterTitle??source.chapterTitle,first:!atStart},...boundaries.filter(entry=>entry.char>0).map(entry=>({...entry,first:false}))];
  for(let part=0;part<pieces.length;part++){
   const start=pieces[part]!,end=pieces[part+1]?.char??content.length;
   if(part&&start.char===pieces[part-1]!.char)continue;
   const chapterStart=start.first?(chapterPatch?.chapterStart??startsChapter(book,index)):true;
   const raw=content.slice(start.char,end),leading=chapterStart?(/^(?:[\t ]*(?:\r\n?|\n))+/.exec(raw)?.[0].length??0):0;
   const text=raw.slice(leading),changed=content!==source.content||boundaries.length>0||leading>0;
   ranges.push({message:index,start:start.char,end,target:messages.length,leading});
   messages.push({...source,...chapterPatch,content:text,chapterStart,chapterTitle:start.title,
    ...(changed?{originalContent:text,originalMap:undefined}:{})});
  }
 });
 // Strip only chapter-tail whitespace. Interior paragraph spacing is retained.
 let tail=-1;
 let blankTails:number[]=[];
 for(let index=0;index<=messages.length;index++){
  if(index===messages.length||messages[index]!.chapterStart){
   if(tail>=0){const message=messages[tail]!;const content=message.content.trimEnd();if(content!==message.content)messages[tail]={...message,content,originalContent:content,originalMap:undefined};}
   for(const blank of blankTails)messages[blank]={...messages[blank]!,content:'',originalContent:'',originalMap:undefined};
   tail=-1;blankTails=[];
  }
  if(index<messages.length&&messages[index]!.content.trim()){tail=index;blankTails=[];}
  else if(index<messages.length)blankTails.push(index);
 }
 const mapAnchor=(anchor:Anchor):Anchor=>{
  const char=mapChar(anchor.message,anchor.char);
  const candidates=ranges.filter(range=>range.message===anchor.message);
  const range=[...candidates].reverse().find(range=>char>=range.start)??candidates[0];
  return range?{message:range.target,char:Math.max(0,Math.min(char-range.start-range.leading,messages[range.target]!.content.length))}:anchor;
 };
 return {messages,mapAnchor};
}
