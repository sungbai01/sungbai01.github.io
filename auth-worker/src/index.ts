import {saveShareCardLayout} from './shareCard';
import {libraryApi,type TextDatabase} from './cloud';
import {manageShare,publicShare} from './shares';
import {uploadShareImage,prepareShareImages,publicShareImage,type ShareBucket} from './shareMedia';
import {cleanExpiredShares} from './shareExpiry';
import {shareManagement} from './shareManagement';
import {verifySession,issueSession,revokeSession,Unauthorized} from './sessions';
import {allowed,visitorKey,type Limits} from './requestLimits';
import {createRemoteJWKSet,jwtVerify,base64url} from 'jose';

type Env={DB?:TextDatabase;SHARE_IMAGES?:ShareBucket;ALLOWED_ORIGINS:string;GOOGLE_CLIENT_ID?:string;AUTH_SECRET?:string;SESSION_SECRET?:string}&Limits;
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const encoder=new TextEncoder();
function configured(env:Env){return !!env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com')&&!!env.AUTH_SECRET&&env.AUTH_SECRET.length>=43;}
function reply(body:unknown,status:number,origin:string){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}

/** All future shared-book writes must verify this token and compare its sub to owner_id. */
export const authenticate=verifySession;
function authError(error:unknown,origin:string){return error instanceof Unauthorized?reply({error:'다시 로그인해 주세요.'},401,origin):reply({error:'로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'},503,origin);}
function limited(origin:string){const response=reply({error:'요청이 많아요. 잠시 후 다시 시도해 주세요.'},429,origin);response.headers.set('Retry-After','60');return response;}

export default {
 async scheduled(_event:unknown,env:Env){if(env.DB&&env.SHARE_IMAGES)await cleanExpiredShares(env.DB,env.SHARE_IMAGES);},
 async fetch(request:Request,env:Env):Promise<Response>{
  try{return await handle(request,env);}catch{return reply({error:'서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'},503,request.headers.get('Origin')??'');}
 }
};
async function handle(request:Request,env:Env):Promise<Response>{
  const origin=request.headers.get('Origin')??'';
  const origins=(env.ALLOWED_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean);
  const path=new URL(request.url).pathname;
  const visitor=await visitorKey(request);
  if(request.method!=='OPTIONS'&&!await allowed(env.VISITOR_LIMIT,visitor))return limited(origins.includes(origin)?origin:'');
  if((path.startsWith('/shares/')||path.startsWith('/share-media/'))&&request.method==='GET'){
   const id=path.split('/')[2]??'';
   if(!/^[A-Za-z0-9_-]{43}$/.test(id))return reply({error:'공유를 찾을 수 없어요.'},404,origins.includes(origin)?origin:'');
   if(!await allowed(env.SHARE_LIMIT,id))return limited(origins.includes(origin)?origin:'');
  }
  if(path.startsWith('/share-media/')&&request.method==='GET'){
   if(!env.DB)return new Response(null,{status:503});
   return publicShareImage(request,env.DB,env.SHARE_IMAGES);
  }
  if(!origin||!origins.includes(origin))return new Response(null,{status:403});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization,X-Image-Name,X-Image-Role','Access-Control-Max-Age':'600'}});
  if(path.startsWith('/library/')){
   if(!configured(env))return reply({error:'로그인 연결 준비 중이에요.'},503,origin);
   let user:{id:string};try{user=await authenticate(request,env);}catch(error){return authError(error,origin);}
   if(!await allowed(env.ACCOUNT_LIMIT,user.id))return limited(origin);
   if(!env.DB)return reply({error:'저장소 연결 준비 중이에요.'},503,origin);
   if(path==='/library/shares'||path.startsWith('/library/shares/'))return shareManagement(request,env.DB,user.id,origin,reply);
   const image=/^\/library\/books\/([^/]+)\/share\/images$/.exec(path);
   if(image){let bookId:string;try{bookId=decodeURIComponent(image[1]);}catch{return reply({error:'책을 찾을 수 없어요.'},404,origin);}return request.method==='PUT'?prepareShareImages(request,env.DB,user.id,bookId,origin,reply,env.SHARE_IMAGES):uploadShareImage(request,env.DB,env.SHARE_IMAGES,user.id,bookId,origin,reply);}
   const card=/^\/library\/books\/([^/]+)\/share\/card$/.exec(path);if(card){let bookId:string;try{bookId=decodeURIComponent(card[1]);}catch{return reply({error:'책을 찾을 수 없어요.'},404,origin);}return saveShareCardLayout(request,env.DB,user.id,bookId,origin,reply);}
   const share=/^\/library\/books\/([^/]+)\/share$/.exec(path);
   if(share){let bookId:string;try{bookId=decodeURIComponent(share[1]);}catch{return reply({error:'책을 찾을 수 없어요.'},404,origin);}return manageShare(request,env.DB,user.id,bookId,origin,reply);}
   return libraryApi(request,env.DB,user.id,origin,reply);
  }
  if(path.startsWith('/shares/')){
   if(!env.DB)return reply({error:'저장소 연결 준비 중이에요.'},503,origin);
   return publicShare(request,env.DB,origin,reply);
  }
  if(path==='/auth/logout'&&request.method==='POST'){try{await revokeSession(request,env);return reply({ok:true},200,origin);}catch(error){return authError(error,origin);}}
  if(path==='/auth/config'&&request.method==='GET')return configured(env)?reply({clientId:env.GOOGLE_CLIENT_ID},200,origin):reply({error:'로그인 연결 준비 중이에요.'},503,origin);
  if(path==='/auth/me'&&request.method==='GET'){
   if(!configured(env))return reply({error:'로그인 연결 준비 중이에요.'},503,origin);
   try{const user=await authenticate(request,env);return reply({user:{id:user.id}},200,origin);}catch(error){return authError(error,origin);}
  }
  if(path!=='/auth/google')return reply({error:'찾을 수 없어요.'},404,origin);
  if(!await allowed(env.AUTH_LIMIT,visitor))return limited(origin);
  if(request.method!=='POST')return reply({error:'허용되지 않는 요청이에요.'},405,origin);
  if(!configured(env))return reply({error:'로그인 연결 준비 중이에요.'},503,origin);
  if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return reply({error:'올바르지 않은 요청이에요.'},415,origin);
  // Read with a real byte cap, even when Content-Length is omitted or forged.
  const reader=request.body?.getReader();if(!reader)return reply({error:'올바르지 않은 요청이에요.'},400,origin);
  let bytes=0;const chunks:Uint8Array[]=[];
  try{
   while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>20000){await reader.cancel();return reply({error:'요청이 너무 커요.'},413,origin);}chunks.push(value);}
   const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
   const {credential,nonce}=JSON.parse(new TextDecoder().decode(body));
   if(typeof credential!=='string'||credential.length>16000||typeof nonce!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(nonce))return reply({error:'올바르지 않은 요청이에요.'},400,origin);
   const {payload}=await jwtVerify(credential,googleKeys,{algorithms:['RS256'],issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,requiredClaims:['sub','exp','iat'],maxTokenAge:'1h',clockTolerance:5});
   if(payload.nonce!==nonce||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||payload.azp!==undefined&&payload.azp!==env.GOOGLE_CLIENT_ID)throw new Error('unauthorized');
   // Keep only a service-specific opaque identifier; discard email, name and picture.
   const key=await crypto.subtle.importKey('raw',encoder.encode(env.AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const id='u_'+base64url.encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('google:'+payload.sub))));
   return reply(await issueSession(id,env),200,origin);
  }catch(error){
   if(error instanceof Error&&/D1|Session store/.test(error.message))return reply({error:'로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'},503,origin);
   return reply({error:'로그인을 확인하지 못했어요. 다시 시도해 주세요.'},401,origin);
  }finally{reader.releaseLock();}
}
