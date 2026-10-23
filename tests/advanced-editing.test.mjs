// Run: node --test tests/advanced-editing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOffsetMapper, applyAdvancedEdits } from '../src/lib/advancedEditing.ts';
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
