import type {Book} from './library';

/** Import-time removal; remaining source text and metadata stay unchanged. */
export function removeUserInputs(book:Book,userNames:string[]=[]):Book{
 const names=new Set(userNames.map(name=>name.trim()).filter(Boolean));
 const kept=book.messages.map((message,index)=>({message,index})).filter(({message})=>!['user','human'].includes(message.role.toLowerCase())&&!(message.role==='unknown'&&names.has(message.name.trim())));
 if(kept.length===book.messages.length)return book;
 if(!kept.some(({message})=>message.content.trim()))throw new Error('유저 입력을 제외한 뒤 저장할 본문이 없어요.');
 const indexes=new Map(kept.map(({index},next)=>[index,next]));
 const messages=kept.map(({message})=>message);
 return {...book,messages,description:messages.find(message=>message.content.trim())!.content.replace(/\s+/g,' ').slice(0,160),
  ...(book.bookmarks?{bookmarks:book.bookmarks.flatMap(mark=>{const message=indexes.get(mark.message);if(message===undefined)return [];const {progress:_progress,...rest}=mark;return [{...rest,message}];})}:{}),
  ...(book.imageReferences?{imageReferences:book.imageReferences.flatMap(reference=>{const message=indexes.get(reference.message);return message===undefined?[]:[{...reference,message}];})}:{})};
}
