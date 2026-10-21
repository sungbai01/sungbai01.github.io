import type {TextDatabase} from './cloud';
import type {ShareBucket} from './shareMedia';
export const SHARE_IDLE_MS=7*24*60*60*1000;
export const SHARE_STORAGE_BYTES=1_000_000_000;
/** Expiry is enforced on reads immediately. Physical cleanup is bounded so a
 * batch stays below Worker subrequest limits and resumes safely next tick. */
export async function cleanExpiredShares(db:TextDatabase,bucket:ShareBucket){
 const now=Date.now();
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO share_history(share_id,owner_id,book_id,title,created_at,expired_at)
  SELECT share_id,owner_id,book_id,title,created_at,last_access_at+?2 FROM book_shares
  WHERE last_access_at<=?1 ORDER BY last_access_at LIMIT 100`).bind(now-SHARE_IDLE_MS,SHARE_IDLE_MS),
  db.prepare('DELETE FROM book_shares WHERE share_id IN (SELECT share_id FROM book_shares WHERE last_access_at<=?1 ORDER BY last_access_at LIMIT 100)').bind(now-SHARE_IDLE_MS),
 ]);
 const {results}=await db.prepare(`SELECT object_key,bytes FROM share_objects WHERE created_at<?1 AND
 (NOT EXISTS(SELECT 1 FROM book_shares WHERE book_shares.share_id=share_objects.share_id)
 OR NOT EXISTS(SELECT 1 FROM share_media WHERE share_media.object_key=share_objects.object_key))
 ORDER BY created_at LIMIT 20`).bind(now-60*60*1000).all<{object_key:string;bytes:number}>();
 for(const object of results){
  // Deletion must finish before space can be credited. Failed deletes leave the
  // ledger intact, and an atomic batch prevents overlapping cron refunds.
  await bucket.delete(object.object_key);
  await db.batch([
   db.prepare('UPDATE share_storage_budget SET reserved_bytes=MAX(0,reserved_bytes-?1) WHERE id=1 AND EXISTS(SELECT 1 FROM share_objects WHERE object_key=?2)').bind(object.bytes,object.object_key),
   db.prepare('DELETE FROM share_media WHERE object_key=?1').bind(object.object_key),
   db.prepare('DELETE FROM share_objects WHERE object_key=?1').bind(object.object_key),
  ]);
 }
}
