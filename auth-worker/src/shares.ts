import {cloudBook} from '../../shared/cloudBook';
import type {Book} from '../../src/lib/library';
import type {TextDatabase} from './cloud';
import {allowShareAction} from './shareLimits';
import {SHARE_IDLE_MS} from './shareExpiry';

type Reply=(body:unknown,status:number,origin:string)=>Response;
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const metadata=(row:{share_id:string;updated_at:number}|null)=>row?{id:row.share_id,updatedAt:row.updated_at}:null;

async function canonicalImages(request:Request,book:Book){
 const reader=request.body?.getReader();if(!reader)return;
 let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1_000_000){await reader.cancel();throw new Error('Too large');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const input=JSON.parse(new TextDecoder().decode(bytes)) as {references:unknown};
 if(!Array.isArray(input.references)||input.references.length>10000)throw new Error('Invalid references');
 const references=new Map<number,{start:number;end:number;name:string}[]>();
 for(const item of input.references){
  if(!item||typeof item!=='object')throw new Error('Invalid reference');
  const {message,start,end,name}=item;
  if(!Number.isInteger(message)||!book.messages[message]||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>book.messages[message].content.length||end-start>2000||typeof name!=='string'||!name.trim()||name.length>500||/[{}\u0000-\u001f]/.test(name))throw new Error('Invalid reference');
  // Client may canonicalize an existing image marker only, not replace prose.
  const original=book.messages[message].content.slice(start,end);
  if(!/^(?:<img\b|\[img\b|\{\{(?:img|image|raw)::|!\[)/i.test(original))throw new Error('Not an image');
  const list=references.get(message)??[];list.push({start,end,name});references.set(message,list);
 }
 for(const [index,list] of references){
  list.sort((a,b)=>b.start-a.start);let boundary=book.messages[index].content.length;
  for(const item of list){if(item.end>boundary)throw new Error('Overlapping references');const message=book.messages[index];message.content=message.content.slice(0,item.start)+`{{img::${item.name}}}`+message.content.slice(item.end);boundary=item.start;}
 }
}

/** Public capability URLs expose only an explicitly published text snapshot. */
export async function publicShare(request:Request,db:TextDatabase,origin:string,reply:Reply){
 const id=new URL(request.url).pathname.slice('/shares/'.length);
 if(request.method!=='GET'||!tokenPattern.test(id))return reply({error:'공유한 책을 찾을 수 없어요.'},404,origin);
 const now=Date.now();
 // A single conditional UPDATE both checks expiry and records this open. An
 // already expired link can never be revived by racing the cleanup job.
 const row=await db.prepare('UPDATE book_shares SET last_access_at=?2 WHERE share_id=?1 AND last_access_at>?3 RETURNING body').bind(id,now,now-SHARE_IDLE_MS).first<{body:string}>();
 if(!row)return reply({error:'공유가 종료되었거나 존재하지 않는 책이에요.'},404,origin);
 const book=JSON.parse(row.body) as Book;
 const {results}=await db.prepare("SELECT image_id,name,role FROM share_media WHERE share_id=?1 AND role!='card' ORDER BY image_id DESC").bind(id).all<{image_id:string;name:string;role:string}>();
 const unique=[...new Map(results.map(image=>[image.name,image])).values()];
 book.assets=unique.map(image=>({id:image.image_id,name:image.name,type:image.role==='icon'?'icon':'asset',src:`${new URL(request.url).origin}/share-media/${id}/${image.image_id}`}));
 book.characterIcon=book.assets.find(image=>image.type==='icon')?.src;
 return reply({book},200,origin);
}

export async function manageShare(request:Request,db:TextDatabase,owner:string,bookId:string,origin:string,reply:Reply){
 if(!bookId||bookId.length>160||/[\s/\\\u0000-\u001f]/.test(bookId))return reply({error:'책을 찾을 수 없어요.'},404,origin);
 if(request.method==='GET'){
  const row=await db.prepare('SELECT share_id, updated_at FROM book_shares WHERE owner_id = ?1 AND book_id = ?2 AND last_access_at>?3').bind(owner,bookId,Date.now()-SHARE_IDLE_MS).first<{share_id:string;updated_at:number}>();
  const card=row?await db.prepare("SELECT image_id FROM share_media WHERE share_id=?1 AND role='card' ORDER BY image_id LIMIT 1").bind(row.share_id).first<{image_id:string}>():null;
  return reply({share:row?{...metadata(row),cardUrl:card?`${new URL(request.url).origin}/share-media/${row.share_id}/${card.image_id}`:null}:null},200,origin);
 }
 if(request.method==='DELETE'){
  await db.prepare('DELETE FROM book_shares WHERE owner_id = ?1 AND book_id = ?2').bind(owner,bookId).run();
  return reply({share:null},200,origin);
 }
 if(request.method!=='POST')return reply({error:'허용되지 않는 요청이에요.'},405,origin);
 // Never accept public text, owner IDs or arbitrary URLs from the client.
 // Copy the authenticated owner's already validated D1 book only.
 const source=await db.prepare('SELECT body FROM books WHERE owner_id = ?1 AND book_id = ?2 AND deleted = 0').bind(owner,bookId).first<{body:string}>();
 if(!source)return reply({error:'서버에 저장된 책을 찾을 수 없어요.'},404,origin);
 if(!await allowShareAction(db,owner,'publish'))return reply({error:'공유 생성·갱신은 1분에 한 번, 하루 30회까지 가능해요. 잠시 후 다시 시도해 주세요.'},429,origin);
 const book=cloudBook(JSON.parse(source.body) as Book);
 try{await canonicalImages(request,book);}catch{return reply({error:'이미지 참조를 확인하지 못했어요.'},400,origin);}
 delete book.bookmarks;delete book.seriesId;delete book.pageLayoutVersion;
 book.description='';
 const body=JSON.stringify(book),bytes=new TextEncoder().encode(body).byteLength;
 if(bytes>1_500_000)return reply({error:'공유할 텍스트 용량이 너무 커요.'},413,origin);
 const id=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>String.fromCharCode(b)).join('');
 const shareId=btoa(id).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const now=Date.now();
 await db.prepare('DELETE FROM book_shares WHERE owner_id=?1 AND book_id=?2 AND last_access_at<=?3').bind(owner,bookId,now-SHARE_IDLE_MS).run();
 // Quotas checked inside the write, including concurrent create requests.
 const result=await db.prepare(`INSERT INTO book_shares(share_id,owner_id,book_id,body,bytes,created_at,updated_at,last_access_at)
 SELECT ?1,?2,?3,?4,?5,?6,?6,?6
 WHERE ((SELECT COUNT(*) FROM book_shares WHERE owner_id=?2)<20 OR EXISTS(SELECT 1 FROM book_shares WHERE owner_id=?2 AND book_id=?3))
 AND (SELECT COALESCE(SUM(bytes),0) FROM book_shares WHERE owner_id=?2 AND book_id!=?3)+?5<=20000000
 AND (SELECT COALESCE(SUM(bytes),0) FROM book_shares WHERE NOT(owner_id=?2 AND book_id=?3))+?5<=100000000
 ON CONFLICT(owner_id,book_id) DO UPDATE SET body=excluded.body,bytes=excluded.bytes,updated_at=excluded.updated_at`).bind(shareId,owner,bookId,body,bytes,now).run();
 if(!result.meta.changes)return reply({error:'공유 보관 한도에 도달했어요. 기존 공유를 종료해 주세요.'},413,origin);
 const row=await db.prepare('SELECT share_id, updated_at FROM book_shares WHERE owner_id = ?1 AND book_id = ?2').bind(owner,bookId).first<{share_id:string;updated_at:number}>();
 if(row)await db.prepare("DELETE FROM share_media WHERE share_id=?1 AND role!='card'").bind(row.share_id).run();
 return reply({share:metadata(row)},200,origin);
}
