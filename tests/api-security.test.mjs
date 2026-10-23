import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../auth-worker/package.json',import.meta.url));
const {build}=require('esbuild');
const bundle=await build({stdin:{contents:`export {default as worker} from './auth-worker/src/index.ts';export {uploadShareImage,publicShareImage} from './auth-worker/src/shareMedia.ts';export {cleanExpiredShares} from './auth-worker/src/shareExpiry.ts';export {publicShare,manageShare} from './auth-worker/src/shares.ts';export {libraryApi} from './auth-worker/src/cloud.ts';export {shareManagement} from './auth-worker/src/shareManagement.ts';export {verifySession,issueSession,revokeSession} from './auth-worker/src/sessions.ts';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const extra=await build({stdin:{contents:`export {prepareShareImages} from './auth-worker/src/shareMedia.ts';export {saveShareCardLayout} from './auth-worker/src/shareCard.ts';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const api={...await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64')),...await import('data:text/javascript;base64,'+Buffer.from(extra.outputFiles[0].contents).toString('base64'))};
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

test('unknown and expired shares never consume the successful public read budget',async()=>{
 const {db,sql}=fixture();
 assert.equal((await api.publicShare(new Request('https://audit/shares/'+'Z'.repeat(43)),db,origin,reply)).status,404);
 sql.prepare('UPDATE book_shares SET last_access_at=?').run(now-8*86400000);
 assert.equal((await api.publicShare(new Request('https://audit/shares/'+share),db,origin,reply)).status,404);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM public_read_budget').get().n,0);
});

test('publish refuses a source deleted or edited while reading request references',async()=>{
 for(const deleted of [true,false]){
  const {db,sql}=fixture();const book=JSON.parse(sql.prepare('SELECT body FROM book_shares').get().body);
  assert.equal((await api.libraryApi(new Request('https://audit/library/books/audit',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({book,baseRevision:0})}),db,owner,origin,reply)).status,200);
  let release,started;const gate=new Promise(r=>release=r),reading=new Promise(r=>started=r);
  const request=new Request('https://audit/library/books/audit/share',{method:'POST',body:'{}'});
  Object.defineProperty(request,'body',{value:new ReadableStream({async pull(controller){started();await gate;controller.enqueue(new TextEncoder().encode('{"references":[]}'));controller.close();}},{highWaterMark:0})});
  const pending=api.manageShare(request,db,owner,'audit',origin,reply);await reading;
  sql.prepare('UPDATE books SET deleted=?,revision=revision+1 WHERE owner_id=? AND book_id=?').run(deleted?1:0,owner,'audit');
  sql.prepare('DELETE FROM book_shares').run();release();
  assert.equal((await pending).status,409);assert.equal(sql.prepare('SELECT COUNT(*) n FROM book_shares').get().n,0);
 }
});

test('new uploads count images reused from other shares before touching R2',async()=>{
 const {db,sql}=fixture();
 for(let i=0;i<25;i++){
  const key='reused'+i;sql.prepare('INSERT INTO share_objects VALUES(?,?,?,?)').run(key,'T'.repeat(43),2000000,now);
  sql.prepare('INSERT INTO share_media VALUES(?,?,?,?,?,?,?)').run(share,'img'+i,'asset'+i,'asset',key,'image/png',2000000);
 }
 let puts=0;assert.equal((await upload(db,{...bucket,async put(){puts++;}},'fresh',1000)).status,413);
 assert.equal(puts,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM share_upload_reservations').get().n,0);
});

test('image reuse counts pending upload reservations',async()=>{
 const {db,sql}=fixture();await upload(db,bucket,'first',1000);
 for(let i=0;i<24;i++)sql.prepare('INSERT INTO share_media VALUES(?,?,?,?,?,?,?)').run(share,'reused'+i,'reused'+i,'asset','external'+i,'image/png',2000000);
 sql.prepare('INSERT INTO share_upload_reservations(object_key,share_id,bytes,created_at,owner_id) VALUES(?,?,?,?,?)').run('pending',share,1998500,now,owner);
 const hash=sql.prepare('SELECT content_hash FROM share_object_info').get().content_hash;
 const response=await api.prepareShareImages(new Request('https://audit/images',{method:'PUT',body:JSON.stringify({images:[{name:'copy',role:'asset',hash}]})}),db,owner,'audit',origin,reply);
 assert.equal(response.status,200);assert.equal((await response.json()).images[0].url,null);
});

test('referenced image count and pending uploads cannot exceed 64 entries',async()=>{
 const {db,sql}=fixture();await upload(db,bucket,'first',1000);
 for(let i=0;i<62;i++)sql.prepare('INSERT INTO share_media VALUES(?,?,?,?,?,?,?)').run(share,'reused'+i,'reused'+i,'asset','external'+i,'image/png',1000);
 sql.prepare('INSERT INTO share_upload_reservations(object_key,share_id,bytes,created_at,owner_id) VALUES(?,?,?,?,?)').run('pending',share,1000,now,owner);
 assert.equal((await upload(db,bucket,'fresh')).status,413);
 const hash=sql.prepare('SELECT content_hash FROM share_object_info').get().content_hash;
 const response=await api.prepareShareImages(new Request('https://audit/images',{method:'PUT',body:JSON.stringify({images:[{name:'copy',role:'asset',hash}]})}),db,owner,'audit',origin,reply);
 assert.equal((await response.json()).images[0].url,null);
});
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

test('account quota includes pending uploads and verified duplicates reuse storage',async()=>{
 const {db,sql}=fixture();let puts=0;const storage={...bucket,async put(){puts++;}};
 assert.equal((await upload(db,storage,'first')).status,200);
 const again=await upload(db,storage,'first');assert.equal(again.status,200);assert.equal((await again.json()).reused,true);assert.equal(puts,1);
 const hash=sql.prepare('SELECT content_hash FROM share_object_info').get().content_hash;
 const manifest=who=>api.prepareShareImages(new Request('https://audit/images',{method:'PUT',body:JSON.stringify({images:[{name:'copy',role:'asset',hash}]})}),db,who,'audit',origin,reply);
 assert.ok((await (await manifest(owner)).json()).images[0].url);assert.equal((await manifest('another')).status,404);assert.equal(puts,1);
 sql.prepare('DELETE FROM share_media WHERE name=?').run('copy');sql.prepare('UPDATE share_object_info SET deleting=1').run();assert.equal((await (await manifest(owner)).json()).images[0].url,null);
 for(let i=0;i<49;i++){sql.prepare('INSERT INTO share_objects VALUES(?,?,?,?)').run('account'+i,'other',2000000,now);sql.prepare('INSERT INTO share_object_info(object_key,owner_id) VALUES(?,?)').run('account'+i,owner);}
 sql.prepare('UPDATE share_storage_budget SET reserved_bytes=98001024').run();
 let release,waiting=false;const gate=new Promise(r=>release=r);const slow={...bucket,async put(){waiting=true;await gate;}};
 const first=upload(db,slow,'pending',900000);while(!waiting)await new Promise(r=>setTimeout(r,1));
 try{const response=await upload(db,slow,'over',2000000);assert.equal(response.status,413);assert.match((await response.json()).error,/100MB/);}finally{release();}assert.equal((await first).status,200);
});

test('card layouts and storage totals are returned only to their owner',async()=>{
 const {db,sql}=fixture();await upload(db,bucket);const value={title:'ticket title',quote:'a quote',quotePages:{start:1,end:2},imagePosition:.5};
 const request=data=>new Request('https://audit/card',{method:'PUT',body:JSON.stringify(data)});
 assert.equal((await api.saveShareCardLayout(request(value),db,owner,'audit',origin,reply)).status,200);
 assert.equal((await api.saveShareCardLayout(request({...value,backgroundUrl:'javascript:alert(1)'}),db,owner,'audit',origin,reply)).status,400);
 assert.equal((await api.saveShareCardLayout(request(value),db,'another','audit',origin,reply)).status,404);
 sql.prepare('INSERT INTO share_history(share_id,owner_id,book_id,title,created_at,expired_at) VALUES(?,?,?,?,?,?)').run('H'.repeat(43),owner,'old','old',now-100,now-10);
 const result=await (await api.shareManagement(new Request('https://audit/library/shares'),db,owner,origin,reply)).json();assert.equal(result.shares.length,2);assert.equal(result.shares[0].card.title,'ticket title');assert.deepEqual(result.shares[0].card.quotePages,{start:1,end:2});assert.equal(result.imageBytes,1024);assert.equal(result.imageLimit,100000000);assert.equal(result.urlLimit,10);
 const other=await (await api.shareManagement(new Request('https://audit/library/shares'),db,'another',origin,reply)).json();assert.deepEqual(other.shares,[]);assert.equal(other.imageBytes,0);
});

test('account can publish ten active URLs and update existing ones',async()=>{
 const {db,sql}=fixture();const body=sql.prepare('SELECT body FROM book_shares').get().body;
 for(let i=0;i<9;i++)sql.prepare('INSERT INTO book_shares(share_id,owner_id,book_id,body,bytes,created_at,updated_at,last_access_at,title) VALUES(?,?,?,?,?,?,?,?,?)').run(String(i).repeat(43),owner,'old'+i,body,100,now,now,now,'old');
 const publish=async id=>{sql.prepare('DELETE FROM share_rate_limits').run();return api.manageShare(new Request('https://audit/share',{method:'POST',body:JSON.stringify({references:[]})}),db,owner,id,origin,reply);};
 for(const id of ['newbook','audit'])sql.prepare('INSERT INTO books(owner_id,book_id,body,bytes,revision,updated_at,deleted) VALUES(?,?,?,?,1,?,0)').run(owner,id,body,body.length,now);
 assert.equal((await publish('newbook')).status,413);assert.equal((await publish('audit')).status,200);
 sql.prepare('UPDATE book_shares SET last_access_at=? WHERE book_id=?').run(now-8*86400000,'old0');assert.equal((await publish('newbook')).status,200);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM book_shares WHERE last_access_at>?').get(now-7*86400000).n,10);
});

test('deduplicated image stays alive while another active share references it',async()=>{
 const {db,sql}=fixture();await upload(db,bucket,'first');const target='T'.repeat(43),body=sql.prepare('SELECT body FROM book_shares').get().body;
 sql.prepare('INSERT INTO book_shares(share_id,owner_id,book_id,body,bytes,created_at,updated_at,last_access_at,title) VALUES(?,?,?,?,?,?,?,?,?)').run(target,owner,'second',body,100,now,now,now,'second');
 const hash=sql.prepare('SELECT content_hash FROM share_object_info').get().content_hash;
 const response=await api.prepareShareImages(new Request('https://audit/images',{method:'PUT',body:JSON.stringify({images:[{name:'copy',role:'asset',hash}]})}),db,owner,'second',origin,reply);assert.ok((await response.json()).images[0].url);
 sql.prepare('UPDATE share_objects SET created_at=?').run(now-7200000);sql.prepare('DELETE FROM book_shares WHERE share_id=?').run(share);let deletes=0;const storage={...bucket,async delete(){deletes++;}};
 await api.cleanExpiredShares(db,storage);assert.equal(deletes,0);
 sql.prepare('DELETE FROM book_shares').run();await api.cleanExpiredShares(db,storage);assert.equal(deletes,1);assert.equal(sql.prepare('SELECT reserved_bytes n FROM share_storage_budget').get().n,0);
});

test('saved share settings load privately and unchanged refreshes do not write or consume publish quota',async()=>{
 const {db,sql}=fixture(),body=sql.prepare('SELECT body FROM book_shares').get().body;
 sql.prepare('INSERT INTO books(owner_id,book_id,body,bytes,revision,updated_at) VALUES(?,?,?,?,1,?)').run(owner,'audit',body,body.length,now);
 const request=()=>new Request('https://audit/share',{method:'POST',body:JSON.stringify({references:[],bookmarkStyle:'image'})});
 assert.equal((await api.manageShare(request(),db,owner,'audit',origin,reply)).status,200);
 const first=sql.prepare('SELECT updated_at FROM book_shares').get().updated_at,writes=sql.prepare('SELECT used FROM share_rate_limits WHERE kind=?').get('publish').used;
 const same=await api.manageShare(request(),db,owner,'audit',origin,reply);assert.equal((await same.json()).changed,false);assert.equal(sql.prepare('SELECT updated_at FROM book_shares').get().updated_at,first);assert.equal(sql.prepare('SELECT used FROM share_rate_limits WHERE kind=?').get('publish').used,writes);
 const layout={title:'saved title',quote:'saved quote',quotePages:{start:7,end:8},imagePosition:.75,backgroundName:'portrait'};
 const cardRequest=()=>new Request('https://audit/card',{method:'PUT',body:JSON.stringify(layout)});
 assert.equal((await api.saveShareCardLayout(cardRequest(),db,owner,'audit',origin,reply)).status,200);
 assert.equal((await (await api.saveShareCardLayout(cardRequest(),db,owner,'audit',origin,reply)).json()).changed,false);
 const loaded=await (await api.manageShare(new Request('https://audit/share'),db,owner,'audit',origin,reply)).json();assert.deepEqual(loaded.share.card,layout);assert.match(loaded.share.contentHash,/^[a-f0-9]{64}$/);assert.deepEqual(loaded.share.images,[]);
 assert.equal((await (await api.manageShare(new Request('https://audit/share'),db,'stranger','audit',origin,reply)).json()).share,null);
});

test('legacy image comparison reads once, never uploads, and finalizes only complete manifests',async()=>{
 const {db,sql}=fixture();let puts=0,gets=0;const data=png(40),storage={...bucket,async put(){puts++;},async get(){gets++;return {body:new Blob([data]).stream()};}};
 await upload(db,storage,'old',40);sql.prepare('UPDATE share_object_info SET content_hash=NULL').run();const hash=Buffer.from(await crypto.subtle.digest('SHA-256',data)).toString('hex');
 const check=(images,complete=false)=>api.prepareShareImages(new Request('https://audit/images',{method:'PUT',body:JSON.stringify({images,complete})}),db,owner,'audit',origin,reply,storage);
 const image={name:'old',role:'asset',hash};assert.ok((await (await check([image])).json()).images[0].url);assert.equal(gets,1);assert.equal(puts,1);
 assert.ok((await (await check([image])).json()).images[0].url);assert.equal(gets,1);
 assert.equal((await check([{name:'missing',role:'asset',hash:'0'.repeat(64)}],true)).status,409);assert.equal(sql.prepare('SELECT COUNT(*) n FROM share_media').get().n,1);
 assert.equal((await check([],true)).status,200);assert.equal(sql.prepare('SELECT COUNT(*) n FROM share_media').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM share_objects').get().n,1);
});

test('public book opens count atomically, owner previews and image requests do not count',async()=>{
 const {db,sql}=fixture();const request=new Request('https://audit/shares/'+share);
 await Promise.all(Array.from({length:8},()=>api.publicShare(request,db,origin,reply)));
 assert.equal(sql.prepare('SELECT view_count n FROM book_shares').get().n,8);
 await api.manageShare(new Request('https://audit/share'),db,owner,'audit',origin,reply);
 const list=await (await api.shareManagement(new Request('https://audit/library/shares'),db,owner,origin,reply)).json();assert.equal(list.shares[0].views,8);
 assert.equal((await api.publicShare(new Request('https://audit/shares/'+share,{method:'POST'}),db,origin,reply)).status,404);assert.equal(sql.prepare('SELECT view_count n FROM book_shares').get().n,8);
 sql.prepare('UPDATE book_shares SET last_access_at=?').run(now-8*86400000);await api.cleanExpiredShares(db,bucket);assert.equal(sql.prepare('SELECT view_count n FROM share_history WHERE share_id=?').get(share).n,8);
});

test('generated card uploads obey the same storage and deduplication limits',async()=>{
 const {db}=fixture();const response=await api.uploadShareImage(new Request('https://audit/upload',{method:'POST',headers:{'X-Image-Role':'card','X-Image-Name':'ticket'},body:png(40)}),db,bucket,owner,'audit',origin,reply);assert.equal(response.status,200);
});


test('normal image finalization preserves the generated card reference',async()=>{
 const {db,sql}=fixture();await api.uploadShareImage(new Request('https://audit/upload',{method:'POST',headers:{'X-Image-Role':'card','X-Image-Name':'__galpi_ticket_card__'},body:png(40)}),db,bucket,owner,'audit',origin,reply);
 const response=await api.prepareShareImages(new Request('https://audit/images',{method:'PUT',body:JSON.stringify({images:[],complete:true})}),db,owner,'audit',origin,reply);assert.equal(response.status,200);assert.equal(sql.prepare("SELECT COUNT(*) n FROM share_media WHERE role='card'").get().n,1);
});

test('image URLs carry the real extension while legacy URLs share bytes and access checks',async()=>{
 const {db,sql}=fixture();let gets=0;const payloads=new Map();const storage={async put(key,value){payloads.set(key,value);},async delete(key){payloads.delete(key);},async get(key){gets++;return payloads.has(key)?{body:new Blob([payloads.get(key)]).stream()}:null;}};
 const types=[{mime:'image/png',extension:'png',data:png(40)},{mime:'image/jpeg',extension:'jpg',data:new Uint8Array([255,216,255,0,0,0,0,0])},{mime:'image/webp',extension:'webp',data:new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80,0,0,0,0,0,0,0,0])}];
 for(const item of types){const request=new Request('https://audit/images',{method:'POST',headers:{'X-Image-Role':'asset','X-Image-Name':item.extension},body:item.data});const posted=await api.uploadShareImage(request,db,storage,owner,'audit',origin,reply);assert.equal(posted.status,200);const {url}=await posted.json();assert.ok(url.endsWith('.'+item.extension));
 const current=await api.publicShareImage(new Request(url,{headers:{Origin:'https://arca.live'}}),db,storage),old=await api.publicShareImage(new Request(url.replace(/\.[a-z]+$/,'')),db,storage);assert.equal(current.status,200);assert.equal(old.status,200);assert.equal(current.headers.get('Content-Type'),item.mime);assert.equal(current.headers.get('Access-Control-Allow-Origin'),'*');assert.deepEqual(new Uint8Array(await current.arrayBuffer()),item.data);assert.deepEqual(new Uint8Array(await old.arrayBuffer()),item.data);
 const before=gets;assert.equal((await api.publicShareImage(new Request(url.replace(/\.[a-z]+$/,'.gif')),db,storage)).status,404);assert.equal((await api.publicShareImage(new Request(url.replace(/\.[a-z]+$/,'.'+(item.extension==='png'?'webp':'png'))),db,storage)).status,404);assert.equal(gets,before);
 if(item.extension==='jpg')assert.equal((await api.publicShareImage(new Request(url.replace(/\.jpg$/,'.jpeg')),db,storage)).status,200);
 const reused=await api.uploadShareImage(new Request('https://audit/images',{method:'POST',headers:{'X-Image-Role':'asset','X-Image-Name':item.extension},body:item.data}),db,storage,owner,'audit',origin,reply);assert.equal((await reused.json()).url,url);
 }
 const publicBook=await (await api.publicShare(new Request('https://audit/shares/'+share),db,origin,reply)).json();for(const asset of publicBook.book.assets)assert.match(asset.src,/\.(png|jpg|webp)$/);
 const settings=await (await api.manageShare(new Request('https://audit/share'),db,owner,'audit',origin,reply)).json();for(const image of settings.share.images)assert.match(image.url,/\.(png|jpg|webp)$/);
 sql.prepare("UPDATE share_media SET name='__galpi_cover_icon__' WHERE name='png'").run();const managed=await (await api.shareManagement(new Request('https://audit/library/shares'),db,owner,origin,reply)).json();assert.match(managed.shares[0].card.backgroundUrl,/\.png$/);
 const url=settings.share.images[0].url;sql.prepare('UPDATE book_shares SET last_access_at=?').run(now-8*86400000);const before=gets;assert.equal((await api.publicShareImage(new Request(url),db,storage)).status,404);assert.equal(gets,before);assert.equal(payloads.size,3);
});

test('public image HEAD works cross-origin without R2 reads, respects expiry and throttling',async()=>{
 const {db,sql}=fixture();const uploaded=await upload(db,bucket,'head',1024);const {url}=await uploaded.json();let gets=0;const env={...envFor(db),SHARE_IMAGES:{...bucket,async get(){gets++;return bucket.get();}}};
 for(const requestOrigin of ['https://arca.live','']){const response=await api.worker.fetch(new Request(url,{method:'HEAD',headers:requestOrigin?{Origin:requestOrigin}:{}}),env);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('Content-Length'),'1024');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(await response.text(),'');}
 assert.equal(gets,0);assert.equal(sql.prepare('SELECT view_count n FROM book_shares').get().n,0);assert.equal(sql.prepare('SELECT SUM(reads) n FROM share_operation_budget').get().n,0);
 env.SHARE_LIMIT={async limit(){return {success:false};}};assert.equal((await api.worker.fetch(new Request(url,{method:'HEAD'}),env)).status,429);env.SHARE_LIMIT=limit;
 sql.prepare('UPDATE book_shares SET last_access_at=?').run(now-8*86400000);assert.equal((await api.worker.fetch(new Request(url,{method:'HEAD'}),env)).status,404);assert.equal(gets,0);
});
