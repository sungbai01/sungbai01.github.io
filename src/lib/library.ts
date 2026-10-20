/**
 * Standalone, browser-only persistence and import; no dependencies or UI effects.
 * Format reference: https://github.com/kwaroran/Risuai/blob/main/src/ts/characters.ts
 * Risu exports {type:'risuChat'|'risuAllChats',ver:1|2,data:Chat|Chat[]}.
 * Chat.message contains {role:'user'|'char',data:string,saying?:characterId}.
 * TXT export uses --Speaker on its own line, followed by the message body.
 * All text stays inert. Consumers MUST render it as text (or Markdown with raw
 * HTML disabled), never innerHTML. No Risu scripts/macros/assets are executed.
 */
export interface Message {
  role: string;
  name: string;
  content: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  description: string;
  color: string;
  /** ISO 8601 date strings. */
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  cover?: string;
  /** Zero-based reader page; the reader determines the page count. */
  lastPage?: number;
}

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

export const BOOK_COLORS = ['#697963', '#a76b54', '#64778c', '#9b8053', '#806987'];
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DB_NAME = 'risu-bookshelf';
const STORE = 'books';
type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function newId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function timestamp(value: unknown, fallback: string): string {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 8.64e15 ? new Date(parsed).toISOString() : fallback;
}

function safeCover(value: unknown): string | undefined {
  // No SVG, HTML, script URLs, remote tracking requests, or persistent blob URLs.
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)
    ? value : undefined;
}

function textContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map((part) => {
      if (typeof part === 'string') return part;
      if (record(part) && (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text')) {
        return typeof part.text === 'string' ? part.text : undefined;
      }
      return undefined;
    });
    if (parts.some((part) => part !== undefined)) return parts.filter((part) => part !== undefined).join('\n');
  }
  return undefined;
}

function normalizeMessage(value: unknown, index: number, character: string, user: string, names: Map<string, string>): Message {
  if (typeof value === 'string') return { role: 'narrator', name: '서술', content: value };
  if (!record(value)) throw new LibraryError(`${index + 1}번째 메시지 형식이 올바르지 않습니다.`);
  const content = textContent(value.content) ?? textContent(value.data) ?? textContent(value.mes) ?? textContent(value.text);
  if (content === undefined) throw new LibraryError(`${index + 1}번째 메시지에 읽을 수 있는 텍스트가 없습니다.`);
  const originalRole = string(value.role).toLowerCase();
  const role = value.is_system === true ? 'system' : typeof value.is_user === 'boolean'
    ? value.is_user ? 'user' : 'assistant'
    : ['char', 'character', 'bot', 'ai', 'assistant', 'model'].includes(originalRole) ? 'assistant'
    : ['user', 'human'].includes(originalRole) ? 'user' : originalRole || 'narrator';
  const speaker = typeof value.saying === 'string' ? names.get(value.saying) : undefined;
  return {
    role,
    name: string(value.name, value.speaker, speaker, role === 'user' ? user : role === 'assistant' ? character : role === 'system' ? '시스템' : '서술'),
    content: content.replace(/\r\n?/g, '\n'),
  };
}

interface ImportContext {
  title: string;
  character: string;
  user: string;
  author: string;
  names: Map<string, string>;
  now: string;
  preserveIds: boolean;
}

function makeBook(value: RecordValue, rows: unknown[], context: ImportContext, index: number): Book {
  const character = string(value.character_name, value.character, context.character, '캐릭터');
  const user = string(value.user_name, context.user, '나');
  const messages = rows.map((row, i) => normalizeMessage(row, i, character, user, context.names));
  if (!messages.some((message) => message.content.trim())) throw new LibraryError('대화 내용이 비어 있습니다.');
  const createdAt = timestamp(value.createdAt ?? value.created_at ?? value.creation_date, context.now);
  const book: Book = {
    id: context.preserveIds ? string(value.id) || newId() : newId(),
    title: string(value.title, value.name, context.title, '제목 없는 대화'),
    author: string(value.author, value.creator, context.author, character !== '캐릭터' ? character : '가져온 대화'),
    description: context.preserveIds && typeof value.description === 'string' ? value.description : string(value.description, value.note) || messages.find((message) => message.content.trim())!.content.replace(/\s+/g, ' ').slice(0, 160),
    color: typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color : BOOK_COLORS[index % BOOK_COLORS.length]!,
    createdAt,
    updatedAt: timestamp(value.updatedAt ?? value.updated_at, createdAt),
    messages,
  };
  const cover = safeCover(value.cover);
  if (cover) book.cover = cover;
  if (typeof value.lastPage === 'number' && Number.isSafeInteger(value.lastPage) && value.lastPage >= 0) book.lastPage = value.lastPage;
  return book;
}

function parseJson(value: unknown, context: ImportContext): Book[] {
  const books: Book[] = [];
  const visit = (node: unknown, ctx: ImportContext, depth: number): void => {
    if (depth > 20) throw new LibraryError('JSON 구조가 너무 깊습니다.');
    if (Array.isArray(node)) {
      if (!node.length) throw new LibraryError('대화 목록이 비어 있습니다.');
      const isMessage = (entry: unknown) => typeof entry === 'string' || (record(entry) &&
        (typeof entry.role === 'string' || typeof entry.is_user === 'boolean') &&
        ['content', 'data', 'mes', 'text'].some((key) => key in entry));
      if (node.every(isMessage)) books.push(makeBook({}, node, ctx, books.length));
      else node.forEach((entry) => visit(entry, ctx, depth + 1));
      return;
    }
    if (!record(node)) throw new LibraryError('지원하지 않는 JSON 대화 구조입니다.');
    if (node.type === 'risuChat' || node.type === 'risuAllChats') {
      if (node.ver !== 1 && node.ver !== 2) throw new LibraryError('지원하지 않는 RisuAI 내보내기 버전입니다. (v1/v2 지원)');
      visit(node.data, ctx, depth + 1);
      return;
    }
    if (node.type === 'risu-bookshelf' || node.format === 'galpi-backup') {
      if (node.version !== 1) throw new LibraryError('지원하지 않는 책장 백업 버전입니다.');
      visit(node.books, { ...ctx, preserveIds: true }, depth + 1);
      return;
    }
    // Full JSON database/character exports can contain multiple characters/chats.
    if (Array.isArray(node.characters)) {
      const names = new Map(ctx.names);
      node.characters.forEach((entry) => {
        if (record(entry) && typeof entry.chaId === 'string' && typeof entry.name === 'string') names.set(entry.chaId, entry.name);
      });
      node.characters.forEach((entry) => visit(entry, { ...ctx, names }, depth + 1));
      return;
    }
    if (Array.isArray(node.chats)) {
      visit(node.chats, { ...ctx, character: string(node.name, ctx.character), author: string(node.creator, ctx.author) }, depth + 1);
      return;
    }
    const rows = Array.isArray(node.message) ? node.message : Array.isArray(node.messages) ? node.messages : undefined;
    if (rows) {
      const ownBook = typeof node.id === 'string' && !!node.id.trim() &&
        ['title', 'author', 'description', 'color', 'createdAt', 'updatedAt'].every((key) => typeof node[key] === 'string') && Array.isArray(node.messages);
      books.push(makeBook(node, rows, { ...ctx, preserveIds: ctx.preserveIds || ownBook }, books.length));
      return;
    }
    if (Array.isArray(node.books)) { visit(node.books, ctx, depth + 1); return; }
    if (record(node.chat) || Array.isArray(node.chat)) { visit(node.chat, ctx, depth + 1); return; }
    if (record(node.data) || Array.isArray(node.data)) { visit(node.data, ctx, depth + 1); return; }
    throw new LibraryError('메시지 목록을 찾을 수 없습니다. RisuAI 대화 JSON을 선택해 주세요.');
  };
  visit(value, context, 0);
  if (!books.length) throw new LibraryError('가져올 대화가 없습니다.');
  const seen = new Set<string>();
  for (const book of books) {
    if (seen.has(book.id)) book.id = newId();
    seen.add(book.id);
  }
  return books;
}

function parseJsonl(text: string, context: ImportContext): Book[] {
  const rows: unknown[] = [];
  let character = context.character;
  let user = context.user;
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { throw new LibraryError(`JSONL ${index + 1}행을 읽을 수 없습니다. 파일 내용을 확인해 주세요.`); }
    // Tavern/SillyTavern header is metadata, never a message. Keep first actual message.
    if (rows.length === 0 && record(value) && !('mes' in value || 'content' in value || 'data' in value || 'text' in value) &&
        ('user_name' in value || 'character_name' in value || 'chat_metadata' in value || 'create_date' in value)) {
      character = string(value.character_name, character);
      user = string(value.user_name, user);
      continue;
    }
    rows.push(value);
  }
  return [makeBook({}, rows, { ...context, character, user }, 0)];
}

function parseText(text: string, context: ImportContext, markdown: boolean): Book[] {
  const rows: Message[] = [];
  let current: Message | undefined;
  let fence = '';
  let title = context.title;
  const risuText = /^--[^\n]+$/m.test(text);
  const flush = () => { if (current) { current.content = current.content.trim(); rows.push(current); current = undefined; } };
  for (const line of text.split('\n')) {
    const codeFence = line.match(/^\s*(`{3,}|~{3,})/);
    if (codeFence && markdown) {
      if (!fence) fence = codeFence[1]![0]!;
      else if (codeFence[1]![0] === fence) fence = '';
      if (!current) current = { role: 'narrator', name: '서술', content: '' };
      current.content += `${line}\n`;
      continue;
    }
    if (!fence) {
      if (markdown && rows.length === 0 && !current && /^#\s+/.test(line)) {
        title = line.replace(/^#\s+/, '').trim() || title;
        continue;
      }
      const marker = risuText ? line.match(/^--(.+?)\s*$/) : markdown
        ? line.match(/^#{2,6}\s+(.+?)\s*$/) ?? line.match(/^\*\*([^*\n]{1,80}?)(?:[:：])?\*\*[:：]?\s*(.*)$/) ?? line.match(/^(user|assistant|system|human|char|나|사용자|캐릭터)[:：]\s*(.*)$/i)
        : line.match(/^([^:：\n]{1,80})[:：]\s*(.*)$/);
      if (marker) {
        flush();
        const name = marker[1]!.replace(/[:：]\s*$/, '').trim();
        const role = /^(user|human|나|사용자)$/i.test(name) ? 'user' : /^system$/i.test(name) ? 'system' : 'assistant';
        current = { role, name, content: marker[2] ? `${marker[2]}\n` : '' };
        continue;
      }
    }
    if (!current && !line.trim()) continue;
    if (!current) current = { role: 'narrator', name: '서술', content: '' };
    current.content += `${line}\n`;
  }
  flush();
  return [makeBook({ title }, rows, context, 0)];
}

/** Parse only: does not persist, fetch remote assets, or execute embedded HTML. */
export async function importChatFile(file: File): Promise<Book[]> {
  if (!file || typeof file.text !== 'function') throw new LibraryError('가져올 파일을 선택해 주세요.');
  if (file.size > MAX_FILE_BYTES) throw new LibraryError('50MB 이하의 대화 파일을 선택해 주세요.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!['json', 'jsonl', 'ndjson', 'txt', 'md', 'markdown', 'chat'].includes(extension)) {
    throw new LibraryError('JSON, JSONL, TXT 또는 Markdown 파일을 선택해 주세요. HTML·바이너리 백업은 지원하지 않습니다.');
  }
  let text: string;
  try { text = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim(); }
  catch { throw new LibraryError('파일을 읽지 못했습니다. 파일 접근 권한을 확인해 주세요.'); }
  if (!text) throw new LibraryError('파일이 비어 있습니다.');
  if (text.includes('\u0000')) throw new LibraryError('UTF-8 텍스트 파일을 선택해 주세요.');
  const context: ImportContext = {
    title: file.name.replace(/\.[^.]+$/, '') || '가져온 대화',
    character: '', user: '나', author: '', names: new Map(), now: new Date().toISOString(), preserveIds: false,
  };
  if (extension === 'jsonl' || extension === 'ndjson') return parseJsonl(text, context);
  if (extension === 'json' || extension === 'chat') {
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { throw new LibraryError('JSON을 읽을 수 없습니다. 파일이 손상되었거나 올바른 내보내기 형식이 아닙니다.'); }
    return parseJson(value, context);
  }
  return parseText(text, context, extension === 'md' || extension === 'markdown');
}

function storageError(error: unknown): LibraryError {
  const name = record(error) && typeof error.name === 'string' ? error.name : error instanceof Error ? error.name : '';
  return new LibraryError(name === 'QuotaExceededError'
    ? '저장 공간이 부족합니다. 책을 백업한 뒤 공간을 확보해 주세요.'
    : '브라우저 책장 저장소에 접근하지 못했습니다. 저장 권한과 비공개 모드 설정을 확인해 주세요.');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new LibraryError('이 환경에서는 IndexedDB 저장소를 사용할 수 없습니다.')); return; }
    let request: IDBOpenDBRequest;
    let settled = false;
    try { request = indexedDB.open(DB_NAME, 1); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onerror = () => { settled = true; reject(storageError(request.error)); };
    request.onblocked = () => {
      settled = true;
      reject(new LibraryError('다른 탭이 저장소 갱신을 막고 있습니다. 다른 책장 탭을 닫고 다시 시도해 주세요.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

/** Resolve writes only on transaction commit, including quota/abort failures. */
async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(storageError(failure ?? transaction.error));
      transaction.onerror = () => { failure ??= transaction.error; };
      try {
        const request = action(transaction.objectStore(STORE));
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => { failure = request.error; };
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    });
  } catch (error) {
    throw error instanceof LibraryError ? error : storageError(error);
  } finally { db.close(); }
}

function validateBook(book: Book): void {
  if (!record(book) || typeof book.id !== 'string' || !book.id.trim() ||
    !['title', 'author', 'description', 'color'].every((key) => typeof (book as unknown as RecordValue)[key] === 'string') ||
    typeof book.createdAt !== 'string' || !Number.isFinite(Date.parse(book.createdAt)) ||
    typeof book.updatedAt !== 'string' || !Number.isFinite(Date.parse(book.updatedAt)) || !Array.isArray(book.messages) ||
    !book.messages.every((message) => record(message) && ['role', 'name', 'content'].every((key) => typeof (message as unknown as RecordValue)[key] === 'string')) ||
    (book.lastPage !== undefined && (!Number.isSafeInteger(book.lastPage) || book.lastPage < 0))) {
    throw new LibraryError('저장할 책의 데이터 형식이 올바르지 않습니다.');
  }
}

export async function loadBooks(): Promise<Book[]> {
  const books = await withStore<Book[]>('readonly', (store) => store.getAll());
  books.forEach(validateBook);
  return books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/** Upsert by id. Timestamps are caller-owned, allowing lossless backup restore. */
export async function saveBook(book: Book): Promise<void> {
  validateBook(book);
  const { cover: _cover, ...rest } = book;
  const cover = safeCover(book.cover);
  const stored: Book = cover ? { ...rest, cover } : rest;
  await withStore('readwrite', (store) => store.put(stored));
}

/** Idempotent: deleting a missing id succeeds. */
export async function deleteBook(id: string): Promise<void> {
  if (typeof id !== 'string' || !id.trim()) throw new LibraryError('삭제할 책의 ID가 필요합니다.');
  await withStore('readwrite', (store) => store.delete(id));
}

/** Feed the resulting .json File back into importChatFile to restore books. */
export function exportBackup(books: Book[]): Blob {
  books.forEach(validateBook);
  return new Blob([JSON.stringify({ format: 'galpi-backup', version: 1, exportedAt: new Date().toISOString(), books }, null, 2)], { type: 'application/json;charset=utf-8' });
}

export function exportBookMarkdown(book: Book): Blob {
  validateBook(book);
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const content = `# ${escape(book.title).replace(/\n/g, ' ')}\n\n` + book.messages.map((message) =>
    `## ${escape(message.name).replace(/\n/g, ' ')}\n\n${escape(message.content)}`,
  ).join('\n\n');
  return new Blob([content], { type: 'text/markdown;charset=utf-8' });
}
