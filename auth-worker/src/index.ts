import {libraryApi,type TextDatabase} from './cloud';
import {manageShare,publicShare} from './shares';
import {uploadShareImage,publicShareImage,type ShareBucket} from './shareMedia';
import {cleanExpiredShares} from './shareExpiry';
import {shareManagement} from './shareManagement';
import {createRemoteJWKSet,jwtVerify,SignJWT,base64url} from 'jose';

type Env={DB?:TextDatabase;SHARE_IMAGES?:ShareBucket;ALLOWED_ORIGINS:string;GOOGLE_CLIENT_ID?:string;AUTH_SECRET?:string};
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const encoder=new TextEncoder();
const issuer='galpi-bookshelf-auth';
const audience='galpi-bookshelf';
const lifetime=7*24*60*60;

function configured(env:Env){return !!env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com')&&!!env.AUTH_SECRET&&env.AUTH_SECRET.length>=43;}
function reply(body:unknown,status:number,origin:string){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}

/** All future shared-book writes must verify this token and compare its sub to owner_id. */
export async function authenticate(request:Request,env:Env){
 const authorization=request.headers.get('Authorization')??'';
 if(!configured(env)||!authorization.startsWith('Bearer ')||authorization.length>4096)throw new Error('unauthorized');
 const {payload}=await jwtVerify(authorization.slice(7),encoder.encode(env.AUTH_SECRET!),{algorithms:['HS256'],issuer,audience,requiredClaims:['sub','exp','iat'],maxTokenAge:lifetime});
 if(typeof payload.sub!=='string'||!/^u_[A-Za-z0-9_-]{43}$/.test(payload.sub))throw new Error('unauthorized');
 return {id:payload.sub};
}

export default {
 async scheduled(_event:unknown,env:Env){if(env.DB&&env.SHARE_IMAGES)await cleanExpiredShares(env.DB,env.SHARE_IMAGES);},
 async fetch(request:Request,env:Env):Promise<Response>{
  const origin=request.headers.get('Origin')??'';
  const origins=(env.ALLOWED_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean);
  const path=new URL(request.url).pathname;
  if(path.startsWith('/share-media/')&&request.method==='GET'){
   if(!env.DB)return new Response(null,{status:503});
   return publicShareImage(request,env.DB,env.SHARE_IMAGES);
  }
  if(!origin||!origins.includes(origin))return new Response(null,{status:403});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization,X-Image-Name,X-Image-Role','Access-Control-Max-Age':'600'}});
  if(path.startsWith('/library/')){
   if(!configured(env))return reply({error:'로그인 연결 준비 중이에요.'},503,origin);
   let user:{id:string};try{user=await authenticate(request,env);}catch{return reply({error:'다시 로그인해 주세요.'},401,origin);}
   if(!env.DB)return reply({error:'저장소 연결 준비 중이에요.'},503,origin);
   if(path==='/library/shares'||path.startsWith('/library/shares/'))return shareManagement(request,env.DB,user.id,origin,reply);
   const image=/^\/library\/books\/([^/]+)\/share\/images$/.exec(path);
   if(image){let bookId:string;try{bookId=decodeURIComponent(image[1]);}catch{return reply({error:'책을 찾을 수 없어요.'},404,origin);}return uploadShareImage(request,env.DB,env.SHARE_IMAGES,user.id,bookId,origin,reply);}
   const share=/^\/library\/books\/([^/]+)\/share$/.exec(path);
   if(share){let bookId:string;try{bookId=decodeURIComponent(share[1]);}catch{return reply({error:'책을 찾을 수 없어요.'},404,origin);}return manageShare(request,env.DB,user.id,bookId,origin,reply);}
   return libraryApi(request,env.DB,user.id,origin,reply);
  }
  if(path.startsWith('/shares/')){
   if(!env.DB)return reply({error:'저장소 연결 준비 중이에요.'},503,origin);
   return publicShare(request,env.DB,origin,reply);
  }
  if(path==='/auth/config'&&request.method==='GET')return configured(env)?reply({clientId:env.GOOGLE_CLIENT_ID},200,origin):reply({error:'로그인 연결 준비 중이에요.'},503,origin);
  if(path==='/auth/me'&&request.method==='GET'){
   if(!configured(env))return reply({error:'로그인 연결 준비 중이에요.'},503,origin);
   try{return reply({user:await authenticate(request,env)},200,origin);}catch{return reply({error:'다시 로그인해 주세요.'},401,origin);}
  }
  if(path!=='/auth/google')return reply({error:'찾을 수 없어요.'},404,origin);
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
   const issuedAt=Math.floor(Date.now()/1000),expiresAt=issuedAt+lifetime;
   const token=await new SignJWT({}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setSubject(id).setIssuer(issuer).setAudience(audience).setIssuedAt(issuedAt).setExpirationTime(expiresAt).sign(encoder.encode(env.AUTH_SECRET!));
   return reply({token,expiresAt:expiresAt*1000,user:{id}},200,origin);
  }catch{
   return reply({error:'로그인을 확인하지 못했어요. 다시 시도해 주세요.'},401,origin);
  }finally{reader.releaseLock();}
 }
};
