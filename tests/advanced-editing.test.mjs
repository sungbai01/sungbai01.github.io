// Run: node --test tests/advanced-editing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOffsetMapper, applyAdvancedEdits, createManuscript, updateManuscript, applyManuscript } from '../src/lib/advancedEditing.ts';
const fixture = () => ({ id: 'book', title: '책', author: '저자', description: '소개', color: '#123456', createdAt: 'before', updatedAt: 'before',
  userName: '새 이름', seriesId: 'series', volumeNumber: 2, cover: 'cover', displayRules: [{ id: 'rule' }],
  assets: [{ id: 'asset', name: '배경', src: 'data:image/png;base64,AA' }],
  messages: [
    { role: 'assistant', name: '인물', content: '앞문장 OLD 뒷문장', chapter: 'one', chapterTitle: '첫 장', chapterStart: true, pageBreakAfter: true, originalContent: '이전 이름 원문', originalMap: [{ source: 0, output: 0 }], extra: { keep: true } },
    { role: 'user', name: '새 이름', content: '  {{img::배경}}\n본문\n', chapterStart: false, originalContent: '다른 원문', originalMap: [] },
  ], bookmarks: [{ message: 0, char: 8, label: '갈피', progress: .4 }, { message: 1, char: 4 }] });

test('no-op and reverted drafts preserve book and original message references', () => {
  const book = fixture();
  assert.equal(applyAdvancedEdits(book, new Map()), book);
  assert.equal(applyAdvancedEdits(book, new Map([[0, { content: book.messages[0].content, chapterTitle: '첫 장' }]])), book);
});
test('only changed messages lose original identity fields; all other metadata survives', () => {
  const book = fixture(), snapshot = structuredClone(book);
  const next = applyAdvancedEdits(book, new Map([[0, { content: '앞문장 LONGER 뒷문장' }]]), 'after');
  assert.deepEqual(book, snapshot);
  assert.equal(next.messages[1], book.messages[1]);
  assert.equal(next.assets, book.assets);
  assert.equal(next.displayRules, book.displayRules);
  assert.equal(next.seriesId, book.seriesId);
  assert.equal(next.userName, book.userName);
  assert.equal(next.cover, book.cover);
  assert.equal(next.updatedAt, 'after');
  assert.equal(next.messages[0].role, 'assistant');
  assert.equal(next.messages[0].name, '인물');
  assert.equal(next.messages[0].chapter, 'one');
  assert.equal(next.messages[0].pageBreakAfter, true);
  assert.equal(next.messages[0].extra, book.messages[0].extra);
  assert.equal('originalContent' in next.messages[0], false);
  assert.equal('originalMap' in next.messages[0], false);
  assert.deepEqual(next.messages[1].originalMap, []);
  assert.deepEqual(next.bookmarks[0], { message: 0, char: 11, label: '갈피' });
  assert.deepEqual(next.bookmarks[1], book.bookmarks[1]);
});
test('chapter title edit preserves content, chapter flags and bookmark offsets', () => {
  const book = fixture();
  const next = applyAdvancedEdits(book, new Map([[0, { chapterTitle: '' }]]));
  assert.equal(next.messages[0].chapterTitle, '');
  assert.equal(next.messages[0].chapterStart, true);
  assert.equal(next.messages[0].content, book.messages[0].content);
  assert.deepEqual(next.bookmarks, book.bookmarks);
});
test('whitespace, blank content, raw image references and long pasted text stay exact', () => {
  const book = fixture();
  const text = ' \r\n\t{{img::배경}}\n' + '긴 글🙂\n'.repeat(100000) + '\n  ';
  const next = applyAdvancedEdits(book, new Map([[0, { content: '' }], [1, { content: text }]]));
  assert.equal(next.messages[0].content, '');
  assert.equal(next.messages[1].content, text);
  assert.equal(next.bookmarks[0].char, 0);
});
test('mapping preserves unchanged prefixes and suffixes and clamps replaced regions', () => {
  const grow = createOffsetMapper('abcXYZtail', 'abc123456tail');
  assert.equal(grow(2), 2);
  assert.equal(grow(4), 4);
  assert.equal(grow(6), 9);
  assert.equal(grow(10), 13);
  const shrink = createOffsetMapper('abc123456tail', 'abcZtail');
  assert.equal(shrink(8), 4);
  assert.equal(shrink(9), 4);
  assert.equal(shrink(10), 5);
});
test('insertions, deletions, empty strings and UTF-16 boundaries', () => {
  assert.equal(createOffsetMapper('tail', 'newtail')(0), 3);
  assert.equal(createOffsetMapper('abc', 'abcNEW')(3), 6);
  assert.equal(createOffsetMapper('', 'new')(0), 3);
  assert.equal(createOffsetMapper('abc', '')(2), 0);
  assert.equal(createOffsetMapper('🙂끝', '🙂새 글끝')(2), 5);
  const same = createOffsetMapper('abc', 'abc');
  assert.equal(same(-10), 0);
  assert.equal(same(100), 3);
  assert.equal(same(NaN), 0);
});
test('long shared prefix/suffix and every mapped offset stay ordered and in bounds', () => {
  const prefix = '앞'.repeat(150000), suffix = '뒤'.repeat(150000);
  const map = createOffsetMapper(prefix + 'OLD' + suffix, prefix + 'NEW LONG TEXT' + suffix);
  assert.equal(map(prefix.length - 1), prefix.length - 1);
  assert.equal(map(prefix.length + 3), prefix.length + 13);
  for (const [before, after] of [['abcXYZtail', 'abcQtail'], ['same', 'same'], ['', 'new'], ['x', ''], ['abc', 'xyzxyz']]) {
    const mapper = createOffsetMapper(before, after);
    let previous = -1;
    for (let offset = 0; offset <= before.length; offset++) {
      const mapped = mapper(offset);
      assert.ok(mapped >= previous && mapped <= after.length && mapped >= 0);
      previous = mapped;
    }
  }
});
test('invalid draft indexes fail without altering source', () => {
  const book = fixture(), snapshot = structuredClone(book);
  for (const index of [-1, 10, .5]) assert.throws(() => applyAdvancedEdits(book, new Map([[index, { content: 'lost' }]])));
  assert.deepEqual(book, snapshot);
});

test('whole manuscript exposes every message and keeps untouched raw boundaries',()=>{
 const book=fixture(),doc=createManuscript(book);assert.equal(doc.text,book.messages.map(m=>m.content).join('\n\n'));assert.equal(applyManuscript(book,doc),book);
 const changed=updateManuscript(doc,doc.text.replace('OLD','NEW LONG'));
 const saved=applyManuscript(book,changed);assert.equal(saved.messages[0].content,book.messages[0].content.replace('OLD','NEW LONG'));assert.equal(saved.messages[1],book.messages[1]);assert.equal(changed.text,changed.pieces.map(p=>p.text).join(''));
});
test('whole manuscript tracks later chapter offsets after edits and preserves roles',()=>{
 const book=fixture(),doc=createManuscript(book),next=updateManuscript(doc,'inserted '+doc.text);assert.equal(next.anchors[1],doc.anchors[1]+9);
 const second=updateManuscript(next,next.text.replace('본문','바뀐 본문'));const saved=applyManuscript(book,second);assert.equal(saved.messages[1].role,'user');assert.equal(saved.messages[1].content,book.messages[1].content.replace('본문','바뀐 본문'));assert.equal(saved.messages[0].content,'inserted '+book.messages[0].content);
});
test('whole manuscript replacement and cross-boundary deletes never duplicate or lose typed text',()=>{
 const book=fixture(),doc=createManuscript(book),replaced=updateManuscript(doc,'새 책 전체 본문');const saved=applyManuscript(book,replaced);assert.equal(saved.messages.map(m=>m.content).join(''),'새 책 전체 본문');
 const position=doc.anchors[1],cross=updateManuscript(doc,doc.text.slice(0,position-4)+'insert'+doc.text.slice(position+4));assert.equal(cross.pieces.map(p=>p.text).join(''),cross.text);
});
test('reverted manuscript restores exact original messages on setting-only save',()=>{const book=fixture(),doc=createManuscript(book);const changed=updateManuscript(doc,'temporary');const reverted=updateManuscript(changed,doc.text);assert.equal(applyManuscript(book,reverted),book);});

test('clearing and typing a whole chapter retains that chapter ownership',()=>{const book=fixture(),doc=createManuscript(book),offset=doc.anchors[1];let changed=updateManuscript(doc,doc.text.slice(0,offset));for(const char of '새 내용')changed=updateManuscript(changed,changed.text+char);const saved=applyManuscript(book,changed);assert.equal(saved.messages[0],book.messages[0]);assert.equal(saved.messages[1].content,'새 내용');});
test('clear-all followed by typing belongs to the first source message',()=>{const book=fixture(),doc=createManuscript(book);const cleared=updateManuscript(doc,'');const changed=updateManuscript(cleared,'새 책');const saved=applyManuscript(book,changed);assert.equal(saved.messages[0].content,'새 책');assert.equal(saved.messages[1].content,'');});
