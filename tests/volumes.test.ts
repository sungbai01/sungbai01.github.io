// Run: node --experimental-strip-types --test tests/volumes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Book } from '../src/lib/library.ts';
import { importChatFile, replaceBookWithVolumes, repackSeries } from '../src/lib/library.ts';
import { MAX_VOLUME_PAGES, chapterStarts, groupBooks, mergeLegacyVolumes, splitBookByPages, splitBookForStorage } from '../src/lib/volumes.ts';

function fixture(count: number, extra: Partial<Book> = {}) {
  const chunks = Array.from({ length: count }, (_, i) => ` \t${i} 한글😀\r\n `);
  const book: Book = {
    id: 'book', title: 'Story', author: 'Author', description: '  description ', color: '#123456',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
    cover: 'data:image/png;base64,AAAA',
    messages: [{ role: 'custom ROLE', name: '  original name  ', content: chunks.join('') }],
    ...extra,
  };
  let offset = 0;
  const pages = chunks.map((text, index) => {
    const char = offset;
    offset += text.length;
    return { intro: index === 0, fragments: [
      { message: 0, char, end: offset, text: 'display text', name: 'display name' },
    ] };
  });
  return { book, pages, chunks };
}


function withChunks(chunks: string[], extra: Partial<Book> = {}) {
  const { book } = fixture(0, extra);
  book.messages = [{ role: 'custom ROLE', name: ' original ', content: chunks.join('') }];
  let offset = 0;
  const pages = chunks.map(text => {
    const char = offset;
    offset += text.length;
    return { intro: false, fragments: [{ message: 0, char, end: offset, text: 'display', name: 'display' }] };
  });
  return { book, pages };
}

function conserve(book: Book, volumes: Book[]) {
  const fragments = volumes.flatMap(v => v.messages);
  let index = 0;
  for (const source of book.messages) {
    let content = '';
    do {
      const fragment = fragments[index++];
      assert.ok(fragment);
      const { content: _sourceContent, ...metadata } = source;
      const { content: _fragmentContent, ...actual } = fragment;
      assert.deepEqual(actual, metadata);
      content += fragment.content;
    } while (content.length < source.content.length);
    assert.equal(content, source.content);
  }
  assert.equal(index, fragments.length);
}

test('storage never pre-splits by characters, messages, or old volume IDs', () => {
  for (const extra of [{}, { id: 'series--vol-3--part-2', seriesId: 'series', volumeNumber: 3, volumeCount: 8 }]) {
    const { book } = fixture(0, { ...extra, messages: Array.from({ length: 801 }, (_, i) => ({
      role: 'x', name: ` ${i} `, chapter: ' chapter ', content: i % 2 ? '' : '😀한글\r\n'.repeat(10001),
    })) });
    assert.deepEqual(splitBookForStorage(book), [book]);
    assert.equal(splitBookForStorage(book)[0], book);
  }
  assert.equal(splitBookForStorage(fixture(0).book).length, 1);
});

test('up to 100 measured pages never split, even with many chapter boundaries', () => {
  assert.equal(MAX_VOLUME_PAGES, 100);
  for (const count of [0, 1, 27, 99, 100]) {
    const { book, pages } = withChunks(Array.from({ length: count }, (_, i) => `# Chapter ${i}\ntext\n`));
    assert.equal(splitBookByPages(book, pages)[0], book);
    assert.equal(splitBookByPages(book, pages).length, 1);
  }
});

test('long chapters hard-cut at exactly 100 pages with complete metadata conservation', () => {
  for (const count of [101, 200, 201, 350]) {
    const { book, pages, chunks } = fixture(count);
    const before = structuredClone({ book, pages });
    const volumes = splitBookByPages(book, pages);
    assert.equal(volumes.length, Math.ceil(count / 100));
    volumes.forEach((volume, i) => assert.deepEqual(volume, {
      ...book, id: i === 0 ? book.id : `${book.id}--part-${i + 1}`,
      title: `Story · ${i + 1}권`, seriesId: book.id, seriesTitle: book.title,
      volumeNumber: i + 1, volumeCount: volumes.length,
      volumePolicy: 'chapters-100-v1',
      messages: [{ ...book.messages[0], content: chunks.slice(i * 100, (i + 1) * 100).join('') }],
    }));
    conserve(book, volumes);
    assert.deepEqual({ book, pages }, before);
  }
});

test('heading offsets inside a message choose the nearest prior chapter-start page', () => {
  const chunks = Array.from({ length: 220 }, (_, i) => `page ${i}\n`);
  chunks[30] += '### Earlier chapter\n';
  chunks[85] += '## Next chapter\n';
  chunks[150] += '제 3장 다음\n';
  const { book, pages } = withChunks(chunks, { lastPage: 160 });
  assert.deepEqual(chapterStarts(book), [30, 85, 150].map(i => ({
    message: 0, char: chunks.slice(0, i).join('').length + `page ${i}\n`.length,
  })));
  const volumes = splitBookByPages(book, pages);
  assert.deepEqual(volumes.map(v => v.messages[0].content), [
    chunks.slice(0, 85).join(''), chunks.slice(85, 150).join(''), chunks.slice(150).join(''),
  ]);
  assert.deepEqual(volumes.map(v => v.lastPage), [84, 64, 10]);
  conserve(book, volumes);
});

test('chapter-start at page 100 is exact; page zero cannot produce empty volumes', () => {
  const chunks = Array.from({ length: 201 }, (_, i) => `page ${i}\n`);
  chunks[0] = 'Chapter 1\n';
  chunks[100] = 'Chapter 2\n';
  const { book, pages } = withChunks(chunks);
  const volumes = splitBookByPages(book, pages);
  assert.equal(volumes.length, 3);
  assert.equal(volumes[0].messages[0].content, chunks.slice(0, 100).join(''));
  assert.equal(volumes[1].messages[0].content, chunks.slice(100, 200).join(''));
  conserve(book, volumes);
});

test('chapter metadata changes create boundaries; speaker changes never do', () => {
  const { book } = fixture(0);
  book.messages = Array.from({ length: 151 }, (_, i) => ({
    role: `role${i}`, name: `speaker${i}`, content: `message ${i}\n`, chapter: i < 70 ? 'one' : 'two',
  }));
  const pages = book.messages.map((m, message) => ({ intro: false, fragments: [
    { message, char: 0, end: m.content.length, text: m.content, name: m.name },
  ] }));
  assert.deepEqual(chapterStarts(book), [{ message: 0, char: 0 }, { message: 70, char: 0 }]);
  assert.deepEqual(splitBookByPages(book, pages).map(v => v.messages.length), [70, 81]);
  book.messages.forEach(m => { delete m.chapter; });
  assert.deepEqual(chapterStarts(book), []);
  assert.deepEqual(splitBookByPages(book, pages).map(v => v.messages.length), [100, 51]);
});

test('only explicit line-start headings count, including CRLF offsets', () => {
  const { book } = fixture(0, { messages: [{ role: 'x', name: '# speaker', content:
    'inline # no\r\n#### no\r\n Chapter 2 no\r\nChapter 2 yes\r\n제2장 시작\r\n# title\r\n## second\r\n### third\r\nChapter prose\r\n' }] });
  const offsets = chapterStarts(book).map(start => start.char);
  assert.deepEqual(offsets, ['Chapter 2 yes', '제2장 시작', '# title', '## second', '### third'].map(t => book.messages[0].content.indexOf(t)));
});

test('empty messages and intro pages survive at the measured cut', () => {
  const { book, pages } = fixture(100);
  pages.unshift({ intro: true, fragments: [] });
  book.messages.push({ role: 'empty', name: ' ', content: '', chapter: 'end' });
  pages[100].fragments.push({ message: 1, char: 0, end: 0, text: '', name: '' });
  const volumes = splitBookByPages(book, pages);
  assert.equal(volumes[0].messages[0].content, book.messages[0].content.slice(0, pages[99].fragments[0].end));
  conserve(book, volumes);
});

test('already split IDs remain scoped to their source volume', () => {
  const { book, pages } = fixture(201, { id: 'series--vol-2', seriesId: 'series', seriesTitle: 'Original' });
  const volumes = splitBookByPages(book, pages);
  assert.deepEqual(volumes.map(v => v.id), ['series--vol-2', 'series--vol-2--part-2', 'series--vol-2--part-3']);
  const next = fixture(101, { ...volumes[1], messages: fixture(101).book.messages });
  assert.equal(splitBookByPages(next.book, next.pages)[1].id, 'series--vol-2--part-2--part-2');
  conserve(book, volumes);
});

test('stale or incomplete measured pages reject without mutation', () => {
  for (const alter of [
    (p: ReturnType<typeof fixture>['pages']) => { p[0].fragments[0].char++; },
    (p: ReturnType<typeof fixture>['pages']) => { p[1].fragments[0].char--; },
    (p: ReturnType<typeof fixture>['pages']) => { p[0].fragments[0].message = 10; },
    (p: ReturnType<typeof fixture>['pages']) => { p[100].fragments = []; },
  ]) {
    const { book, pages } = fixture(101);
    const before = structuredClone(book);
    alter(pages);
    assert.throws(() => splitBookByPages(book, pages), RangeError);
    assert.deepEqual(book, before);
  }
});

test('chapter metadata round-trips own books and normalized imports', async () => {
  const { book, pages } = fixture(101);
  book.messages[0].chapter = '  chapter 1  ';
  const volumes = splitBookByPages(book, pages);
  for (const json of [JSON.stringify(volumes)]) {
    assert.deepEqual(await importChatFile(new File([json], 'books.json')), volumes);
  }
  const imported = await importChatFile(new File([JSON.stringify({ messages: [
    { role: 'char', name: 'speaker', content: 'text', chapter: '  chapter 1  ' },
  ] })], 'chat.json'));
  assert.equal(imported[0].messages[0].chapter, '  chapter 1  ');
});

test('legacy series merge orders volumes, keeps original first ID, metadata, and all messages', () => {
  const { book } = fixture(1);
  const volumes = [3, 1, 2].map(i => ({ ...book, id: `original--part-${i}`, seriesId: 'original',
    seriesTitle: 'Series', volumeNumber: i, messages: [{ ...book.messages[0], chapter: `ch${i}`, content: ` text ${i} ` }],
  }));
  const before = structuredClone(volumes);
  const merged = mergeLegacyVolumes([volumes[0], book, volumes[1], volumes[2]]);
  assert.equal(merged[0].id, 'original--part-1');
  assert.equal(merged[0].title, 'Series');
  assert.equal(merged[0].author, book.author);
  assert.deepEqual(merged[0].messages, [volumes[1], volumes[2], volumes[0]].flatMap(v => v.messages));
  assert.equal(merged[1], book);
  assert.equal(merged[0].lastPage, 0);
  assert.deepEqual(volumes, before);
  assert.deepEqual(mergeLegacyVolumes(merged), merged);
  assert.deepEqual(groupBooks(volumes)[0].books.map(v => v.volumeNumber), [1, 2, 3]);
});

// A transaction-level IndexedDB test double: writes stay staged until commit.
// Injected request failures and synchronous enqueue failures discard both stores.
function transactionDatabase(failure: 'request' | 'enqueue' | null = null) {
  const books = new Map<string, unknown>([['original', { original: true }], ['sibling', { sibling: true }]]);
  const progress = new Map<string, unknown>([['original', 99], ['sibling', 42], ['unrelated', 7]]);
  const calls: { stores: string[]; mode: string }[] = [];
  let opens = 0;
  const api = {
    open() {
      opens++;
      const request: any = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction(stores: string[], mode: string) {
            calls.push({ stores, mode });
            const staged = { books: new Map(books), 'reading-progress': new Map(progress) };
            const operations: (() => void)[] = [];
            let aborted = false;
            let puts = 0;
            const transaction: any = {
              abort() {
                aborted = true;
                queueMicrotask(() => transaction.onabort?.());
              },
              objectStore(name: keyof typeof staged) {
                return {
                  put(value: Book) {
                    const index = ++puts;
                    if (failure === 'enqueue' && index === 2) throw new Error('enqueue failed');
                    const write: any = {};
                    operations.push(() => {
                      if (failure === 'request' && index === 2) {
                        write.error = new DOMException('quota', 'QuotaExceededError');
                        transaction.error = write.error;
                        write.onerror?.();
                        transaction.onerror?.();
                        transaction.abort();
                        return;
                      }
                      staged[name].set(value.id, structuredClone(value));
                      write.result = value.id;
                      write.onsuccess?.();
                    });
                    return write;
                  },
                  delete(id: string) {
                    operations.push(() => { staged[name].delete(id); });
                    return {};
                  },
                };
              },
            };
            queueMicrotask(() => {
              for (const operation of operations) {
                if (aborted) return;
                operation();
              }
              if (aborted) return;
              books.clear();
              progress.clear();
              staged.books.forEach((value, key) => books.set(key, value));
              staged['reading-progress'].forEach((value, key) => progress.set(key, value));
              transaction.oncomplete?.();
            });
            return transaction;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { api, books, progress, calls, get opens() { return opens; } };
}

test('replacement commits the complete series and progress cleanup atomically', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    const db = transactionDatabase();
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: db.api });
    const { book, pages } = fixture(101, { id: 'original', seriesId: 'series' });
    const volumes = splitBookByPages(book, pages);
    db.progress.set('original--part-2', 12);
    const sibling = { ...book, id: 'sibling', cover: 'https://unsafe.example/cover.png' };
    // originalId may be in the middle of the full globally renumbered series.
    const series = [sibling, ...volumes];
    await replaceBookWithVolumes('original', series);
    assert.deepEqual(db.calls, [{ stores: ['books', 'reading-progress'], mode: 'readwrite' }]);
    assert.deepEqual(db.books.get('original'), volumes[0]);
    assert.deepEqual(db.books.get('original--part-2'), volumes[1]);
    const { cover: _cover, ...sanitizedSibling } = sibling;
    assert.deepEqual(db.books.get('sibling'), sanitizedSibling);
    assert.deepEqual([...db.progress], [['unrelated', 7]]);
    assert.equal(sibling.cover, 'https://unsafe.example/cover.png');

    for (const failure of ['request', 'enqueue'] as const) {
      const failing = transactionDatabase(failure);
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: failing.api });
      const before = structuredClone({ books: failing.books, progress: failing.progress });
      await assert.rejects(replaceBookWithVolumes('original', volumes));
      assert.deepEqual({ books: failing.books, progress: failing.progress }, before);
    }

    const invalid = transactionDatabase();
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: invalid.api });
    for (const [id, supplied] of [
      ['', volumes], ['original', []], ['missing', volumes],
      ['original', [volumes[0], volumes[0]]],
      ['original', [{ ...volumes[0], volumeNumber: -1 }]],
      ['original', [{ ...volumes[0], messages: [{ role: 'user', name: 'name', content: 123 }] }]],
    ] as [string, Book[]][]) {
      await assert.rejects(replaceBookWithVolumes(id, supplied));
    }
    assert.equal(invalid.opens, 0, 'validate the complete batch before opening storage');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});


test('repack atomically removes obsolete books/progress, protects kept IDs, and rolls back failures', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    const { book, pages } = fixture(101, { id: 'original', seriesId: 'series' });
    const volumes = splitBookByPages(book, pages);
    const db = transactionDatabase();
    db.books.set('unrelated', { keep: true });
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: db.api });
    await repackSeries('original', volumes, ['sibling', 'original', 'sibling', 'missing']);
    assert.equal(db.books.has('sibling'), false);
    assert.equal(db.progress.has('sibling'), false);
    assert.deepEqual(db.books.get('original'), volumes[0]);
    assert.deepEqual(db.books.get('original--part-2'), volumes[1]);
    assert.deepEqual(db.books.get('unrelated'), { keep: true });
    assert.deepEqual([...db.progress], [['unrelated', 7]]);
    assert.deepEqual(db.calls, [{ stores: ['books', 'reading-progress'], mode: 'readwrite' }]);
    for (const failure of ['request', 'enqueue'] as const) {
      const failing = transactionDatabase(failure);
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: failing.api });
      const before = structuredClone({ books: failing.books, progress: failing.progress });
      await assert.rejects(repackSeries('original', volumes, ['sibling']));
      assert.deepEqual({ books: failing.books, progress: failing.progress }, before);
    }
    const invalid = transactionDatabase();
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: invalid.api });
    await assert.rejects(repackSeries('original', volumes, ['']));
    assert.equal(invalid.opens, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});
