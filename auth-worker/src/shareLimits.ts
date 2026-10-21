import type {TextDatabase} from './cloud';
/** Atomic per-account limits apply across books, tabs and devices. Server
 * timestamps and a single conditional write prevent concurrent bypasses.
 */
export async function allowShareAction(db:TextDatabase,owner:string,kind:'publish'|'card'|'image'){
 const now=Date.now(),windowSize=kind==='image'?60000:86400000;
 const start=Math.floor(now/windowSize)*windowSize;
 const limit=kind==='image'?120:30,cooldown=kind==='image'?0:60000;
 const result=await db.prepare(`INSERT INTO share_rate_limits(owner_id,kind,window_start,used,last_at)
 VALUES(?1,?2,?3,1,?4)
 ON CONFLICT(owner_id,kind) DO UPDATE SET
 window_start=excluded.window_start,
 used=CASE WHEN share_rate_limits.window_start=excluded.window_start THEN share_rate_limits.used+1 ELSE 1 END,
 last_at=excluded.last_at
 WHERE share_rate_limits.last_at<=?4-?5
 AND (share_rate_limits.window_start!=?3 OR share_rate_limits.used<?6)`).bind(owner,kind,start,now,cooldown,limit).run();
 return result.meta.changes>0;
}
