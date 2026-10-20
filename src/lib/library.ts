/**
 * Standalone, browser-only persistence and import; no dependencies or UI effects.
 * Format reference: https://github.com/kwaroran/Risuai/blob/main/src/ts/characters.ts
 * Risu exports {type:'risuChat'|'risuAllChats',ver:1|2,data:Chat|Chat[]}.
 * Chat.message contains {role:'user'|'char',data:string,saying?:characterId}.
 * TXT export uses --Speaker on its own line, followed by the message body.
 * HTML File uses .container > .chat and a hidden .idat containing escaped Chat
 * JSON. HTML Embed is a clipboard table (Character/Message), not an iframe.
 * Verified characters.ts blob b349d110630c6408c32c5cea76f8083fcce07b7c.
 * All text stays inert. Consumers MUST render it as text (or Markdown with raw
 * HTML disabled), never innerHTML. No Risu scripts/macros/assets are executed.
 */
import { jade, bronze, iris, gold } from '@radix-ui/colors';
import { normalizeAssets, safeAssetSource } from './assets';

export type BookAsset = { id: string; name: string; src: string; type?: 'icon' | 'asset' };
export type BookBookmark = { message: number; char: number; label?: string };

export interface Message {
  role: string;
  name: string;
  content: string;
  chapter?: string;
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
  backCover?: string;
  characterIcon?: string;
  bookmarkStyle?: 'normal' | 'character';
  assets?: BookAsset[];
  bookmarks?: BookBookmark[];
  /** Zero-based reader page; the reader determines the page count. */
  lastPage?: number;
  seriesId?: string;
  seriesTitle?: string;
  volumeNumber?: number;
  volumeCount?: number;
  volumePolicy?: 'chapters-100-v1';
}

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

export const BOOK_COLORS = [jade.jade12, bronze.bronze11, iris.iris12, gold.gold11];
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DB_NAME = 'risu-bookshelf';
const STORE = 'books';
const PROGRESS_STORE = 'reading-progress';
interface ReadingProgress {
  id: string;
  lastPage: number;
  updatedAt: string;
}
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

/** Detached native parsing only. Disable resource-bearing tags before parsing:
 * even detached HTML documents may load images/frames in some browsers.
 * Nothing from this document is ever adopted into the application's DOM.
 */
function inertDocument(html: string): Document {
  if (typeof DOMParser === 'undefined') throw new LibraryError('HTML 가져오기는 DOMParser를 지원하는 브라우저에서 사용해 주세요.');
  // Match whole tags including quoted '>' characters (notably srcdoc). Removing
  // tags instead of renaming void elements avoids swallowing following prose.
  // Turn images into named references before removing resource-bearing tags.
  // Attributes are read as strings; no imported element enters a live document.
  const images = html.replace(/<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi, tag => {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    const src = attrs.get('src') || '';
    const token = src.match(/\{\{(?:img|image|raw)::([^{}]+)\}\}/i);
    let filename = src.split(/[?#]/)[0]?.split(/[\\/]/).pop() || '';
    try { filename = decodeURIComponent(filename); } catch { /* Keep the original name. */ }
    const name = (token?.[1] || attrs.get('data-asset-name') || attrs.get('alt') || attrs.get('title') ||
      (!/^data:/i.test(src) ? filename : '')).trim();
    return name && !/[{}\r\n]/.test(name) ? `{{img::${name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}}` : '';
  });
  const disabled = images.replace(/<\/?(?:img|iframe|frame|frameset|link|base|object|embed|video|audio|source|track|image|use|input)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi, '');
  return new DOMParser().parseFromString('<meta http-equiv="Content-Security-Policy" content="default-src \'none\';">' + disabled, 'text/html');
}

function elementText(element: Element): string {
  element.querySelectorAll('script,style,noscript,template,svg,math,[hidden],.idat').forEach(node => node.remove());
  // Keep semantic emphasis as the simple Markdown understood by Reader.
  Array.from(element.querySelectorAll('em,i,strong,b')).reverse().forEach(node => {
    const marker = /^(strong|b)$/i.test(node.tagName) ? '**' : '*';
    node.prepend(marker); node.append(marker);
  });
  element.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  element.querySelectorAll('p,div,section,article,li,blockquote,pre,h1,h2,h3,h4,h5,h6,tr').forEach(node => node.append('\n'));
  return (element.textContent || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function plainText(content: string): string {
  return /<\/?[a-z][^>]*>/i.test(content) ? elementText(inertDocument(content).body) : content;
}

function normalizeMessage(value: unknown, index: number, character: string, user: string, names: Map<string, string>): Message {
  if (typeof value === 'string') return { role: 'narrator', name: '서술', content: plainText(value) };
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
    content: plainText(content).replace(/\r\n?/g, '\n'),
    ...(typeof value.chapter === 'string' ? { chapter: value.chapter } : {}),
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
  const character = string(value.character_name, value.character, context.character, '캐릭터');
  const user = string(value.user_name, context.user, '나');
  const normalized = rows.map((row, i) => {
    // Our own books already contain canonical messages. Backup restore must not
    // normalize roles, trim speaker names, or change source line endings.
    if (context.preserveIds && record(row) && typeof row.role === 'string' &&
        typeof row.name === 'string' && typeof row.content === 'string') {
      return { role: row.role, name: row.name, content: context.removeUserInputs ? plainText(row.content) : row.content,
        ...(typeof row.chapter === 'string' ? { chapter: row.chapter } : {}) };
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
      : context.preserveIds && typeof value.description === 'string' ? value.description : plainText(string(value.description, value.note)) || messages.find((message) => message.content.trim())!.content.replace(/\s+/g, ' ').slice(0, 160),
    color: typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? value.color : BOOK_COLORS[index % BOOK_COLORS.length]!,
    createdAt,
    updatedAt: timestamp(value.updatedAt ?? value.updated_at, createdAt),
    messages,
  };
  const cover = safeCover(value.cover);
  if (cover) book.cover = cover;
  const backCover = safeAssetSource(value.backCover);
  if (backCover) book.backCover = backCover;
  const characterIcon = safeAssetSource(value.characterIcon);
  if (characterIcon) book.characterIcon = characterIcon;
  if (value.bookmarkStyle === 'normal' || value.bookmarkStyle === 'character') book.bookmarkStyle = value.bookmarkStyle;
  if (Array.isArray(value.assets)) book.assets = normalizeAssets(value.assets);
  if (Array.isArray(value.bookmarks)) {
    const indices = new Map(retained.map(({ index }, destination) => [index, destination]));
    book.bookmarks = value.bookmarks.flatMap(entry => {
      if (!record(entry) || !Number.isSafeInteger(entry.message) || !Number.isSafeInteger(entry.char) ||
          typeof entry.message !== 'number' || typeof entry.char !== 'number' || entry.char < 0) return [];
      const message = indices.get(entry.message);
      if (message === undefined || entry.char > (normalized[entry.message]?.content.length ?? -1)) return [];
      return [{ message, char: entry.char, ...(typeof entry.label === 'string' ? { label: entry.label } : {}) }];
    });
  }
  if (typeof value.lastPage === 'number' && Number.isSafeInteger(value.lastPage) && value.lastPage >= 0) book.lastPage = value.lastPage;
  if (context.preserveIds) {
    if (typeof value.seriesId === 'string') book.seriesId = value.seriesId;
    if (typeof value.seriesTitle === 'string') book.seriesTitle = value.seriesTitle;
    if (typeof value.volumeNumber === 'number' && Number.isSafeInteger(value.volumeNumber) && value.volumeNumber > 0) book.volumeNumber = value.volumeNumber;
    if (typeof value.volumeCount === 'number' && Number.isSafeInteger(value.volumeCount) && value.volumeCount > 0) book.volumeCount = value.volumeCount;
    if (value.volumePolicy === 'chapters-100-v1') book.volumePolicy = value.volumePolicy;
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
  // TXT contains names, not roles, and groups need not alternate. The official
  // filename provides a conservative character allowlist for a single character.
  // Sanitization removes punctuation; require an exact marker match to avoid
  // silently mistaking a custom persona or another group member for the user.
  const filenameCharacter = context.title.match(/^(.+)_\d{4}-\d{2}-\d{2}T\d{6}(?:\d{3})?Z_chat$/)?.[1];
  if (risuText && context.removeUserInputs && (!filenameCharacter ||
      !text.split('\n').some(line => line === `--${filenameCharacter}`))) {
    throw new LibraryError('TXT에는 사용자 역할 정보가 없습니다. 원래 캐릭터명_날짜_chat 파일명을 유지하거나 역할 정보가 있는 JSON/HTML 파일로 가져와 주세요.');
  }
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
        const role = risuText ? name === filenameCharacter ? 'assistant' : 'unknown'
          : /^(user|human|나|사용자)$/i.test(name) ? 'user' : /^system$/i.test(name) ? 'system' : 'assistant';
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

function parseHtml(text: string, context: ImportContext): Book[] {
  const doc = inertDocument(text);
  const blocks = Array.from(doc.querySelectorAll('.container > .chat'));
  const character = blocks[0]?.querySelector('h2')?.textContent?.trim() || '';
  const idat = doc.querySelector('.idat');
  if (idat) {
    let chat: unknown;
    try { chat = JSON.parse(idat.textContent || ''); }
    catch { throw new LibraryError('HTML의 RisuAI .idat 대화 JSON이 손상되었습니다.'); }
    if (!record(chat) || !Array.isArray(chat.message)) throw new LibraryError('HTML의 RisuAI 메시지 목록이 올바르지 않습니다.');
    // Visible blocks add the greeting (not stored in Chat.message) and speaker
    // names missing from the raw Chat. Roles always come from .idat, never names.
    const aligned = blocks.length === chat.message.length + 1;
    const rows: unknown[] = [];
    const greeting = aligned ? blocks[0]?.querySelector(':scope > div') : undefined;
    if (greeting) rows.push({ role: 'char', name: character, content: elementText(greeting) });
    chat.message.forEach((row, i) => {
      const name = aligned ? blocks[i + 1]?.querySelector('h2')?.textContent?.trim() : undefined;
      rows.push(record(row) ? { ...row, ...(name ? { name } : {}) } : row);
    });
    return [makeBook(chat, rows, { ...context, character }, 0)];
  }
  // The actual HTML Embed template is an ordinary two-column clipboard table.
  const table = Array.from(doc.querySelectorAll('table')).find(table => {
    const headers = table.querySelectorAll('tr:first-child > th');
    return headers.length === 2 && headers[0]?.textContent?.trim() === 'Character' && headers[1]?.textContent?.trim() === 'Message';
  });
  if (!table) throw new LibraryError('RisuAI HTML의 .idat 또는 Character/Message 표를 찾을 수 없습니다.');
  const entries = Array.from(table.rows).slice(1).map(row => {
    if (row.cells.length !== 2) throw new LibraryError('RisuAI HTML 표의 메시지 행이 올바르지 않습니다.');
    return { name: elementText(row.cells[0]!), content: elementText(row.cells[1]!) };
  });
  const embedCharacter = entries[0]?.name;
  // No user IDs/roles are exported here. Only the greeting's named character
  // can be attributed safely. Other names remain unknown when filtering is off.
  const rows = entries.map(entry => ({ ...entry, role: embedCharacter && entry.name === embedCharacter ? 'assistant' : 'unknown' }));
  return [makeBook({}, rows, { ...context, character: embedCharacter || '' }, 0)];
}

/** Parse only: does not persist, fetch remote assets, or execute embedded HTML. */
export async function importChatFile(file: File, options: { removeUserInputs?: boolean } = {}): Promise<Book[]> {
  if (!file || typeof file.text !== 'function') throw new LibraryError('가져올 파일을 선택해 주세요.');
  if (file.size > MAX_FILE_BYTES) throw new LibraryError('50MB 이하의 대화 파일을 선택해 주세요.');
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!['json', 'jsonl', 'ndjson', 'txt', 'md', 'markdown', 'chat', 'html', 'htm'].includes(extension)) {
    throw new LibraryError('JSON, JSONL, TXT, HTML 또는 Markdown 파일을 선택해 주세요.');
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
  if (extension === 'html' || extension === 'htm' || (extension === 'txt' && /^\s*(?:<!doctype html|<html|<table)\b/i.test(text))) return parseHtml(text, context);
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
    try { request = indexedDB.open(DB_NAME, 2); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(PROGRESS_STORE)) request.result.createObjectStore(PROGRESS_STORE, { keyPath: 'id' });
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
async function withStores<T>(stores: string[], mode: IDBTransactionMode, action: (transaction: IDBTransaction) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(stores, mode);
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
      (message.chapter === undefined || typeof message.chapter === 'string')) ||
    (book.lastPage !== undefined && (!Number.isSafeInteger(book.lastPage) || book.lastPage < 0)) ||
    (book.seriesId !== undefined && typeof book.seriesId !== 'string') ||
    (book.seriesTitle !== undefined && typeof book.seriesTitle !== 'string') ||
    (book.volumeNumber !== undefined && (!Number.isSafeInteger(book.volumeNumber) || book.volumeNumber < 1)) ||
    (book.volumeCount !== undefined && (!Number.isSafeInteger(book.volumeCount) || book.volumeCount < 1)) ||
    (book.backCover !== undefined && typeof book.backCover !== 'string') ||
    (book.characterIcon !== undefined && typeof book.characterIcon !== 'string') ||
    (book.bookmarkStyle !== undefined && book.bookmarkStyle !== 'normal' && book.bookmarkStyle !== 'character') ||
    (book.assets !== undefined && (!Array.isArray(book.assets) || !book.assets.every(asset => record(asset) &&
      typeof asset.id === 'string' && !!asset.id.trim() && typeof asset.name === 'string' && !!asset.name.trim() && typeof asset.src === 'string' &&
      (asset.type === undefined || asset.type === 'icon' || asset.type === 'asset')))) ||
    (book.bookmarks !== undefined && (!Array.isArray(book.bookmarks) || !book.bookmarks.every(mark => record(mark) &&
      Number.isSafeInteger(mark.message) && mark.message >= 0 && mark.message < book.messages.length &&
      Number.isSafeInteger(mark.char) && mark.char >= 0 && mark.char <= book.messages[mark.message]!.content.length &&
      (mark.label === undefined || typeof mark.label === 'string'))))) {
    throw new LibraryError('저장할 책의 데이터 형식이 올바르지 않습니다.');
  }
}

/** The same safety rules apply to imports, persisted records and backup blobs. */
function sanitizedBook(book: Book): Book {
  const { cover: _cover, backCover: _backCover, characterIcon: _characterIcon, assets: _assets, bookmarks: _bookmarks, ...rest } = book;
  const cover = safeCover(book.cover);
  const backCover = safeAssetSource(book.backCover);
  const characterIcon = safeAssetSource(book.characterIcon);
  return { ...rest, messages: book.messages.map(message => ({ ...message })),
    ...(cover ? { cover } : {}), ...(backCover ? { backCover } : {}),
    ...(characterIcon ? { characterIcon } : {}),
    ...(book.assets === undefined ? {} : { assets: normalizeAssets(book.assets) }),
    ...(book.bookmarks === undefined ? {} : { bookmarks: book.bookmarks.map(mark => ({ ...mark })) }) };
}

export async function loadBooks(): Promise<Book[]> {
  let progress: ReadingProgress[] = [];
  const records = await withStores<Book[]>([STORE, PROGRESS_STORE], 'readonly', (transaction) => {
    const request = transaction.objectStore(PROGRESS_STORE).getAll();
    request.onsuccess = () => { progress = request.result; };
    return transaction.objectStore(STORE).getAll();
  });
  records.forEach(validateBook);
  const books = records.map(sanitizedBook);
  const byId = new Map(progress.filter((entry) => record(entry) && typeof entry.id === 'string' &&
    Number.isSafeInteger(entry.lastPage) && entry.lastPage >= 0 &&
    typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt))).map((entry) => [entry.id, entry]));
  for (const book of books) {
    const entry = byId.get(book.id);
    if (entry) {
      book.lastPage = entry.lastPage;
      book.updatedAt = entry.updatedAt;
    }
  }
  return books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/** Persist only lightweight reader metadata; timestamps are caller-owned. */
export async function saveReadingProgress(id: string, page: number, updatedAt: string): Promise<void> {
  if (typeof id !== 'string' || !id.trim() || !Number.isSafeInteger(page) || page < 0 ||
    typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) {
    throw new LibraryError('저장할 읽기 진행 정보의 형식이 올바르지 않습니다.');
  }
  await withStores([PROGRESS_STORE], 'readwrite', (transaction) =>
    transaction.objectStore(PROGRESS_STORE).put({ id, lastPage: page, updatedAt } satisfies ReadingProgress));
}

/** Upsert by id. Timestamps are caller-owned, allowing lossless backup restore. */
export async function saveBook(book: Book): Promise<void> {
  validateBook(book);
  const stored = sanitizedBook(book);
  await withStores([STORE, PROGRESS_STORE], 'readwrite', (transaction) => {
    const request = transaction.objectStore(STORE).put(stored);
    transaction.objectStore(PROGRESS_STORE).delete(book.id);
    return request;
  });
}

/** Atomically upsert the complete renumbered series, retaining the original ID.
 * All supplied books lose stale progress overrides in the same transaction.
 * No records are deleted; an abort leaves both stores unchanged.
 */
export async function replaceBookWithVolumes(originalId: string, volumes: Book[]): Promise<void> {
  return repackSeries(originalId, volumes, []);
}

/** Atomically replace a series and remove obsolete books and progress overrides.
 * Retained IDs win if also listed as obsolete. Failure rolls back both stores.
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

  await withStores([STORE, PROGRESS_STORE], 'readwrite', (transaction) => {
    const books = transaction.objectStore(STORE);
    const progress = transaction.objectStore(PROGRESS_STORE);
    let request!: IDBRequest<IDBValidKey>;
    for (const book of stored) {
      request = books.put(book);
      progress.delete(book.id);
    }
    for (const id of new Set(obsoleteIds)) {
      if (!ids.has(id)) { books.delete(id); progress.delete(id); }
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
  await withStores([STORE, PROGRESS_STORE], 'readwrite', transaction => {
    let request!: IDBRequest<undefined>;
    for (const id of new Set(ids)) {
      request = transaction.objectStore(STORE).delete(id);
      transaction.objectStore(PROGRESS_STORE).delete(id);
    }
    return request;
  });
}

/** Idempotent: deleting a missing id succeeds. */
export async function deleteAllBooks(): Promise<void> {
  await withStores([STORE, PROGRESS_STORE], 'readwrite', transaction => {
    const request=transaction.objectStore(STORE).clear();
    transaction.objectStore(PROGRESS_STORE).clear();
    return request;
  });
}

/** Idempotent: deleting a missing id succeeds. */
export async function deleteBook(id: string): Promise<void> {
  if (typeof id !== 'string' || !id.trim()) throw new LibraryError('삭제할 책의 ID가 필요합니다.');
  await withStores([STORE, PROGRESS_STORE], 'readwrite', (transaction) => {
    const request = transaction.objectStore(STORE).delete(id);
    transaction.objectStore(PROGRESS_STORE).delete(id);
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
