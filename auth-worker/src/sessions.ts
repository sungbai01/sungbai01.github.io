import {jwtVerify,SignJWT,base64url} from 'jose';
import type {TextDatabase} from './cloud';
export type SessionEnv={DB?:TextDatabase;AUTH_SECRET?:string;SESSION_SECRET?:string};
export const sessionLifetime=7*24*60*60;
const issuer='galpi-bookshelf-auth',audience='galpi-bookshelf',encoder=new TextEncoder();
export class Unauthorized extends Error{}
export async function verifySession(request:Request,env:SessionEnv){
 const raw=request.headers.get('Authorization')??'';
 if(!raw.startsWith('Bearer ')||raw.length>4096||!env.AUTH_SECRET)throw new Unauthorized();
 const token=raw.slice(7);let payload;let legacy=false;
 try{
  const verified=await jwtVerify(token,(header)=>{
   if(header.kid==='session-v2'&&env.SESSION_SECRET&&env.SESSION_SECRET.length>=43)return encoder.encode(env.SESSION_SECRET);
   if(header.kid===undefined){legacy=true;return encoder.encode(env.AUTH_SECRET!);}
   throw new Unauthorized();
  },{algorithms:['HS256'],issuer,audience,requiredClaims:['sub','exp','iat'],maxTokenAge:sessionLifetime});payload=verified.payload;
 }catch{throw new Unauthorized();}
 if(typeof payload.sub!=='string'||!/^u_[A-Za-z0-9_-]{43}$/.test(payload.sub))throw new Unauthorized();
 if(!env.DB)throw new Error('Session store unavailable');
 // Canonicalize signature encoding so unused base64url bits cannot produce
 // a second legacy session record for the same valid signed credential.
 const parts=token.split('.'),canonical=parts.slice(0,2).join('.')+'.'+base64url.encode(base64url.decode(parts[2]));
 const sessionId=legacy?'legacy_'+base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(canonical)))):payload.jti;
 if(typeof sessionId!=='string'||sessionId.length>100)throw new Unauthorized();
 type Session={owner_id:string;expires_at:number;revoked:number};
 let row=await env.DB.prepare('SELECT owner_id,expires_at,revoked FROM auth_sessions WHERE session_id=?1').bind(sessionId).first<Session>();
 // Existing signed sessions retain their original expiry, identity and ownership.
 if(!row&&legacy){
  await env.DB.prepare('INSERT OR IGNORE INTO auth_sessions(session_id,owner_id,expires_at) VALUES(?1,?2,?3)').bind(sessionId,payload.sub,payload.exp!*1000).run();
  row=await env.DB.prepare('SELECT owner_id,expires_at,revoked FROM auth_sessions WHERE session_id=?1').bind(sessionId).first<Session>();
 }
 if(!row||row.revoked||row.owner_id!==payload.sub||row.expires_at<=Date.now())throw new Unauthorized();
 return {id:payload.sub,sessionId};
}
export async function issueSession(id:string,env:SessionEnv){
 if(!env.DB||!env.SESSION_SECRET||env.SESSION_SECRET.length<43)throw new Error('Session store unavailable');
 const issuedAt=Math.floor(Date.now()/1000),expiresAt=issuedAt+sessionLifetime,sessionId=crypto.randomUUID();
 const token=await new SignJWT({}).setProtectedHeader({alg:'HS256',typ:'JWT',kid:'session-v2'}).setJti(sessionId).setSubject(id).setIssuer(issuer).setAudience(audience).setIssuedAt(issuedAt).setExpirationTime(expiresAt).sign(encoder.encode(env.SESSION_SECRET));
 await env.DB.prepare('INSERT INTO auth_sessions(session_id,owner_id,expires_at) VALUES(?1,?2,?3)').bind(sessionId,id,expiresAt*1000).run();
 return {token,expiresAt:expiresAt*1000,user:{id}};
}
export async function revokeSession(request:Request,env:SessionEnv){
 const user=await verifySession(request,env);
 await env.DB!.prepare('UPDATE auth_sessions SET revoked=1 WHERE session_id=?1 AND owner_id=?2').bind(user.sessionId,user.id).run();
}
