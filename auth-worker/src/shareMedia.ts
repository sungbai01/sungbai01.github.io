import type {TextDatabase} from './cloud';
import {allowShareAction} from './shareLimits';
import {SHARE_IDLE_MS,SHARE_STORAGE_BYTES} from './shareExpiry';
type MediaObject={body:ReadableStream<Uint8Array>};
export type ShareBucket={put:(key:string,value:ArrayBuffer,options:{httpMetadata:{contentType:string};customMetadata:{share:string}})=>Promise<unknown>;get:(key:string)=>Promise<MediaObject|null>;delete:(key:string)=>Promise<void>};
type Reply=(body:unknown,status:number,origin:string)=>Response;
const maxImage=2_000_000;
/** These counters deliberately reserve failed/replaced uploads too. They never
 * refund uncertain operations, so errors/concurrency cannot exceed the cap.
 * R2 access is private and every data-plane call must pass this gate first.
 */
async function reserve(db:TextDatabase,kind:'reads'|'writes'){
 const month=new Date().toISOString().slice(0,7),limit=kind==='reads'?100000:10000;
 const result=await db.prepare(`INSERT INTO share_operation_budget(month,${kind}) VALUES(?1,1)
 ON CONFLICT(month) DO UPDATE SET ${kind}=${kind}+1 WHERE ${kind}<?2`).bind(month,limit).run();
 return result.meta.changes>0;
}
function signature(bytes:Uint8Array){
 if(bytes.length>24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
 if(bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>16&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';
 return null;
}
export async function uploadShareImage(request:Request,db:TextDatabase,bucket:ShareBucket|undefined,owner:string,bookId:string,origin:string,reply:Reply){
 if(request.method!=='POST')return reply({error:'허용되지 않는 요청이에요.'},405,origin);
 if(!bucket)return reply({error:'R2 이미지 저장소 활성화가 필요해요.'},503,origin);
 const share=await db.prepare('SELECT share_id FROM book_shares WHERE owner_id=?1 AND book_id=?2 AND last_access_at>?3').bind(owner,bookId,Date.now()-SHARE_IDLE_MS).first<{share_id:string}>();
 if(!share)return reply({error:'공유 링크를 먼저 만들어 주세요.'},404,origin);
 const role=request.headers.get('X-Image-Role')??'';
 let name='';try{name=decodeURIComponent(request.headers.get('X-Image-Name')??'');}catch{return reply({error:'이미지 이름이 올바르지 않아요.'},400,origin);}
 if(!['asset','icon','card'].includes(role)||!name.trim()||name.length>500||/[\u0000-\u001f]/.test(name))return reply({error:'이미지 형식이 올바르지 않아요.'},400,origin);
 if(!await allowShareAction(db,owner,role==='card'?'card':'image'))return reply({error:role==='card'?'카드 업로드는 1분에 한 번, 하루 30회까지 가능해요.':'이미지를 너무 빠르게 올리고 있어요. 잠시 후 다시 시도해 주세요.'},429,origin);
 const declaredSize=Number(request.headers.get('Content-Length'));
 if(Number.isFinite(declaredSize)&&declaredSize>maxImage)return reply({error:'공유 이미지는 한 장당 2MB 이하여야 해요.'},413,origin);
 const reader=request.body?.getReader();if(!reader)return reply({error:'이미지가 없어요.'},400,origin);
 let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxImage){await reader.cancel();return reply({error:'공유 이미지는 2MB 이하여야 해요.'},413,origin);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const mime=signature(bytes);if(!mime)return reply({error:'PNG · JPEG · WEBP 이미지만 공유할 수 있어요.'},415,origin);
 const reserved=await db.prepare(`UPDATE share_storage_budget SET reserved_bytes=reserved_bytes+?1 WHERE id=1 AND reserved_bytes+?1<=?3
 AND (SELECT COUNT(*) FROM share_media WHERE share_id=?2)<64
 AND (SELECT COALESCE(SUM(bytes),0) FROM share_media WHERE share_id=?2)+?1<=10000000`).bind(size,share.share_id,SHARE_STORAGE_BYTES).run();
 if(!reserved.meta.changes)return reply({error:'공유 이미지 저장 한도에 도달했어요.'},413,origin);
 if(!await reserve(db,'writes'))return reply({error:'이번 달 이미지 업로드 한도에 도달했어요.'},429,origin);
 const imageId=crypto.randomUUID(),key=`${share.share_id}/${imageId}`;
 await db.prepare('INSERT INTO share_objects(object_key,share_id,bytes,created_at) VALUES(?1,?2,?3,?4)').bind(key,share.share_id,size,Date.now()).run();
 await bucket.put(key,bytes.buffer,{httpMetadata:{contentType:mime},customMetadata:{share:share.share_id}});
 await db.prepare('INSERT INTO share_media(share_id,image_id,name,role,object_key,mime,bytes) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM book_shares WHERE share_id=?1 AND owner_id=?8) ON CONFLICT(share_id,name,role) DO UPDATE SET image_id=excluded.image_id,object_key=excluded.object_key,mime=excluded.mime,bytes=excluded.bytes').bind(share.share_id,imageId,name,role,key,mime,size,owner).run();
 return reply({url:`${new URL(request.url).origin}/share-media/${share.share_id}/${imageId}`},200,origin);
}
export async function publicShareImage(request:Request,db:TextDatabase,bucket:ShareBucket|undefined){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*'};
 const match=/^\/share-media\/([A-Za-z0-9_-]{43})\/([a-f0-9-]{36})$/.exec(new URL(request.url).pathname);
 if(!match||request.method!=='GET'||!bucket)return new Response(null,{status:404,headers});
 const image=await db.prepare('SELECT object_key,mime FROM share_media WHERE share_id=?1 AND image_id=?2 AND EXISTS(SELECT 1 FROM book_shares WHERE share_id=?1 AND last_access_at>?3)').bind(match[1],match[2],Date.now()-SHARE_IDLE_MS).first<{object_key:string;mime:string}>();
 if(!image)return new Response(null,{status:404,headers});
 if(!await reserve(db,'reads'))return new Response(null,{status:429,headers});
 const object=await bucket.get(image.object_key);
 return object?new Response(object.body,{headers:{...headers,'Content-Type':image.mime}}):new Response(null,{status:404,headers});
}
