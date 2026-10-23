import type {TextDatabase} from './cloud';
export type EdgeLimiter={limit:(input:{key:string})=>Promise<{success:boolean}>};
export type Limits={VISITOR_LIMIT?:EdgeLimiter;AUTH_LIMIT?:EdgeLimiter;SHARE_LIMIT?:EdgeLimiter;ACCOUNT_LIMIT?:EdgeLimiter};
export async function allowed(limiter:EdgeLimiter|undefined,key:string){
 if(!limiter)throw new Error('Rate limiter unavailable');
 return (await limiter.limit({key})).success;
}
/** CF-Connecting-IP is supplied by Cloudflare, never use client X-Forwarded-For. */
export async function visitorKey(request:Request){
 const ip=request.headers.get('CF-Connecting-IP')??'unknown';
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
/** Reserve only on cache miss. Global daily budget complements edge-local limits. */
export async function allowPublicRead(db:TextDatabase){
 const result=await db.prepare(`INSERT INTO public_read_budget(day,used) VALUES(?1,1)
 ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<20000`).bind(new Date().toISOString().slice(0,10)).run();
 return result.meta.changes>0;
}
