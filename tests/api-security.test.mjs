import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../auth-worker/package.json',import.meta.url));
const {build}=require('esbuild');
const bundle=await build({stdin:{contents:`export {default as worker} from './auth-worker/src/index.ts';export {uploadShareImage,publicShareImage} from './auth-worker/src/shareMedia.ts';export {cleanExpiredShares} from './auth-worker/src/shareExpiry.ts';export {publicShare,manageShare} from './auth-worker/src/shares.ts';export {libraryApi} from './auth-worker/src/cloud.ts';export {shareManagement} from './auth-worker/src/shareManagement.ts';export {verifySession,issueSession,revokeSession} from './auth-worker/src/sessions.ts';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const {SignJWT}=await import('../auth-worker/node_modules/jose/dist/webapi/index.js');
const origin='https://sungbai01.github.io',owner='u_'+'a'.repeat(43),share='S'.repeat(43),now=Date.now();
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('auth-worker/schema.sql','utf8'));
 for(const file of readdirSync('auth-worker/migrations').sort())if(!file.startsWith('0002'))sql.exec(readFileSync('auth-worker/migrations/'+file,'utf8'));
 const db={prepare(text){const q=sql.prepare(text);let args=[];return {bind(...v){args=v;return this;},async first(){return q.get(...args)??null;},async all(){return {results:q.all(...args)};},async run(){return {meta:{changes:Number(q.run(...args).changes)}};}};},async batch(items){sql.exec('BEGIN');try{const values=[];for(const item of items)values.push(await item.run());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const book={id:'audit',title:'audit',author:'',description:'',color:'#123456',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[{role:'assistant',name:'a',content:'test'}]};
 sql.prepare('INSERT INTO book_shares(share_id,owner_id,book_id,body,bytes,created_at,updated_at,last_access_at,title) VALUES(?,?,?,?,?,?,?,?,?)').run(share,owner,'audit',JSON.stringify(book),100,now,now,now,'audit');
 return {sql,db};
}
const reply=(b,status)=>new Response(JSON.stringify(b),{status});
const png=size=>{const data=new Uint8Array(size);data.set([137,80,78,71,13,10,26,10]);return data;};
const upload=(db,bucket,name='audit',size=1024)=>api.uploadShareImage(new Request('https://audit/upload',{method:'POST',headers:{'X-Image-Role':'asset','X-Image-Name':name},body:png(size)}),db,bucket,owner,'audit',origin,reply);
const bucket={async put(){},async delete(){},async get(){return {body:new Blob([png(40)]).stream()};}};
test('operation exhaustion rejects without charging storage or creating orphan reservations',async()=>{
 const {db,sql}=fixture();sql.prepare('INSERT INTO share_operation_budget(month,writes) VALUES(?,10000)').run(new Date().toISOString().slice(0,7));
 for(let i=0;i<3;i++)assert.equal((await upload(db,bucket)).status,429);
 assert.equal(sql.prepare('SELECT reserved_bytes n FROM share_storage_budget').get().n,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM share_upload_reservations').get().n,0);
});
test('parallel uploads count in-flight bytes and cannot exceed 50MB',async()=>{
 const {db,sql}=fixture();for(let i=0;i<25;i++)sql.prepare('INSERT INTO share_objects VALUES(?,?,?,?)').run('old'+i,share,i===24?1000000:2000000,now);
 sql.prepare('UPDATE share_storage_budget SET reserved_bytes=49000000').run();
 let release;const gate=new Promise(r=>release=r);let waiting=0;
 const slow={...bucket,async put(){waiting++;await gate;}};
 const first=upload(db,slow,'first',1000000);while(!waiting)await new Promise(r=>setTimeout(r,1));
 const second=await upload(db,slow,'second',1000000);assert.equal(second.status,413);release();assert.equal((await first).status,200);
 assert.equal(sql.prepare('SELECT SUM(bytes) n FROM share_objects').get().n,50000000);
 assert.equal(sql.prepare('SELECT reserved_bytes n FROM share_storage_budget').get().n,50000000);
});
test('uncertain upload retains reservation until deletion, cleanup is idempotent',async()=>{
 const {db,sql}=fixture();assert.equal((await upload(db,{...bucket,async put(){throw Error('network');}})).status,503);
 assert.equal(sql.prepare('SELECT reserved_bytes n FROM share_storage_budget').get().n,1024);
 sql.prepare('UPDATE share_upload_reservations SET created_at=?').run(now-7200000);
 await assert.rejects(()=>api.cleanExpiredShares(db,{...bucket,async delete(){throw Error('network');}}));
 assert.equal(sql.prepare('SELECT reserved_bytes n FROM share_storage_budget').get().n,1024);
 await api.cleanExpiredShares(db,bucket);await api.cleanExpiredShares(db,bucket);
 assert.equal(sql.prepare('SELECT reserved_bytes n FROM share_storage_budget').get().n,0);
});
test('per-share object count and global cap include in-flight reservations',async()=>{
 const {db,sql}=fixture();sql.prepare('UPDATE share_storage_budget SET reserved_bytes=999999999').run();assert.equal((await upload(db,bucket)).status,413);
 sql.prepare('UPDATE share_storage_budget SET reserved_bytes=0').run();for(let i=0;i<64;i++)sql.prepare('INSERT INTO share_objects VALUES(?,?,?,?)').run('old'+i,share,10,now);
 assert.equal((await upload(db,bucket)).status,413);
});
const limit={async limit(){return {success:true};}};
const envFor=db=>({DB:db,AUTH_SECRET:'a'.repeat(43),SESSION_SECRET:'b'.repeat(43),GOOGLE_CLIENT_ID:'audit.apps.googleusercontent.com',ALLOWED_ORIGINS:origin,VISITOR_LIMIT:limit,AUTH_LIMIT:limit,SHARE_LIMIT:limit,ACCOUNT_LIMIT:limit});
const req=token=>new Request('https://audit/auth/me',{headers:{Origin:origin,Authorization:'Bearer '+token}});
test('new server sessions revoke copied tokens and leave other devices active',async()=>{
 const {db}=fixture(),env=envFor(db);const one=await api.issueSession(owner,env),two=await api.issueSession(owner,env);
 assert.equal((await api.verifySession(req(one.token),env)).id,owner);await api.revokeSession(req(one.token),env);
 await assert.rejects(()=>api.verifySession(req(one.token),env));assert.equal((await api.verifySession(req(two.token),env)).id,owner);
});
test('legacy tokens retain identity and expiry but become revocable',async()=>{
 const {db,sql}=fixture(),env=envFor(db);
 const token=await new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(owner).setIssuer('galpi-bookshelf-auth').setAudience('galpi-bookshelf').setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(env.AUTH_SECRET));
 assert.equal((await api.verifySession(req(token),env)).id,owner);assert.equal(sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,1);
 await api.revokeSession(req(token),env);await assert.rejects(()=>api.verifySession(req(token),env));
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',last=alphabet.indexOf(token.at(-1)),variant=token.slice(0,-1)+alphabet[last^1];
 await assert.rejects(()=>api.verifySession(req(variant),env));
});
test('session store failures are 503 rather than invalidating browser login',async()=>{
 const {db}=fixture(),env=envFor(db),session=await api.issueSession(owner,env);
 env.DB={prepare(){throw Error('D1 unavailable');}};
 assert.equal((await api.worker.fetch(req(session.token),env)).status,503);
 assert.equal((await api.worker.fetch(req('invalid'),env)).status,401);
});
test('edge throttling returns 429 before database calls and missing binding fails closed',async()=>{
 const {db}=fixture(),env=envFor(db);let calls=0;env.DB={prepare(){calls++;throw Error('should not reach DB');}};env.VISITOR_LIMIT={async limit(){return {success:false};}};
 const response=await api.worker.fetch(new Request('https://audit/shares/'+share,{headers:{Origin:origin}}),env);
 assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');assert.equal(calls,0);
 delete env.VISITOR_LIMIT;assert.equal((await api.worker.fetch(req('bad'),env)).status,503);assert.equal(calls,0);
});
test('public reads coalesce timestamp updates and obey daily ceiling',async()=>{
 const {db,sql}=fixture();const request=new Request('https://audit/shares/'+share);
 sql.prepare('UPDATE book_shares SET last_access_at=?').run(now-7200000);
 for(let i=0;i<3;i++)assert.equal((await api.publicShare(request,db,origin,reply)).status,200);
 const accessed=sql.prepare('SELECT last_access_at n FROM book_shares').get().n;assert.ok(accessed>=now);
 await api.publicShare(request,db,origin,reply);assert.equal(sql.prepare('SELECT last_access_at n FROM book_shares').get().n,accessed);
 sql.prepare('UPDATE public_read_budget SET used=20000').run();assert.equal((await api.publicShare(request,db,origin,reply)).status,429);
});
test('image cache saves R2 reads while deleted share is denied before cache hit',async()=>{
 const {db,sql}=fixture(),imageId='11111111-1111-1111-1111-111111111111';
 sql.prepare("INSERT INTO share_media VALUES(?,?,?,'asset',?,'image/png',100)").run(share,imageId,'pic','key');
 const saved=new Map();globalThis.caches={default:{async match(key){return saved.get(key.url)?.clone();},async put(key,value){saved.set(key.url,value.clone());}}};let gets=0;
 const storage={...bucket,async get(){gets++;return bucket.get();}};const request=new Request('https://audit/share-media/'+share+'/'+imageId);
 try{assert.equal((await api.publicShareImage(request,db,storage)).status,200);assert.equal((await api.publicShareImage(request,db,storage)).status,200);assert.equal(gets,1);sql.prepare('DELETE FROM book_shares').run();assert.equal((await api.publicShareImage(request,db,storage)).status,404);assert.equal(gets,1);}finally{delete globalThis.caches;}
});

test('D1 prompt validation and shared image references never rewrite raw messages',async()=>{
 const {db,sql}=fixture(),text='<img="rawToken"> [hidden] {hidden} 😀\n#keep\n$keep';
 const book={id:'audit',title:'audit',author:'',description:'',color:'#123456',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[{role:'assistant',name:'a',content:text}],displayPrompt:{id:'default',hideCurly:false,hideSquare:true}};
 const request=value=>new Request('https://audit/library/books/audit',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({book:value,baseRevision:0})});
 assert.equal((await api.libraryApi(request({...book,displayPrompt:{...book.displayPrompt,hideCurly:'false'}}),db,owner,origin,reply)).status,400);
 assert.equal((await api.libraryApi(request(book),db,owner,origin,reply)).status,200);
 const publish=new Request('https://audit/library/books/audit/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({references:[{message:0,start:0,end:16,name:'happy'}]})});
 assert.equal((await api.manageShare(publish,db,owner,'audit',origin,reply)).status,200);
 const snapshot=JSON.parse(sql.prepare('SELECT body FROM book_shares WHERE share_id=?').get(share).body);
 assert.equal(snapshot.messages[0].content,text);assert.deepEqual(snapshot.displayPrompt,book.displayPrompt);assert.deepEqual(snapshot.imageReferences,[{message:0,start:0,end:16,name:'happy'}]);
 const stored=JSON.parse(sql.prepare('SELECT body FROM books WHERE owner_id=? AND book_id=?').get(owner,'audit').body);assert.equal(stored.messages[0].content,text);
});


test('D1 accepts soakma prompt and rejects unsupported prompt ids',async()=>{
 const {db}=fixture();
 const book={id:'audit',title:'audit',author:'model',description:'',color:'#123456',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[{role:'assistant',name:'bot',content:'### 챕터 1: 제목\n😀 §§secret§§'}],displayPrompt:{id:'soakma',hideCurly:true,hideSquare:true}};
 const request=value=>new Request('https://audit/library/books/audit',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({book:value,baseRevision:0})});
 assert.equal((await api.libraryApi(request({...book,displayPrompt:{...book.displayPrompt,id:'unknown'}}),db,owner,origin,reply)).status,400);
 assert.equal((await api.libraryApi(request(book),db,owner,origin,reply)).status,200);
});


test('active share count excludes expired shares and other owners',async()=>{
 const {db,sql}=fixture();
 const add=(id,who,last)=>sql.prepare('INSERT INTO book_shares(share_id,owner_id,book_id,body,bytes,created_at,updated_at,last_access_at,title) VALUES(?,?,?,?,?,?,?,?,?)').run(id,who,id,'{}',2,now,now,last,'test');
 add('B'.repeat(43),owner,now-8*86400000);add('C'.repeat(43),'other',now);add('D'.repeat(43),owner,now);
 const response=await api.shareManagement(new Request('https://audit/library/shares?count=1'),db,owner,origin,reply);assert.equal(response.status,200);assert.deepEqual(await response.json(),{activeCount:2});
});
