// Run: node --experimental-strip-types --test tests/volumes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Book } from '../src/lib/library.ts';
import { exportBackup, importChatFile, replaceBookWithVolumes } from '../src/lib/library.ts';
import {
  MAX_VOLUME_PAGES, MAX_VOLUME_CHARACTERS, MAX_VOLUME_MESSAGES,
  groupBooks, splitBookByPages, splitBookForStorage,
} from '../src/lib/volumes.ts';

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

function assertStorageConserved(source: Book, volumes: Book[]) {
  const fragments = volumes.flatMap(volume => volume.messages);
  let index = 0;
  for (const message of source.messages) {
    let content = '';
    do {
      const fragment = fragments[index++];
      assert.ok(fragment, 'every source message must be represented, including empty messages');
      assert.equal(fragment.role, message.role);
      assert.equal(fragment.name, message.name);
      content += fragment.content;
    } while (content.length < message.content.length);
    assert.equal(content, message.content);
  }
  assert.equal(index, fragments.length, 'no duplicate or extra messages');
  for (const volume of volumes) {
    assert.ok(volume.messages.length > 0 && volume.messages.length <= MAX_VOLUME_MESSAGES);
    assert.ok(volume.messages.reduce((total, message) => total + message.content.length, 0) <= MAX_VOLUME_CHARACTERS);
  }
}

test('coarse split is a no-op at both exact limits, including an empty book', () => {
  assert.equal(MAX_VOLUME_CHARACTERS, 10000);
  assert.equal(MAX_VOLUME_MESSAGES, 100);
  for (const messages of [[], [{ role: 'x', name: '', content: 'a'.repeat(10000) }],
    Array.from({ length: 100 }, () => ({ role: 'x', name: ' n ', content: 'b'.repeat(100) })),
  ]) {
    const { book } = fixture(0, { messages });
    assert.equal(splitBookForStorage(book)[0], book);
    assert.equal(splitBookForStorage(book).length, 1);
  }
});

test('coarse split conserves 800 messages exactly while bounding both budgets', () => {
  const { book } = fixture(0, {
    messages: Array.from({ length: 800 }, (_, index) => ({
      role: `ROLE ${index % 3}`, name: ` \t${index} `,
      content: index % 11 === 0 ? '' : ` \r\n한글😀\t${index} `.repeat(index % 13 + 1),
    })),
  });
  const snapshot = structuredClone(book);
  const volumes = splitBookForStorage(book);
  assert.ok(volumes.length > 1);
  assertStorageConserved(book, volumes);
  assert.deepEqual(book, snapshot);
  assert.deepEqual(splitBookForStorage(book), volumes);
  for (const volume of volumes) assert.equal(splitBookForStorage(volume)[0], volume);
});

test('coarse message cap includes empty messages and preserves distinct message boundaries', () => {
  const { book } = fixture(0, { messages: Array.from({ length: 201 }, () => ({ role: 'same', name: '', content: '' })) });
  const volumes = splitBookForStorage(book);
  assert.deepEqual(volumes.map(volume => volume.messages.length), [100, 100, 1]);
  assertStorageConserved(book, volumes);
});

test('coarse split handles huge messages, Unicode pairs and one-unit remaining capacity', () => {
  for (const messages of [
    [{ role: 'CHAR', name: '\t ', content: 'a'.repeat(9999) + '😀' + '한글\r\n '.repeat(6000) }],
    [{ role: 'CHAR', name: '\t ', content: '😀'.repeat(15001) }],
    [{ role: 'user', name: '', content: 'a'.repeat(9999) },
      { role: 'assistant', name: ' n ', content: '😀'.repeat(6000) }],
  ]) {
    const { book } = fixture(0, { messages });
    const volumes = splitBookForStorage(book);
    assertStorageConserved(book, volumes);
    for (const volume of volumes) {
      for (const message of volume.messages) {
        assert.equal(message.content.isWellFormed(), true);
        assert.ok(message.content.length > 0, 'no artificial empty fragments');
      }
    }
  }
});

test('coarse split preserves existing series metadata and resets uncertain page offsets', async () => {
  const { book } = fixture(0, {
    id: 'series--vol-3', seriesId: 'series', seriesTitle: 'Original', volumeNumber: 3, volumeCount: 5, lastPage: 800,
    messages: [{ role: 'CHAR', name: '  name  ', content: ' \r\n😀\t'.repeat(4000) }],
  });
  const volumes = splitBookForStorage(book);
  assertStorageConserved(book, volumes);
  volumes.forEach((volume, index) => {
    assert.deepEqual(volume, {
      ...book, id: index === 0 ? book.id : `${book.id}--part-${index + 1}`,
      title: `Original · ${index + 1}권`, volumeNumber: index + 1, volumeCount: volumes.length,
      messages: volume.messages, lastPage: 0,
    });
  });
  const restored = await importChatFile(new File([await exportBackup(volumes).text()], 'books.json'));
  assert.deepEqual(restored, volumes);
  assertStorageConserved(book, restored);
  assert.equal(book.lastPage, 800);
});

test('coarse caps hold together when message 100 crosses the character budget', () => {
  const { book } = fixture(0, {
    messages: [
      ...Array.from({ length: 99 }, (_, i) => ({ role: `role-${i}`, name: ` name-${i} `, content: 'a'.repeat(101) })),
      { role: 'last', name: '', content: '😀'.repeat(10000) },
      { role: 'empty', name: ' ', content: '' },
    ],
  });
  assertStorageConserved(book, splitBookForStorage(book));
});

test('0 through 60 measured pages retain the original object', () => {
  assert.equal(MAX_VOLUME_PAGES, 60);
  for (const count of [0, 1, 59, 60]) {
    const { book, pages } = fixture(count);
    assert.deepEqual(splitBookByPages(book, pages), [book]);
    assert.equal(splitBookByPages(book, pages)[0], book);
  }
});

test('61, 120, and 121 pages split exactly, retaining whitespace and all metadata', () => {
  for (const count of [61, 120, 121]) {
    const { book, pages, chunks } = fixture(count);
    const snapshot = structuredClone({ book, pages });
    const volumes = splitBookByPages(book, pages);
    assert.equal(volumes.length, Math.ceil(count / 60));
    volumes.forEach((volume, i) => {
      assert.deepEqual(volume, {
        ...book, id: i === 0 ? book.id : `${book.id}--part-${i + 1}`,
        title: `Story · ${i + 1}권`, seriesId: book.id, seriesTitle: book.title,
        volumeNumber: i + 1, volumeCount: volumes.length,
        messages: [{ ...book.messages[0], content: chunks.slice(i * 60, (i + 1) * 60).join('') }],
      });
    });
    assert.equal(volumes.flatMap(v => v.messages).map(m => m.content).join(''), book.messages[0].content);
    assert.deepEqual({ book, pages }, snapshot);
    assert.deepEqual(splitBookByPages(book, pages), volumes);
  }
});

test('splitting existing volumes and then their parts cannot reuse sibling IDs', () => {
  const { book, pages } = fixture(121, { id: 'series--vol-2', seriesId: 'series', seriesTitle: 'Original' });
  const volumes = splitBookByPages(book, pages);
  assert.deepEqual(volumes.map(v => v.id), ['series--vol-2', 'series--vol-2--part-2', 'series--vol-2--part-3']);
  assert.ok(volumes.every(v => v.seriesId === 'series' && v.seriesTitle === 'Original'));
  // Re-measure the part's own source, as the Reader does.
  const remeasured = fixture(61, { id: volumes[1].id, seriesId: 'series', seriesTitle: 'Original' });
  assert.equal(splitBookByPages(remeasured.book, remeasured.pages)[1].id, 'series--vol-2--part-2--part-2');
});

test('progress maps to each local page range', () => {
  for (const [lastPage, expected] of [
    [0, [0, 0, 0]], [59, [59, 0, 0]], [60, [59, 0, 0]],
    [87, [59, 27, 0]], [120, [59, 59, 0]], [999, [59, 59, 0]],
  ] as const) {
    const { book, pages } = fixture(121, { lastPage });
    assert.deepEqual(splitBookByPages(book, pages).map(v => v.lastPage), expected);
  }
});

test('empty messages, multiple messages per page, and source speaker fields survive', () => {
  const { book, pages } = fixture(61);
  book.messages.push({ role: 'user', name: '', content: '' }, { role: 'system', name: '\t', content: ' \r\nlast\t ' });
  pages[60].fragments.push(
    { message: 1, char: 0, end: 0, text: '', name: 'fallback' },
    { message: 2, char: 0, end: book.messages[2].content.length, text: 'wrong', name: 'wrong' },
  );
  assert.deepEqual(splitBookByPages(book, pages)[1].messages.slice(1), book.messages.slice(1));
});

test('intro-only pages count toward volume boundaries', () => {
  const { book, pages, chunks } = fixture(60);
  pages.unshift({ intro: true, fragments: [] });
  const volumes = splitBookByPages(book, pages);
  assert.equal(volumes[0].messages[0].content, chunks.slice(0, 59).join(''));
  assert.equal(volumes[1].messages[0].content, chunks[59]);
});

test('incomplete or stale pagination fails without modifying the source', () => {
  for (const alter of [
    (p: ReturnType<typeof fixture>['pages']) => { p[0].fragments[0].char++; },
    (p: ReturnType<typeof fixture>['pages']) => { p[1].fragments[0].char--; },
    (p: ReturnType<typeof fixture>['pages']) => { p[0].fragments[0].message = 10; },
    (p: ReturnType<typeof fixture>['pages']) => { p[60].fragments = []; },
  ]) {
    const { book, pages } = fixture(61);
    const snapshot = structuredClone(book);
    alter(pages);
    assert.throws(() => splitBookByPages(book, pages), RangeError);
    assert.deepEqual(book, snapshot);
  }
});

test('grouping preserves shelf order and sorts volumes numerically without mutation', () => {
  const { book } = fixture(1);
  const volume = (n: number): Book => ({ ...book, id: `v${n}`, seriesId: 'series', seriesTitle: 'Series', volumeNumber: n });
  const books = [volume(10), book, volume(2), volume(1)];
  const snapshot = structuredClone(books);
  assert.deepEqual(groupBooks(books).map(g => [g.id, g.title, g.books.map(b => b.id)]), [
    ['series', 'Series', ['v1', 'v2', 'v10']], ['book', 'Story', ['book']],
  ]);
  assert.deepEqual(books, snapshot);
  assert.deepEqual(groupBooks([]), []);
});

test('own-format and backup restore preserve exact Message fields and series metadata', async () => {
  const { book, pages } = fixture(61, { lastPage: 60 });
  book.messages.push({ role: 'CHAR', name: '', content: '' });
  pages[60].fragments.push({ message: 1, char: 0, end: 0, text: '', name: 'fallback' });
  const volumes = splitBookByPages(book, pages);
  for (const json of [JSON.stringify(volumes), await exportBackup(volumes).text()]) {
    const restored = await importChatFile(new File([json], 'books.json'));
    assert.deepEqual(restored, volumes);
  }
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
    const { book, pages } = fixture(61, { id: 'original', seriesId: 'series' });
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
