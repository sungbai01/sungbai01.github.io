import type {TextDatabase} from './cloud';
import {SHARE_IDLE_MS} from './shareExpiry';
type Reply=(body:unknown,status:number,origin:string)=>Response;
export async function shareManagement(request:Request,db:TextDatabase,owner:string,origin:string,reply:Reply){
 const path=new URL(request.url).pathname;
 if(path==='/library/shares'&&request.method==='GET'){
  if(new URL(request.url).searchParams.get('count')==='1'){
   const row=await db.prepare('SELECT COUNT(*) AS activeCount FROM book_shares WHERE owner_id=?1 AND last_access_at>?2').bind(owner,Date.now()-SHARE_IDLE_MS).first<{activeCount:number}>();
   return reply({activeCount:row?.activeCount??0},200,origin);
  }
  const cursor=Number(new URL(request.url).searchParams.get('cursor')??0);if(!Number.isSafeInteger(cursor)||cursor<0||cursor>100000)return reply({error:'목록 주소가 올바르지 않아요.'},400,origin);
  const {results}=await db.prepare(`SELECT s.share_id AS id,s.book_id AS bookId,s.title,s.created_at AS createdAt,s.last_access_at+?2 AS expiresAt,
 CASE WHEN s.last_access_at+?2<=?3 THEN 'expired' ELSE 'active' END AS status,
 c.title AS cardTitle,c.quote,c.page_start AS pageStart,c.page_end AS pageEnd,c.image_position AS imagePosition,c.background_url AS backgroundUrl,
 json_extract(s.body,'$.author') AS author,json_extract(s.body,'$.color') AS color,json_extract(s.body,'$.displayPrompt') AS displayPrompt,json_extract(s.body,'$.volumeNumber') AS volumeNumber,
 (SELECT image_id FROM share_media m WHERE m.share_id=s.share_id AND (m.name='__galpi_share_background__' OR m.name='__galpi_cover_icon__') ORDER BY CASE m.name WHEN '__galpi_share_background__' THEN 0 ELSE 1 END LIMIT 1) AS backgroundImage,
 (SELECT image_id FROM share_media m WHERE m.share_id=s.share_id AND m.role='card' LIMIT 1) AS cardImage
 FROM book_shares s LEFT JOIN share_card_layout c ON c.share_id=s.share_id WHERE s.owner_id=?1
 UNION ALL
 SELECT share_id AS id,book_id AS bookId,title,created_at AS createdAt,expired_at AS expiresAt,'expired' AS status,
 NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL
 FROM share_history WHERE owner_id=?1 AND NOT EXISTS(SELECT 1 FROM book_shares WHERE book_shares.share_id=share_history.share_id)
 ORDER BY createdAt DESC,id LIMIT 51 OFFSET ?4`).bind(owner,SHARE_IDLE_MS,Date.now(),cursor).all<Record<string,any>>();
  const base=new URL(request.url).origin;
  const shares=results.slice(0,50).map(row=>({id:row.id,bookId:row.bookId,title:row.title,createdAt:row.createdAt,expiresAt:row.expiresAt,status:row.status,
   ...(row.status==='active'?{card:{title:row.cardTitle??row.title,quote:row.quote??'',author:row.author??'',color:row.color??'#1d3b31',displayPrompt:row.displayPrompt?JSON.parse(row.displayPrompt):undefined,volumeNumber:row.volumeNumber??1,imagePosition:row.imagePosition??0,...(row.pageStart?{quotePages:{start:row.pageStart,end:row.pageEnd}}:{}),...(row.backgroundUrl?{backgroundUrl:row.backgroundUrl}:row.backgroundImage?{backgroundUrl:`${base}/share-media/${row.id}/${row.backgroundImage}`}:{})},...(row.cardImage&&!row.cardTitle?{cardUrl:`${base}/share-media/${row.id}/${row.cardImage}`}:{})}:{}),
  }));
  const storage=await db.prepare(`SELECT (SELECT COALESCE(SUM(o.bytes),0) FROM share_objects o JOIN share_object_info i ON i.object_key=o.object_key WHERE i.owner_id=?1)+(SELECT COALESCE(SUM(bytes),0) FROM share_upload_reservations WHERE owner_id=?1) AS bytes`).bind(owner).first<{bytes:number}>();
  return reply({shares,nextCursor:results.length>50?cursor+50:null,imageBytes:storage?.bytes??0,imageLimit:100000000,urlLimit:10},200,origin);
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
