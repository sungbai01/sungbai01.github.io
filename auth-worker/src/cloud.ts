import {cloudBook} from '../../shared/cloudBook';
import type {Book} from '../../src/lib/library';

type Statement={bind:(...values:unknown[])=>Statement;first:<T>()=>Promise<T|null>;all:<T>()=>Promise<{results:T[]}>;run:()=>Promise<{meta:{changes:number}}>};
export type TextDatabase={prepare:(sql:string)=>Statement};
type Row={revision:number;deleted:number;body:string|null;updated_at:number};
const maxBytes=1_500_000;
const accountBytes=100_000_000;
const accountBooks=1000;
class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(message='책 데이터 형식이 올바르지 않아요.'):never=>{throw new ApiError(400,message);};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const idValid=(value:unknown):value is string=>typeof value==='string'&&/^[^\s/\\\u0000-\u001f]{1,160}$/.test(value);
function keys(value:Record<string,unknown>,allowed:string[]){if(Object.keys(value).some(key=>!allowed.includes(key)))fail('허용하지 않는 데이터가 포함되어 있어요. 이미지는 저장하지 않아요.');}
function text(value:unknown,max:number){if(typeof value!=='string'||value.length>max||/data:image\/|blob:https?:\/\//i.test(value))fail();}
function date(value:unknown){text(value,40);if(!Number.isFinite(Date.parse(value as string)))fail();}
function validate(value:unknown,id:string):Book{
 if(!object(value))fail();
 const b=value as Record<string,unknown>;
 keys(b,['id','title','author','description','color','createdAt','uploadedAt','updatedAt','messages','aiModel','customColor','seriesId','seriesTitle','volumeNumber','volumeCount','volumePolicy','bookmarks','bookmarkStyle']);
 if(b.id!==id)fail();
 text(b.title,2000);text(b.author,2000);text(b.description,10000);date(b.createdAt);date(b.updatedAt);
 if(typeof b.color!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(b.color))fail();
 if(b.customColor!==undefined&&(typeof b.customColor!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(b.customColor)))fail();
 if(b.uploadedAt!==undefined)date(b.uploadedAt);
 for(const key of ['aiModel','seriesTitle'])if(b[key]!==undefined)text(b[key],2000);
 if(b.seriesId!==undefined&&!idValid(b.seriesId))fail();
 for(const key of ['volumeNumber','volumeCount'])if(b[key]!==undefined&&(!Number.isSafeInteger(b[key])||(b[key] as number)<1||(b[key] as number)>100000))fail();
 if(b.volumePolicy!==undefined&&!['chapters-100-v1','chapters-200-v1'].includes(b.volumePolicy as string))fail();
 if(b.bookmarkStyle!==undefined&&b.bookmarkStyle!=='normal')fail();
 if(!Array.isArray(b.messages)||b.messages.length>20000)fail();
 let characters=0;
 for(const message of b.messages as unknown[]){
  if(!object(message))fail();const m=message as Record<string,unknown>;
  keys(m,['role','name','content','chapter','chapterTitle','chapterStart','pageBreakBefore','pageBreakAfter']);
  text(m.role,100);text(m.name,2000);text(m.content,400000);characters+=(m.content as string).length;
  for(const key of ['chapter','chapterTitle'])if(m[key]!==undefined)text(m[key],2000);
  for(const key of ['chapterStart','pageBreakBefore','pageBreakAfter'])if(m[key]!==undefined&&typeof m[key]!=='boolean')fail();
 }
 if(characters>400000)fail('한 권의 텍스트가 저장 한도를 초과했어요.');
 if(b.bookmarks!==undefined){
  if(!Array.isArray(b.bookmarks)||b.bookmarks.length>1)fail();
  for(const mark of b.bookmarks as unknown[]){
   if(!object(mark))fail();const m=mark as Record<string,unknown>;keys(m,['message','char','label','progress']);
   if(!Number.isSafeInteger(m.message)||(m.message as number)<0||(m.message as number)>=(b.messages as unknown[]).length)fail();
   const message=(b.messages as {content:string}[])[m.message as number];
   if(!Number.isSafeInteger(m.char)||(m.char as number)<0||(m.char as number)>message.content.length)fail();
   if(m.label!==undefined)text(m.label,2000);
   if(m.progress!==undefined&&(typeof m.progress!=='number'||!Number.isFinite(m.progress)||m.progress<0||m.progress>1))fail();
  }
 }
 return cloudBook(b as unknown as Book);
}
async function jsonBody(request:Request){
 if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')throw new ApiError(415,'JSON 요청만 사용할 수 있어요.');
 const reader=request.body?.getReader();if(!reader)fail();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes+10000){await reader.cancel();throw new ApiError(413,'책의 텍스트 용량이 너무 커요.');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail();}
}

export async function libraryApi(request:Request,db:TextDatabase,owner:string,origin:string,reply:(body:unknown,status:number,origin:string)=>Response){
 try{
  const path=new URL(request.url).pathname;
  if(path==='/library/books'&&request.method==='GET'){
   const {results}=await db.prepare('SELECT book_id AS id, revision, deleted, updated_at AS updatedAt FROM books WHERE owner_id = ?1 ORDER BY book_id').bind(owner).all<{id:string;revision:number;deleted:number;updatedAt:number}>();
   return reply({books:results.map(row=>({...row,deleted:!!row.deleted}))},200,origin);
  }
  const match=/^\/library\/books\/([^/]+)$/.exec(path);if(!match)return reply({error:'찾을 수 없어요.'},404,origin);
  let id:string;try{id=decodeURIComponent(match[1]);}catch{fail();}if(!idValid(id!))fail();
  if(request.method==='GET'){
   const row=await db.prepare('SELECT body, revision, deleted, updated_at FROM books WHERE owner_id = ?1 AND book_id = ?2').bind(owner,id!).first<Row>();
   if(!row||row.deleted)return reply({error:'책을 찾을 수 없어요.'},404,origin);
   return reply({book:JSON.parse(row.body!),revision:row.revision,updatedAt:row.updated_at},200,origin);
  }
  if(request.method!=='PUT'&&request.method!=='DELETE')return reply({error:'허용되지 않는 요청이에요.'},405,origin);
  const input=await jsonBody(request);if(!object(input))fail();keys(input,request.method==='PUT'?['book','baseRevision']:['baseRevision']);
  const base=input.baseRevision;if(!Number.isSafeInteger(base)||(base as number)<0)fail();
  const now=Date.now();
  if(request.method==='DELETE'){
   const result=await db.prepare('UPDATE books SET body = NULL, bytes = 0, deleted = 1, revision = revision + 1, updated_at = ?1 WHERE owner_id = ?2 AND book_id = ?3 AND revision = ?4').bind(now,owner,id!,base).run();
   if(!result.meta.changes)return reply({error:'다른 기기에서 변경된 책이에요.'},409,origin);
   return reply({revision:(base as number)+1,updatedAt:now},200,origin);
  }
  const book=validate(input.book,id!),body=JSON.stringify(book),bytes=new TextEncoder().encode(body).byteLength;
  if(bytes>maxBytes)throw new ApiError(413,'책의 텍스트 용량이 너무 커요.');
  // Both CAS revision and storage quotas are enforced atomically inside the write.
  const quota='(SELECT COALESCE(SUM(bytes),0) FROM books WHERE owner_id = ?1 AND book_id != ?2) + ?4 <= 100000000 AND (SELECT COUNT(*) FROM books WHERE owner_id = ?1 AND deleted = 0 AND book_id != ?2) < 1000';
  const query=base===0
   ?`INSERT INTO books(owner_id, book_id, body, bytes, revision, updated_at, deleted) SELECT ?1, ?2, ?3, ?4, 1, ?5, 0 WHERE ${quota} AND (SELECT COUNT(*) FROM books WHERE owner_id = ?1) < 5000 ON CONFLICT(owner_id,book_id) DO NOTHING`
   :`UPDATE books SET body = ?3, bytes = ?4, revision = revision + 1, updated_at = ?5, deleted = 0 WHERE owner_id = ?1 AND book_id = ?2 AND revision = ?6 AND ${quota}`;
  const statement=db.prepare(query);const args=[owner,id!,body,bytes,now,...(base===0?[]:[base])];
  const result=await statement.bind(...args).run();
  if(!result.meta.changes){
   const usage=await db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes, SUM(CASE WHEN deleted=0 THEN 1 ELSE 0 END) AS count, COUNT(*) AS records FROM books WHERE owner_id = ?1').bind(owner).first<{bytes:number;count:number;records:number}>();
   if(usage&&(usage.bytes+bytes>accountBytes||usage.count>=accountBooks||base===0&&usage.records>=5000))throw new ApiError(413,'계정의 텍스트 저장 한도에 도달했어요.');
   return reply({error:'다른 기기에서 변경된 책이에요.'},409,origin);
  }
  return reply({revision:(base as number)+1,updatedAt:now},200,origin);
 }catch(error){
  return reply({error:error instanceof ApiError?error.message:'저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'},error instanceof ApiError?error.status:503,origin);
 }
}
