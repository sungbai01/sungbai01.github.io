/**
 * Standalone, browser-only persistence and import; no dependencies or UI effects.
 * Format reference: https://github.com/kwaroran/Risuai/blob/main/src/ts/characters.ts
 * Risu exports {type:'risuChat'|'risuAllChats',ver:1|2,data:Chat|Chat[]}.
 * Chat.message contains {role:'user'|'char',data:string,saying?:characterId}.
 * TXT export uses --Speaker on its own line, followed by the message body.
 * Only TXT and JSON files are accepted; HTML imports/parsing are unsupported.
 * All text stays inert. Consumers MUST render it as text (or Markdown with raw
 * HTML disabled), never innerHTML. No Risu scripts/macros/assets are executed.
 */
import {normalizeImageRules,type ImageRule} from './imageRules';
import { legacyDisplayRules, normalizeDisplayRules, type DisplayRule } from './displayRules';
import { jade, bronze, iris, gold } from '@radix-ui/colors';
import { normalizeAssets, safeAssetSource } from './assets';

export type BookAsset = { id: string; name: string; src: string; type?: 'icon' | 'asset' };
export type BookBookmark = { message: number; char: number; label?: string; progress?: number };

export interface Message {
  role: string;
  name: string;
  content: string;
  originalContent?: string;
  originalMap?: { source: number; output: number }[];
  chapter?: string;
  chapterTitle?: string;
  chapterStart?: boolean;
  pageBreakBefore?:boolean;
  pageBreakAfter?:boolean;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  /** Manually supplied model label; never inferred from chat content. */
  aiModel?: string;
  description: string;
  color: string;
  /** Optional image-derived shade; color remains the resolved display color. */
  customColor?: string;
  /** ISO 8601 date strings. */
  createdAt: string;
  uploadedAt?:string;
  updatedAt: string;
  messages: Message[];
  cover?: string;
  backCover?: string;
  characterIcon?: string;
  bookmarkStyle?: 'normal' | 'character' | 'image';
  bookmarkAssetId?: string;
  assets?: BookAsset[];
  imageRules?: ImageRule[];
  displayRules?: DisplayRule[];
  bookmarks?: BookBookmark[];
  seriesId?: string;
  seriesTitle?: string;
  volumeNumber?: number;
  volumeCount?: number;
  volumePolicy?: 'chapters-100-v1' | 'chapters-200-v1';
  pageCount?: number;
  pageLayoutVersion?: number;
}

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

export const BOOK_COLORS = [jade.jade12, bronze.bronze11, iris.iris12, gold.gold11];
const DB_NAME = 'risu-bookshelf';
const STORE = 'books';
const MARKS='book-marks';
type StoredMark={id:string;bookmarks?:BookBookmark[];bookmarkStyle?:Book['bookmarkStyle'];updatedAt?:string;messageLengths:number[]};
const markRecord=(book:Book):StoredMark=>({id:book.id,bookmarks:book.bookmarks??[],bookmarkStyle:book.bookmarkStyle,updatedAt:book.updatedAt,messageLengths:book.messages.map(message=>message.content.length)});
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
  // Covers may use the same explicitly imported image references as assets.
  return safeAssetSource(value);
}

/** A concrete opaque CSS color, never CSS expressions or external references. */
function safeCustomColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim()) ? value.trim() : undefined;
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
  if (typeof value === 'string') return { role: 'narrator', name: '서술', content: value, originalContent: value };
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
    originalContent: typeof value.originalContent === 'string' ? value.originalContent : content,
    ...(Array.isArray(value.originalMap) ? { originalMap: value.originalMap as Message['originalMap'] } : {}),
    ...(typeof value.chapter === 'string' ? { chapter: value.chapter } : {}),
    ...(typeof value.chapterTitle === 'string' ? { chapterTitle: value.chapterTitle } : {}),
    ...(typeof value.chapterStart === 'boolean' ? { chapterStart: value.chapterStart } : {}),
    ...(typeof value.pageBreakBefore==='boolean'?{pageBreakBefore:value.pageBreakBefore}:{}),
    ...(typeof value.pageBreakAfter==='boolean'?{pageBreakAfter:value.pageBreakAfter}:{}),
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
  removeUserInputs: boolean;
}

function makeBook(value: RecordValue, rows: unknown[], context: ImportContext, index: number): Book {
  const assets = normalizeAssets(value.assets);
  const imageRules=normalizeImageRules(value.imageRules);
  const character = string(value.character_name, value.character, context.character, '캐릭터');
  const user = string(value.user_name, context.user, '나');
  const normalized = rows.map((row, i) => {
    // Our own books already contain canonical messages. Backup restore must not
    // normalize roles, trim speaker names, or change source line endings.
    if (context.preserveIds && record(row) && typeof row.role === 'string' &&
        typeof row.name === 'string' && typeof row.content === 'string') {
      return { role: row.role, name: row.name, content: row.content,
        ...(typeof row.originalContent === 'string' ? { originalContent: row.originalContent } : {}),
        ...(Array.isArray(row.originalMap) ? { originalMap: row.originalMap as Message['originalMap'] } : {}),
        ...(typeof row.chapter === 'string' ? { chapter: row.chapter } : {}),
        ...(typeof row.chapterTitle === 'string' ? { chapterTitle: row.chapterTitle } : {}),
        ...(typeof row.chapterStart === 'boolean' ? { chapterStart: row.chapterStart } : {}),
        ...(typeof row.pageBreakBefore==='boolean'?{pageBreakBefore:row.pageBreakBefore}:{}),
        ...(typeof row.pageBreakAfter==='boolean'?{pageBreakAfter:row.pageBreakAfter}:{}) };
    }
    return normalizeMessage(row, i, character, user, context.names);
  });
  const retained = normalized.map((message, index) => ({ message, index })).filter(({ message }) =>
    !context.removeUserInputs || ['assistant', 'char', 'character', 'bot', 'ai', 'model'].includes(message.role.toLowerCase()));
  const messages = retained.map(({ message }) => message);
  if (!messages.some((message) => message.content.trim())) throw new LibraryError(context.removeUserInputs
    ? '사용자·시스템 메시지를 제외한 뒤 읽을 수 있는 캐릭터 대화가 없습니다.' : '대화 내용이 비어 있습니다.');
  const createdAt = timestamp(value.createdAt ?? value.created_at ?? value.creation_date, context.now);
  // A Chat.note is private prompt/context, not public book metadata. In
  // character-only mode derive the preview solely from retained messages;
  // title and author use their dedicated fields and never fall back to note.
  const book: Book = {
    id: context.preserveIds ? string(value.id) || newId() : newId(),
    title: string(value.title, value.name, context.title, '제목 없는 대화'),
    author: string(value.author, value.creator, context.author, character !== '캐릭터' ? character : '가져온 대화'),
    description: context.removeUserInputs ? messages.find(message => message.content.trim())!.content.replace(/\s+/g, ' ').slice(0, 160)
      : context.preserveIds && typeof value.description === 'string' ? value.description : string(value.description, value.note) || messages.find((message) => message.content.trim())!.content.replace(/\s+/g, ' ').slice(0, 160),
    color: typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color : BOOK_COLORS[index % BOOK_COLORS.length]!,
    createdAt,
    updatedAt: timestamp(value.updatedAt ?? value.updated_at, createdAt),
    messages,
  };
  const cover = safeCover(value.cover);
  if (cover) book.cover = cover;
  const customColor = safeCustomColor(value.customColor);
  if (customColor) book.customColor = customColor;
  if (typeof value.aiModel === 'string') book.aiModel = value.aiModel;
  const backCover = safeAssetSource(value.backCover);
  if (backCover) book.backCover = backCover;
  if(typeof value.uploadedAt==='string'&&Number.isFinite(Date.parse(value.uploadedAt)))book.uploadedAt=value.uploadedAt;
  const characterIcon = safeAssetSource(value.characterIcon);
  if (characterIcon) book.characterIcon = characterIcon;
  if (value.bookmarkStyle === 'normal' || value.bookmarkStyle === 'character' || value.bookmarkStyle === 'image') book.bookmarkStyle = value.bookmarkStyle;
  if (typeof value.bookmarkAssetId === 'string') book.bookmarkAssetId = value.bookmarkAssetId;
  if (Array.isArray(value.assets)) book.assets = assets;
  if (Array.isArray(value.imageRules)) book.imageRules=imageRules;
  if (Array.isArray(value.displayRules)) book.displayRules = !value.displayRules.length && imageRules.length && !messages.some(message => message.originalContent !== undefined)
    ? legacyDisplayRules(imageRules) : normalizeDisplayRules(value.displayRules);
  else if (imageRules.length) book.displayRules=legacyDisplayRules(imageRules);
  if (Array.isArray(value.bookmarks)) {
    const indices = new Map(retained.map(({ index }, destination) => [index, destination]));
    book.bookmarks = value.bookmarks.flatMap(entry => {
      if (!record(entry) || !Number.isSafeInteger(entry.message) || !Number.isSafeInteger(entry.char) ||
          typeof entry.message !== 'number' || typeof entry.char !== 'number' || entry.char < 0) return [];
      const message = indices.get(entry.message);
      if (message === undefined || entry.char > (normalized[entry.message]?.content.length ?? -1)) return [];
      return [{ message, char: entry.char, ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
        ...(!context.removeUserInputs && typeof entry.progress === 'number' && Number.isFinite(entry.progress) && entry.progress >= 0 && entry.progress <= 1
          ? { progress: entry.progress } : {}) }];
    });
  }
  if (context.preserveIds) {
    if (typeof value.seriesId === 'string') book.seriesId = value.seriesId;
    if (typeof value.seriesTitle === 'string') book.seriesTitle = value.seriesTitle;
    if (typeof value.volumeNumber === 'number' && Number.isSafeInteger(value.volumeNumber) && value.volumeNumber > 0) book.volumeNumber = value.volumeNumber;
    if (typeof value.volumeCount === 'number' && Number.isSafeInteger(value.volumeCount) && value.volumeCount > 0) book.volumeCount = value.volumeCount;
    if (value.volumePolicy === 'chapters-100-v1' || value.volumePolicy === 'chapters-200-v1') book.volumePolicy = value.volumePolicy;
    if (typeof value.pageCount === 'number' && Number.isSafeInteger(value.pageCount) && value.pageCount >= 1) book.pageCount = value.pageCount;
    if (typeof value.pageLayoutVersion === 'number' && Number.isSafeInteger(value.pageLayoutVersion) && value.pageLayoutVersion >= 1) book.pageLayoutVersion = value.pageLayoutVersion;
  }
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

function parseText(text: string, context: ImportContext): Book[] {
  const rows: Message[] = [];
  let current: Message | undefined;
  const title = context.title;
  const risuText = /^--[^\n]+$/m.test(text);
  // TXT contains names, not roles, and groups need not alternate. The official
  // filename provides a conservative character allowlist for a single character.
  // Sanitization removes punctuation; require an exact marker match to avoid
  // silently mistaking a custom persona or another group member for the user.
  const filenameCharacter = context.title.match(/^(.+)_\d{4}-\d{2}-\d{2}T\d{6}(?:\d{3})?Z_chat$/)?.[1];
  if (risuText && context.removeUserInputs && (!filenameCharacter ||
      !text.split('\n').some(line => line === `--${filenameCharacter}`))) {
    throw new LibraryError('TXT에는 사용자 역할 정보가 없습니다. 원래 캐릭터명_날짜_chat 파일명을 유지하거나 역할 정보가 있는 JSON 파일로 가져와 주세요.');
  }
  const flush = () => { if (current) { current.content = current.content.trim(); rows.push(current); current = undefined; } };
  for (const line of text.split('\n')) {
    const marker = risuText ? line.match(/^--(.+?)\s*$/) : line.match(/^([^:：\n]{1,80})[:：]\s*(.*)$/);
    if (marker) {
      flush();
      const name = marker[1]!.replace(/[:：]\s*$/, '').trim();
      const role = risuText ? name === filenameCharacter ? 'assistant' : 'unknown'
        : /^(user|human|나|사용자)$/i.test(name) ? 'user' : /^system$/i.test(name) ? 'system' : 'assistant';
      current = { role, name, content: marker[2] ? `${marker[2]}\n` : '' };
      continue;
    }
    if (!current && !line.trim()) continue;
    if (!current) current = { role: 'narrator', name: '서술', content: '' };
    current.content += `${line}\n`;
  }
  flush();
  return [makeBook({ title }, rows, context, 0)];
}

/** Parse only: does not persist, fetch remote assets, or execute embedded HTML. */
export async function importChatFile(file: File, options: { removeUserInputs?: boolean } = {}): Promise<Book[]> {
  if (!file || typeof file.text !== 'function') throw new LibraryError('가져올 파일을 선택해 주세요.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!['json', 'txt'].includes(extension)) {
    throw new LibraryError('TXT 또는 JSON 파일을 선택해 주세요.');
  }
  let text: string;
  try { text = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim(); }
  catch { throw new LibraryError('파일을 읽지 못했습니다. 파일 접근 권한을 확인해 주세요.'); }
  if (!text) throw new LibraryError('파일이 비어 있습니다.');
  if (text.includes('\u0000')) throw new LibraryError('UTF-8 텍스트 파일을 선택해 주세요.');
  const context: ImportContext = {
    title: file.name.replace(/\.[^.]+$/, '') || '가져온 대화',
    character: '', user: '나', author: '', names: new Map(), now: new Date().toISOString(), preserveIds: false,
    removeUserInputs: options.removeUserInputs === true,
  };
  if (/^\s*(?:<!doctype html|<html|<table)\b/i.test(text)) throw new LibraryError('HTML 및 HTML embedded는 지원하지 않습니다. TXT 또는 JSON으로 내보내 주세요.');
  if (extension === 'json') {
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { throw new LibraryError('JSON을 읽을 수 없습니다. 파일이 손상되었거나 올바른 내보내기 형식이 아닙니다.'); }
    return parseJson(value, context);
  }
  return parseText(text, context);
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
    try { request = indexedDB.open(DB_NAME, 4); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction!;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      const migrateMarks=!db.objectStoreNames.contains(MARKS);
      if(migrateMarks)db.createObjectStore(MARKS,{keyPath:'id'});
      // This schema deletion and every cursor update share the atomic upgrade
      // transaction. An abort leaves the v2 schema and all book records intact.
      if (db.objectStoreNames.contains('reading-progress')) db.deleteObjectStore('reading-progress');
      const cursorRequest = transaction.objectStore(STORE).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const value: unknown = cursor.value;
        if(migrateMarks&&record(value)&&typeof value.id==='string'&&Array.isArray(value.messages))transaction.objectStore(MARKS).put(markRecord(value as unknown as Book));
        // Do not normalize/revalidate historical content during migration.
        // Remove only the obsolete property, preserving IDs and every other
        // field, including timestamps, message offsets and manual bookmarks.
        if (record(value) && Object.prototype.hasOwnProperty.call(value, 'lastPage')) {
          const { lastPage: _lastPage, ...book } = value;
          cursor.update(book);
        }
        cursor.continue();
      };
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
async function withBooks<T>(mode: IDBTransactionMode, action: (transaction: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction([STORE,MARKS], mode);
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(storageError(failure ?? transaction.error));
      transaction.onerror = () => { failure ??= transaction.error; };
      try {
        const request = action(transaction);
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
  if (record(book) && typeof book.color !== 'string') {
    throw new LibraryError('책의 표지 색상 값이 없어 저장하지 못했어요.');
  }
  if (!record(book) || typeof book.id !== 'string' || !book.id.trim() ||
    !['title', 'author', 'description', 'color'].every((key) => typeof (book as unknown as RecordValue)[key] === 'string') ||
    typeof book.createdAt !== 'string' || !Number.isFinite(Date.parse(book.createdAt)) ||
    typeof book.updatedAt !== 'string' || !Number.isFinite(Date.parse(book.updatedAt)) || !Array.isArray(book.messages) ||
    !book.messages.every((message) => record(message) && ['role', 'name', 'content'].every((key) => typeof (message as unknown as RecordValue)[key] === 'string') &&
      (message.chapter === undefined || typeof message.chapter === 'string') &&
      (message.chapterTitle === undefined || typeof message.chapterTitle === 'string') &&
      (message.chapterStart === undefined || typeof message.chapterStart === 'boolean') &&
      (message.pageBreakBefore===undefined||typeof message.pageBreakBefore==='boolean') &&
      (message.pageBreakAfter===undefined||typeof message.pageBreakAfter==='boolean') &&
      (message.originalContent === undefined || typeof message.originalContent === 'string') &&
      (message.originalMap === undefined || (Array.isArray(message.originalMap) && message.originalMap.every((point, index, points) =>
        record(point) && Number.isSafeInteger(point.source) && point.source >= 0 && point.source <= (message.originalContent ?? message.content).length &&
        Number.isSafeInteger(point.output) && point.output >= 0 && point.output <= message.content.length &&
        (!index || (point.source >= points[index - 1].source && point.output >= points[index - 1].output)))))) ||
    (book.seriesId !== undefined && typeof book.seriesId !== 'string') ||
    (book.seriesTitle !== undefined && typeof book.seriesTitle !== 'string') ||
    (book.volumeNumber !== undefined && (!Number.isSafeInteger(book.volumeNumber) || book.volumeNumber < 1)) ||
    (book.volumeCount !== undefined && (!Number.isSafeInteger(book.volumeCount) || book.volumeCount < 1)) ||
    (book.pageCount !== undefined && (!Number.isSafeInteger(book.pageCount) || book.pageCount < 1)) ||
    (book.pageLayoutVersion !== undefined && (!Number.isSafeInteger(book.pageLayoutVersion) || book.pageLayoutVersion < 1)) ||
    (book.backCover !== undefined && typeof book.backCover !== 'string') ||
    (book.characterIcon !== undefined && typeof book.characterIcon !== 'string') ||
    (book.bookmarkStyle !== undefined && book.bookmarkStyle !== 'normal' && book.bookmarkStyle !== 'character' && book.bookmarkStyle !== 'image') ||
    (book.bookmarkAssetId !== undefined && typeof book.bookmarkAssetId !== 'string') ||
    (book.aiModel !== undefined && typeof book.aiModel !== 'string') ||
    (book.uploadedAt!==undefined&&(typeof book.uploadedAt!=='string'||!Number.isFinite(Date.parse(book.uploadedAt)))) ||
    (book.assets !== undefined && (!Array.isArray(book.assets) || !book.assets.every(asset => record(asset) &&
      typeof asset.id === 'string' && !!asset.id.trim() && typeof asset.name === 'string' && !!asset.name.trim() && typeof asset.src === 'string' &&
      (asset.type === undefined || asset.type === 'icon' || asset.type === 'asset')))) ||
    (book.imageRules !== undefined && (!Array.isArray(book.imageRules)||normalizeImageRules(book.imageRules).length!==book.imageRules.length)) ||
    (book.displayRules !== undefined && !Array.isArray(book.displayRules)) ||
    (book.bookmarks !== undefined && (!Array.isArray(book.bookmarks) || !book.bookmarks.every(mark => record(mark) &&
      Number.isSafeInteger(mark.message) && mark.message >= 0 && mark.message < book.messages.length &&
      Number.isSafeInteger(mark.char) && mark.char >= 0 && mark.char <= book.messages[mark.message]!.content.length &&
      (mark.label === undefined || typeof mark.label === 'string') &&
      (mark.progress === undefined || (typeof mark.progress === 'number' && Number.isFinite(mark.progress) && mark.progress >= 0 && mark.progress <= 1)))))) {
    throw new LibraryError('저장할 책의 데이터 형식이 올바르지 않습니다.');
  }
}

/** The same safety rules apply to imports, persisted records and backup blobs. */
function sanitizedBook(book: Book): Book {
  // Runtime records/old backups can still have extra legacy fields even though
  // the Book contract no longer exposes them. Never write/export lastPage.
  const { lastPage: _lastPage, customColor: _customColor, cover: _cover, backCover: _backCover, characterIcon: _characterIcon, assets: _assets, bookmarks: _bookmarks, imageRules:_imageRules, ...rest } = book as Book & { lastPage?: unknown };
  const cover = safeCover(book.cover);
  const backCover = safeAssetSource(book.backCover);
  const characterIcon = safeAssetSource(book.characterIcon);
  const customColor = safeCustomColor(book.customColor);
  return { ...rest, messages: book.messages.map(message => ({ ...message })),
    ...(cover ? { cover } : {}), ...(backCover ? { backCover } : {}),
    ...(characterIcon ? { characterIcon } : {}),
    ...(customColor ? { customColor } : {}),
    ...(book.imageRules === undefined ? {} : {imageRules:normalizeImageRules(book.imageRules)}),
    ...(book.displayRules === undefined || (!book.displayRules.length && !book.messages.some(message => message.originalContent !== undefined))
      ? (book.imageRules?.length ? { displayRules: legacyDisplayRules(book.imageRules) } : book.displayRules === undefined ? {} : { displayRules: [] })
      : { displayRules: normalizeDisplayRules(book.displayRules) }),
    ...(book.assets === undefined ? {} : { assets: normalizeAssets(book.assets) }),
    ...(book.bookmarks === undefined ? {} : { bookmarks: book.bookmarks.map(mark => ({ ...mark })) }) };
}

export async function loadBooks(): Promise<Book[]> {
  const db=await openDatabase();
  let records:Book[]=[];
  try{records=await new Promise<Book[]>((resolve,reject)=>{
    const transaction=db.transaction([STORE,MARKS],'readonly');let books:Book[]=[],marks:StoredMark[]=[];
    transaction.objectStore(STORE).getAll().onsuccess=event=>{books=(event.target as IDBRequest<Book[]>).result;};
    transaction.objectStore(MARKS).getAll().onsuccess=event=>{marks=(event.target as IDBRequest<StoredMark[]>).result;};
    transaction.oncomplete=()=>{const byId=new Map(marks.map(mark=>[mark.id,mark]));resolve(books.map(book=>{const mark=byId.get(book.id);return mark?{...book,bookmarks:mark.bookmarks??[],bookmarkStyle:mark.bookmarkStyle,updatedAt:mark.updatedAt??book.updatedAt}:book;}));};
    transaction.onabort=()=>reject(storageError(transaction.error));transaction.onerror=()=>{};
  });}finally{db.close();}
  records.forEach(validateBook);
  const books = records.map(sanitizedBook);
  return books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/** Upsert by id. Timestamps are caller-owned, allowing lossless backup restore. */
export async function saveBook(book: Book): Promise<void> {
  validateBook(book);
  const stored = sanitizedBook(book);
  await withBooks('readwrite', (transaction) => {
    transaction.objectStore(MARKS).put(markRecord(stored));
    const request = transaction.objectStore(STORE).put(stored);
    return request;
  });
}

export type BookmarkUpdate = Pick<Book, 'id' | 'bookmarks' | 'bookmarkStyle'> & { updatedAt?: string };

/** Atomic patches against the latest stored records. Only supplied IDs are
 * read/written; assets, original maps and all other live fields are untouched.
 * Omitted fields stay unchanged. Explicit undefined deletes that field;
 * bookmarks: [] clears markers. Omit updatedAt to preserve the book's date.
 * For one shelf bookmark, clear the old book and set the new book in one call.
 * Any missing ID, invalid anchor or write failure aborts the complete batch.
 */
export async function updateBookmarks(updates: BookmarkUpdate[]): Promise<void> {
  if (!Array.isArray(updates)) throw new LibraryError('책갈피 변경 목록이 올바르지 않습니다.');
  const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
  const seen = new Set<string>();
  const patches = updates.map(update => {
    if (!record(update) || typeof update.id !== 'string' || !update.id.trim() || seen.has(update.id)) throw new LibraryError('책갈피 변경에 유효하고 중복되지 않은 책 ID가 필요합니다.');
    seen.add(update.id);
    if (has(update, 'bookmarkStyle') && update.bookmarkStyle !== undefined && update.bookmarkStyle !== 'normal' && update.bookmarkStyle !== 'character' && update.bookmarkStyle !== 'image') throw new LibraryError('책갈피 모양이 올바르지 않습니다.');
    if (has(update, 'updatedAt') && update.updatedAt !== undefined && (typeof update.updatedAt !== 'string' || !Number.isFinite(Date.parse(update.updatedAt)))) throw new LibraryError('책갈피 변경 시각이 올바르지 않습니다.');
    if (update.bookmarks !== undefined && (!Array.isArray(update.bookmarks) || !update.bookmarks.every(mark => record(mark) &&
      Number.isSafeInteger(mark.message) && mark.message >= 0 && Number.isSafeInteger(mark.char) && mark.char >= 0 &&
      (mark.label === undefined || typeof mark.label === 'string') &&
      (mark.progress === undefined || (typeof mark.progress === 'number' && Number.isFinite(mark.progress) && mark.progress >= 0 && mark.progress <= 1))))) throw new LibraryError('책갈피 위치 또는 진행률이 올바르지 않습니다.');
    return { id: update.id,
      ...(has(update, 'bookmarks') ? { bookmarks: update.bookmarks?.map(mark => ({ message: mark.message, char: mark.char,
        ...(mark.label === undefined ? {} : { label: mark.label }), ...(mark.progress === undefined ? {} : { progress: mark.progress }) })) } : {}),
      ...(has(update, 'bookmarkStyle') ? { bookmarkStyle: update.bookmarkStyle } : {}),
      ...(update.updatedAt === undefined ? {} : { updatedAt: update.updatedAt }) };
  });
  if (!patches.length) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(MARKS, 'readwrite');
      const books = transaction.objectStore(MARKS);
      let failure: unknown;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => { failure ??= transaction.error; };
      transaction.onabort = () => reject(failure instanceof LibraryError ? failure : storageError(failure ?? transaction.error));
      const abort = (cause: unknown) => { failure = cause; transaction.abort(); };
      for (const patch of patches) {
        const request = books.get(patch.id);
        request.onerror = () => { failure = request.error; };
        request.onsuccess = () => {
          try {
            const current: unknown = request.result;
            if (!record(current) || current.id !== patch.id) throw new LibraryError(`책갈피를 저장할 책을 찾지 못했습니다: ${patch.id}`);
            for (const mark of patch.bookmarks ?? []) {
              const length=Array.isArray(current.messageLengths)?current.messageLengths[mark.message]:undefined;
              if (typeof length!=='number'||mark.char>length) throw new LibraryError('책의 현재 본문과 책갈피 위치가 맞지 않습니다.');
            }
            const next = { ...current };
            for (const key of ['bookmarks', 'bookmarkStyle'] as const) if (has(patch, key)) {
              if (patch[key] === undefined) delete next[key]; else next[key] = patch[key];
            }
            if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
            const write = books.put(next);
            write.onerror = () => { failure = write.error; };
          } catch (cause) { abort(cause); }
        };
      }
    });
  } catch (cause) { throw cause instanceof LibraryError ? cause : storageError(cause); }
  finally { db.close(); }
}

/** Atomically upsert the complete renumbered series, retaining the original ID.
 * No records are deleted; an abort leaves the books store unchanged.
 */
export async function replaceBookWithVolumes(originalId: string, volumes: Book[]): Promise<void> {
  return repackSeries(originalId, volumes, []);
}

/** Atomically replace a series and remove obsolete books.
 * Retained IDs win if also listed as obsolete. Failure rolls back all writes.
 */
export async function repackSeries(originalId: string, volumes: Book[], obsoleteIds: string[]): Promise<void> {
  if (!Array.isArray(obsoleteIds) || obsoleteIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new LibraryError('삭제할 이전 분권 ID가 올바르지 않습니다.');
  }
  if (typeof originalId !== 'string' || !originalId.trim() || !Array.isArray(volumes) || !volumes.length) {
    throw new LibraryError('교체할 원본 책과 분권 목록이 필요합니다.');
  }
  const ids = new Set<string>();
  const stored = volumes.map((book) => {
    validateBook(book);
    if (ids.has(book.id)) throw new LibraryError('분권 목록에 중복된 책 ID가 있습니다.');
    ids.add(book.id);
    return sanitizedBook(book);
  });
  if (!ids.has(originalId)) throw new LibraryError('분권 목록에 원본 책 ID가 필요합니다.');

  await withBooks('readwrite', (transaction) => {
    const books = transaction.objectStore(STORE);
    let request!: IDBRequest<IDBValidKey>;
    for (const book of stored) {
      transaction.objectStore(MARKS).put(markRecord(book));
      request = books.put(book);
    }
    for (const id of new Set(obsoleteIds)) {
      if (!ids.has(id)){books.delete(id);transaction.objectStore(MARKS).delete(id);}
    }
    return request;
  });
}

/** Idempotent: deleting a missing id succeeds. */
export async function deleteBooks(ids: string[]): Promise<void> {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim())) {
    throw new LibraryError('삭제할 책의 ID 목록이 올바르지 않습니다.');
  }
  if (!ids.length) return;
  await withBooks('readwrite', transaction => {
    let request!: IDBRequest<undefined>;
    for (const id of new Set(ids)) {
      transaction.objectStore(MARKS).delete(id);
      request = transaction.objectStore(STORE).delete(id);
    }
    return request;
  });
}

/** Idempotent: deleting a missing id succeeds. */
export async function deleteAllBooks(): Promise<void> {
  await withBooks('readwrite', transaction => {
    transaction.objectStore(MARKS).clear();
    const request=transaction.objectStore(STORE).clear();
    return request;
  });
}

/** Idempotent: deleting a missing id succeeds. */
export async function deleteBook(id: string): Promise<void> {
  if (typeof id !== 'string' || !id.trim()) throw new LibraryError('삭제할 책의 ID가 필요합니다.');
  await withBooks('readwrite', (transaction) => {
    transaction.objectStore(MARKS).delete(id);
    const request = transaction.objectStore(STORE).delete(id);
    return request;
  });
}

/** Feed the resulting .json File back into importChatFile to restore books. */
export function exportBackup(books: Book[]): Blob {
  books.forEach(validateBook);
  return new Blob([JSON.stringify({ format: 'galpi-backup', version: 1, exportedAt: new Date().toISOString(), books: books.map(sanitizedBook) }, null, 2)], { type: 'application/json;charset=utf-8' });
}

export function exportBookMarkdown(book: Book): Blob {
  validateBook(book);
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const content = `# ${escape(book.title).replace(/\n/g, ' ')}\n\n` + book.messages.map((message) =>
    `## ${escape(message.name).replace(/\n/g, ' ')}\n\n${escape(message.content)}`,
  ).join('\n\n');
  return new Blob([content], { type: 'text/markdown;charset=utf-8' });
}
