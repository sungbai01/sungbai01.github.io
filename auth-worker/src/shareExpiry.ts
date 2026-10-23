import type {TextDatabase} from './cloud';
import type {ShareBucket} from './shareMedia';
export const SHARE_IDLE_MS=7*24*60*60*1000;
export const SHARE_STORAGE_BYTES=1_000_000_000;
/** Expiry is enforced on reads immediately. Physical cleanup is bounded so a
 * batch stays below Worker subrequest limits and resumes safely next tick. */
export async function cleanExpiredShares(db:TextDatabase,bucket:ShareBucket){
 const now=Date.now();
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO share_history(share_id,owner_id,book_id,title,created_at,expired_at,view_count)
  SELECT share_id,owner_id,book_id,title,created_at,last_access_at+?2,view_count FROM book_shares
  WHERE last_access_at<=?1 ORDER BY last_access_at LIMIT 100`).bind(now-SHARE_IDLE_MS,SHARE_IDLE_MS),
  db.prepare('DELETE FROM book_shares WHERE share_id IN (SELECT share_id FROM book_shares WHERE last_access_at<=?1 ORDER BY last_access_at LIMIT 100)').bind(now-SHARE_IDLE_MS),
 ]);
 // A failed/uncertain R2 put retains a recoverable reservation. Delete the
 // object first; refund only a still-present ledger row, atomically.
 const pending=await db.prepare('SELECT object_key,bytes FROM share_upload_reservations WHERE created_at<?1 ORDER BY created_at LIMIT 3').bind(now-60*60*1000).all<{object_key:string;bytes:number}>();
 for(const item of pending.results){
  await bucket.delete(item.object_key);
  await db.batch([
   db.prepare('UPDATE share_storage_budget SET reserved_bytes=MAX(0,reserved_bytes-?1) WHERE id=1 AND EXISTS(SELECT 1 FROM share_upload_reservations WHERE object_key=?2)').bind(item.bytes,item.object_key),
   db.prepare('DELETE FROM share_upload_reservations WHERE object_key=?1').bind(item.object_key),
  ]);
 }
 await db.batch([
  db.prepare('DELETE FROM share_card_layout WHERE share_id IN (SELECT share_id FROM share_card_layout WHERE NOT EXISTS(SELECT 1 FROM book_shares WHERE book_shares.share_id=share_card_layout.share_id) LIMIT 100)'),
  db.prepare('DELETE FROM auth_sessions WHERE session_id IN (SELECT session_id FROM auth_sessions WHERE expires_at<?1 LIMIT 100)').bind(now-86400000),
  db.prepare('DELETE FROM public_read_budget WHERE day<?1').bind(new Date(now-7*86400000).toISOString().slice(0,10)),
 ]);
 const {results}=await db.prepare(`SELECT object_key,bytes FROM share_objects WHERE created_at<?1 AND
 NOT EXISTS(SELECT 1 FROM share_media m JOIN book_shares s ON s.share_id=m.share_id WHERE m.object_key=share_objects.object_key AND s.last_access_at>?2)
 ORDER BY created_at LIMIT 5`).bind(now-15*60*1000,now-SHARE_IDLE_MS).all<{object_key:string;bytes:number}>();
 for(const object of results){
  await db.prepare("INSERT OR IGNORE INTO share_object_info(object_key,owner_id) VALUES(?1,'')").bind(object.object_key).run();
  const claim=await db.prepare(`UPDATE share_object_info SET deleting=1 WHERE object_key=?1 AND NOT EXISTS(SELECT 1 FROM share_media m JOIN book_shares s ON s.share_id=m.share_id WHERE m.object_key=?1 AND s.last_access_at>?2)`).bind(object.object_key,now-SHARE_IDLE_MS).run();
  if(!claim.meta.changes)continue;
  // Deletion must finish before space can be credited. Failed deletes leave the
  // ledger intact, and an atomic batch prevents overlapping cron refunds.
  await bucket.delete(object.object_key);
  await db.batch([
   db.prepare('UPDATE share_storage_budget SET reserved_bytes=MAX(0,reserved_bytes-?1) WHERE id=1 AND EXISTS(SELECT 1 FROM share_objects WHERE object_key=?2)').bind(object.bytes,object.object_key),
   db.prepare('DELETE FROM share_media WHERE object_key=?1').bind(object.object_key),
   db.prepare('DELETE FROM share_objects WHERE object_key=?1').bind(object.object_key),
   db.prepare('DELETE FROM share_object_info WHERE object_key=?1').bind(object.object_key),
  ]);
 }
}
