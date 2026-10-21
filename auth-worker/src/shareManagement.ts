import type {TextDatabase} from './cloud';
import {SHARE_IDLE_MS} from './shareExpiry';
type Reply=(body:unknown,status:number,origin:string)=>Response;
export async function shareManagement(request:Request,db:TextDatabase,owner:string,origin:string,reply:Reply){
 const path=new URL(request.url).pathname;
 if(path==='/library/shares'&&request.method==='GET'){
  const cursor=Number(new URL(request.url).searchParams.get('cursor')??0);if(!Number.isSafeInteger(cursor)||cursor<0||cursor>100000)return reply({error:'목록 주소가 올바르지 않아요.'},400,origin);
  const {results}=await db.prepare(`SELECT share_id AS id,book_id AS bookId,title,created_at AS createdAt,last_access_at+?2 AS expiresAt,
 CASE WHEN last_access_at+?2<=?3 THEN 'expired' ELSE 'active' END AS status
 FROM book_shares WHERE owner_id=?1
 UNION ALL
 SELECT share_id AS id,book_id AS bookId,title,created_at AS createdAt,expired_at AS expiresAt,'expired' AS status
 FROM share_history WHERE owner_id=?1 AND NOT EXISTS(SELECT 1 FROM book_shares WHERE book_shares.share_id=share_history.share_id)
 ORDER BY createdAt DESC,id LIMIT 51 OFFSET ?4`).bind(owner,SHARE_IDLE_MS,Date.now(),cursor).all();
  return reply({shares:results.slice(0,50),nextCursor:results.length>50?cursor+50:null},200,origin);
 }
 const match=/^\/library\/shares\/([A-Za-z0-9_-]{43})$/.exec(path);
 if(match&&request.method==='DELETE'){
  await db.batch([
   db.prepare('DELETE FROM book_shares WHERE owner_id=?1 AND share_id=?2').bind(owner,match[1]),
   db.prepare('DELETE FROM share_history WHERE owner_id=?1 AND share_id=?2').bind(owner,match[1]),
  ]);
  return reply({deleted:true},200,origin);
 }
 return reply({error:'찾을 수 없어요.'},404,origin);
}
