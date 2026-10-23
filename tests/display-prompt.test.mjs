import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../auth-worker/package.json',import.meta.url));
const {build}=require('esbuild');
const bundled=await build({stdin:{contents:`export * from './src/lib/prose.ts';export * from './shared/displayPrompt.ts';export {cloudBook} from './shared/cloudBook.ts';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {visibleProse,displayHiddenRanges,normalizeDisplayPrompt,validDisplayPrompt,cloudBook}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
test('default prompt enables both hiding options with strict schema',()=>{assert.deepEqual(normalizeDisplayPrompt(undefined),{id:'default',hideCurly:true,hideSquare:true});assert.equal(validDisplayPrompt({id:'other',hideCurly:true,hideSquare:true}),false);assert.equal(validDisplayPrompt({id:'default',hideCurly:'false',hideSquare:true}),false);});
test('curly and square rules are display only and independently reversible',()=>{const source='start {inner {nested} end} middle [hidden [nested] end] finish';assert.equal(visibleProse(source),'start  middle  finish');assert.equal(visibleProse(source,{id:'default',hideCurly:false,hideSquare:true}),'start {inner {nested} end} middle  finish');assert.equal(visibleProse(source,{id:'default',hideCurly:false,hideSquare:false}),source);});
test('emoji dollar hash and angle-tag text remain visible',()=>{const source='😀\n$keep\n#keep\n<system foo="bar">body</system>';assert.equal(visibleProse(source),source);});
test('image markers are protected inside bracket and curly blocks',()=>{const source='{hidden <img="happy"> tail} [hidden [img:happy] tail]';const ranges=displayHiddenRanges(source);assert.ok(ranges.length);assert.equal(visibleProse(source),' ');assert.equal(source,'{hidden <img="happy"> tail} [hidden [img:happy] tail]');});
test('default hides user macros too and disabling restores them',()=>{assert.equal(visibleProse('{{user}} said [secret] {meta}'),' said  ');assert.equal(visibleProse('{{user}}',{id:'default',hideCurly:false,hideSquare:true}),'{{user}}');});
test('hidden ranges use original offsets and handle unfinished blocks',()=>{const source='abc[unfinished';assert.deepEqual(displayHiddenRanges(source),[{start:3,end:14}]);assert.equal(visibleProse(source),'abc');});
test('cloud serialization preserves raw prose and display settings',()=>{const content=' [raw] {raw} <img="x"> 😀\n$keep\n#keep ';const book={id:'raw',title:'raw',author:'',description:'',createdAt:'',updatedAt:'',color:'#123456',messages:[{role:'user',name:'user',content}],displayPrompt:{id:'default',hideCurly:false,hideSquare:true}};const result=cloudBook(book);assert.equal(result.messages[0].content,content);assert.deepEqual(result.displayPrompt,book.displayPrompt);});


test('common dollar-only line hiding preserves dollar prose and original offsets',()=>{
 const source='first\n$\n  $ \r\n$keep\nprice $5\n$$\nlast\n$';
 const prompt={id:'default',hideCurly:false,hideSquare:false};
 assert.equal(visibleProse(source,prompt),'first\n$keep\nprice $5\n$$\nlast\n');
 for(const range of displayHiddenRanges(source,prompt))assert.equal(source.slice(range.start,range.end).trim(),'$');
});


test('soakma hides heading lines emoji and section blocks without changing original offsets',()=>{
 const prompt={id:'soakma',hideCurly:false,hideSquare:false};
 assert.equal(validDisplayPrompt(prompt),true);assert.deepEqual(normalizeDisplayPrompt(prompt),prompt);
 const source='# hidden\n## hidden\r\n### 챕터 1: 침대 밑의 잡동사니\n#### hidden\n##### kept\nvisible 👩🏽‍💻🇰🇷1️⃣ text §secret§ rest §§more\nsecret§§ end';
 assert.equal(visibleProse(source,prompt),'##### kept\nvisible  text  rest  end');
 assert.equal(visibleProse('visible §§unfinished',prompt),'visible ');
 const base={id:'default',hideCurly:false,hideSquare:false};assert.equal(visibleProse(source,base),source);
 const book={id:'s',title:'s',author:'',description:'',color:'#123456',createdAt:'',updatedAt:'',messages:[{role:'assistant',name:'bot',content:source}],displayPrompt:prompt};assert.deepEqual(cloudBook(book).displayPrompt,prompt);assert.equal(cloudBook(book).messages[0].content,source);
});
