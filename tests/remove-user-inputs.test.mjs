import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../auth-worker/package.json',import.meta.url));const {build}=require('esbuild');
const bundle=await build({entryPoints:['src/lib/removeUserInputs.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {removeUserInputs}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
test('removes user inputs and remaps bookmarks and image references without mutating source',()=>{
 const book={messages:[{role:'user',name:'u',content:'private'},{role:'assistant',name:'bot',content:'output'},{role:'user',name:'u',content:'private2'},{role:'assistant',name:'bot',content:'second'}],description:'private',bookmarks:[{message:0,char:1},{message:3,char:2,progress:.5}],imageReferences:[{message:0,start:0,end:1,name:'secret'},{message:3,start:0,end:1,name:'visible'}]};
 const result=removeUserInputs(book);assert.deepEqual(result.messages.map(m=>m.content),['output','second']);assert.deepEqual(result.bookmarks,[{message:1,char:2}]);assert.deepEqual(result.imageReferences,[{message:1,start:0,end:1,name:'visible'}]);assert.equal(book.messages.length,4);assert.ok(!JSON.stringify(result).includes('private'));
});
test('identified TXT user speakers are removed; non-user roles remain',()=>{
 const book={messages:[{role:'unknown',name:'reader',content:'input'},{role:'assistant',name:'bot',content:'output'},{role:'system',name:'s',content:'metadata'}]};assert.deepEqual(removeUserInputs(book,['reader']).messages.map(m=>m.role),['assistant','system']);assert.throws(()=>removeUserInputs({messages:[{role:'user',name:'u',content:'input'}]}),/저장할 본문/);
});
