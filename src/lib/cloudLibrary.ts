import * as local from './library';
import type { Book, BookmarkUpdate } from './library';
import { getAuthSession } from './auth';
import { cloudBook } from '../../shared/cloudBook';
import { loadAccountImages, loadBookImages, saveAccountImages, deleteAccountImages } from './localImages';

export type CloudStatus = { phase: 'guest' | 'loading' | 'ready' | 'saving' | 'error'; message: string };
export interface AccountStore {
  loadBooks(): Promise<Book[]>;
  ensureBook(id: string): Promise<Book>;
  repackSeries(id: string, books: Book[], obsolete: string[]): Promise<void>;
  updateBookmarks(updates: BookmarkUpdate[]): Promise<void>;
  deleteBooks(ids: string[]): Promise<void>;
  deleteBook(id: string): Promise<void>;
}
class LibraryApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const apiBase = (import.meta.env.VITE_AUTH_API_URL as string | undefined)?.trim().replace(/\/+$/, '');
let active: CloudLibrary | undefined;
export function stopCloudLibrary() { active?.stop(); }
const validRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const aborted = () => new DOMException('서재 계정이 변경되었어요.', 'AbortError');

/** API is authoritative; signed-in prose and revisions live in memory only. */
export class CloudLibrary {
  private stopped = true;
  private ticket = 0;
  private generation = -1;
  private ready: Promise<Book[]> = Promise.resolve([]);
  private tail: Promise<unknown> = Promise.resolve();
  private controller = new AbortController();
  private metadata = new Map<string, Book>();
  private bodies = new Map<string, Book>();
  private revisions = new Map<string, number>();
  private bodyRequests = new Map<string, Promise<Book>>();
  private onBooks: (books: Book[]) => void = () => {};
  private onStatus: (status: CloudStatus) => void = () => {};
  constructor(readonly owner: string | null) {}
  assertCurrent = () => {
    if (this.stopped || active !== this || this.generation !== local.getLibraryGeneration()
      || (getAuthSession()?.user.id ?? null) !== this.owner) throw aborted();
  };
  private status(phase: CloudStatus['phase'], message: string) {
    if (!this.stopped && active === this) this.onStatus({ phase, message });
  }
  private view() { return [...this.metadata.values()].map(book => this.bodies.get(book.id) ?? book); }
  private publish() { this.assertCurrent(); this.onBooks(this.view()); }
  private queue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => { this.assertCurrent(); return action(); });
    this.tail = next.catch(() => {});return next;
  }
  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    this.assertCurrent();const ticket = this.ticket;const session = getAuthSession();
    if (!this.owner || !session || session.user.id !== this.owner) throw aborted();
    if (!apiBase) throw new LibraryApiError(503, '서재 연결 준비 중이에요.');
    const controller = new AbortController();const accountSignal = this.controller.signal;
    const abort = () => controller.abort();accountSignal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 20_000);
    try {
      const response = await fetch(`${apiBase}/library/books${path}`, {
        method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${session.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      this.assertCurrent();if(ticket !== this.ticket)throw aborted();
      if (!response.ok) {
        const messages: Record<number, string> = {
          400: '책 형식을 확인하지 못했어요.',
          401: '로그인을 다시 확인해 주세요. 작성 중인 내용은 이 화면에 남아 있어요.',
          403: '이 계정의 서재에 접근할 수 없어요. 로그인을 확인해 주세요.',
          404: '책을 찾지 못했어요. 서재 목록을 다시 불러와 주세요.',
          409: '다른 기기에서 책이 바뀌었어요. 작성 내용을 따로 보관한 뒤 목록을 다시 불러와 주세요.',
          413: '책 크기나 서재 용량 한도를 넘었어요.',
          503: '서재 연결 준비 중이에요. 잠시 후 다시 시도해 주세요.',
        };
        throw new LibraryApiError(response.status, messages[response.status] ?? '요청을 완료하지 못했어요. 다시 시도해 주세요.');
      }
      const result = await response.json();this.assertCurrent();if(ticket !== this.ticket)throw aborted();return result;
    } catch (error) {
      if (accountSignal.aborted || ticket !== this.ticket) throw aborted();
      if (error instanceof LibraryApiError) throw error;
      throw new Error('서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
    } finally { clearTimeout(timer);accountSignal.removeEventListener('abort', abort); }
  }
  private async listRemote(): Promise<Book[]> {
    const ticket=this.ticket;
    const metadata = new Map<string, Book>();const revisions = new Map<string, number>();
    const cursors = new Set<string>();let cursor: string | null = null;
    do {
      const data = await this.request(cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`) as {
        books: { id: string; revision: number; updatedAt: number; deleted: boolean; book: Partial<Book> }[];
        nextCursor: string | null;
      };
      if (!data || !Array.isArray(data.books) || !(data.nextCursor === null || typeof data.nextCursor === 'string')) throw new Error('서재 목록을 읽지 못했어요.');
      for (const row of data.books) {
        const book = row?.book;
        if (!row || typeof row.id !== 'string' || !row.id || metadata.has(row.id) || !validRevision(row.revision)
          || row.deleted !== false || !Number.isFinite(row.updatedAt) || !book || book.id !== row.id
          || typeof book.title !== 'string' || typeof book.author !== 'string' || typeof book.color !== 'string'
          || typeof book.createdAt !== 'string' || typeof book.updatedAt !== 'string'
          || !Array.isArray(book.messages) || book.messages.length) throw new Error('서재 목록을 읽지 못했어요.');
        // Metadata bookmarks have no body: do not pass them through cloudBook.
        metadata.set(row.id, { ...book, description: book.description ?? '', messages: [] } as Book);
        revisions.set(row.id, row.revision);
      }
      cursor = data.nextCursor;
      if (cursor !== null) { if (!cursor || cursors.has(cursor)) throw new Error('서재 목록을 읽지 못했어요.');cursors.add(cursor); }
    } while (cursor !== null);
    const previews = await loadAccountImages(this.owner!);this.assertCurrent();if(ticket!==this.ticket)throw aborted();
    for (const [id, book] of metadata) metadata.set(id, { ...book, ...previews.get(id) });
    this.metadata = metadata;this.revisions = revisions;this.bodies.clear();this.bodyRequests.clear();
    return [...metadata.values()];
  }
  start(options: { initialize: (store: AccountStore) => Promise<Book[]>; onBooks: (books: Book[]) => void; onStatus: (status: CloudStatus) => void }): Promise<Book[]> {
    active?.stop();active = this;this.stopped = false;const ticket = ++this.ticket;
    this.controller = new AbortController();this.onBooks = options.onBooks;this.onStatus = options.onStatus;
    // Signed-in books never use IndexedDB. Only the existing guest database is selected.
    local.setLibraryAccount(null);this.generation = local.getLibraryGeneration();
    this.status('loading', '서재 목록을 불러오고 있어요.');
    this.ready = (async () => {
      const books = this.owner ? await this.listRemote() : await options.initialize(this.store());
      this.assertCurrent();if(ticket !== this.ticket)throw aborted();this.onBooks(books);
      this.status(this.owner ? 'ready' : 'guest', this.owner ? '서버 서재를 이용하고 있어요.' : '이 기기에 저장하고 있어요.');return books;
    })();
    void this.ready.catch(error => { if(ticket===this.ticket)this.status('error', error instanceof Error ? error.message : '서재를 열지 못했어요.'); });
    return this.ready;
  }
  stop() {
    this.stopped = true;this.ticket += 1;this.controller.abort();
    this.metadata.clear();this.bodies.clear();this.revisions.clear();this.bodyRequests.clear();
  }
  async loadBooks(): Promise<Book[]> {
    await this.ready;this.assertCurrent();return this.owner ? [...this.metadata.values()] : local.loadBooks();
  }
  async ensureBook(id: string, refresh = false): Promise<Book> {
    await this.ready;this.assertCurrent();
    if (!this.owner) {
      const book = (await local.loadBooks()).find(book => book.id === id);this.assertCurrent();
      if(!book)throw new Error('책을 찾지 못했어요.');return book;
    }
    if (!refresh && this.bodies.has(id)) return this.bodies.get(id)!;
    const pending = this.bodyRequests.get(id);if(pending)return pending;
    const ticket=this.ticket;
    const request = (async () => {
      const result = await this.request(`/${encodeURIComponent(id)}`) as { book: Book; revision: number };
      if (!result?.book || result.book.id !== id || !Array.isArray(result.book.messages) || !result.book.messages.length || !validRevision(result.revision)) throw new Error('책 본문을 읽지 못했어요.');
      const images = await loadBookImages(this.owner!, id);this.assertCurrent();if(ticket!==this.ticket)throw aborted();
      const book = { ...cloudBook(result.book), ...images };
      this.bodies.set(id, book);this.revisions.set(id, result.revision);this.metadata.set(id, this.toMetadata(book));this.publish();return book;
    })();
    this.bodyRequests.set(id, request);
    try { return await request; } finally { if(this.bodyRequests.get(id)===request)this.bodyRequests.delete(id); }
  }
  private toMetadata(book: Book): Book {
    const clean = cloudBook(book);
    return { ...clean, description: clean.description.slice(0, 160), messages: [],
      cover: book.cover, backCover: book.backCover, characterIcon: book.characterIcon,
      bookmarkAssetId: book.bookmarkAssetId, bookmarkStyle: book.bookmarkStyle,
      assets: book.assets?.filter(asset => asset.type === 'icon' || asset.id === book.bookmarkAssetId),
    };
  }
  private async put(book: Book) {
    this.assertCurrent();if (!book.messages.length) throw new Error('책 본문을 불러온 뒤 저장해 주세요.');
    const existing = this.bodies.get(book.id);const payload = cloudBook(book);
    if (!existing || JSON.stringify(cloudBook(existing)) !== JSON.stringify(payload)) {
      const result = await this.request(`/${encodeURIComponent(book.id)}`, 'PUT', { book: payload, baseRevision: this.revisions.get(book.id) ?? 0 }) as { revision: number };
      if (!validRevision(result?.revision)) throw new Error('저장 결과를 확인하지 못했어요. 목록을 다시 불러와 주세요.');
      this.revisions.set(book.id, result.revision);
    }
    this.bodies.set(book.id, book);this.metadata.set(book.id, this.toMetadata(book));
    const imageFields = ['assets','cover','backCover','characterIcon','bookmarkStyle','bookmarkAssetId','imageRules','displayRules'] as const;
    if (existing && imageFields.every(field=>existing[field]===book[field])) return;
    try { await saveAccountImages(this.owner!, book);this.assertCurrent(); }
    catch(error) { this.publish();throw new Error(`책의 서버 저장은 완료했지만 이 기기 이미지를 저장하지 못했어요. ${error instanceof Error ? error.message : ''}`); }
  }
  private async remove(id: string) {
    this.assertCurrent();const revision = this.revisions.get(id);
    if (!revision) throw new Error('서재 목록을 다시 불러온 뒤 삭제해 주세요.');
    await this.request(`/${encodeURIComponent(id)}`, 'DELETE', { baseRevision: revision });
    this.metadata.delete(id);this.bodies.delete(id);this.revisions.delete(id);
    await deleteAccountImages(this.owner!, id);this.assertCurrent();
  }
  private store(): AccountStore {
    const check = async <T,>(action: () => Promise<T>) => { this.assertCurrent();const value=await action();this.assertCurrent();return value; };
    return {
      loadBooks: () => check(() => this.owner ? Promise.resolve([...this.metadata.values()]) : local.loadBooks()),
      ensureBook: id => this.ensureBook(id),
      repackSeries: (id, books, obsolete) => check(async () => {
        if (!this.owner) return local.repackSeries(id, books, obsolete);
        for (const book of books) await this.put(book);
        for (const removed of obsolete) if(!books.some(book=>book.id===removed))await this.remove(removed);
      }),
      updateBookmarks: updates => check(async () => {
        if (!this.owner) return local.updateBookmarks(updates);
        for (const update of updates) { const book = await this.ensureBook(update.id);await this.put({ ...book, ...update }); }
      }),
      deleteBooks: ids => check(async () => { if(!this.owner)return local.deleteBooks(ids);for(const id of ids)await this.remove(id); }),
      deleteBook: id => check(() => this.owner ? this.remove(id) : local.deleteBook(id)),
    };
  }
  async edit<T>(work: (store: AccountStore) => Promise<T>, options: { publish?: boolean } = {}): Promise<T> {
    await this.ready;return this.queue(async () => {
      this.status('saving', this.owner ? '서버에 저장하고 있어요.' : '이 기기에 저장하고 있어요.');
      try {
        const result = await work(this.store());this.assertCurrent();
        if(options.publish!==false)this.onBooks(this.owner?this.view():await local.loadBooks());
        this.status(this.owner?'ready':'guest', this.owner?'서버에 저장했어요.':'이 기기에 저장했어요.');return result;
      } catch(error) {
        this.assertCurrent();if(this.owner)this.publish();
        this.status('error', error instanceof Error?error.message:'저장하지 못했어요.');throw error;
      }
    });
  }
  reload = async () => {
    this.assertCurrent();return this.queue(async () => {
      this.status('loading','서재 목록을 불러오고 있어요.');
      try {
        const books = this.owner ? await this.listRemote() : await local.loadBooks();
        this.assertCurrent();this.onBooks(books);this.status(this.owner?'ready':'guest',this.owner?'서재 목록을 불러왔어요.':'이 기기에 저장하고 있어요.');
        this.ready=Promise.resolve(books);return books;
      } catch(error){this.status('error',error instanceof Error?error.message:'목록을 불러오지 못했어요.');throw error;}
    });
  };
  async importGuestBooks(): Promise<number> {
    if(!this.owner)throw new Error('로그인한 뒤 가져올 수 있어요.');
    return this.edit(async store => {
      const guest=await local.loadGuestBooks();this.assertCurrent();
      const ids=new Map(guest.map(book=>[book.id,crypto.randomUUID()]));const series=new Map<string,string>();
      const incoming=guest.map(book=>{
        if(book.seriesId&&!series.has(book.seriesId))series.set(book.seriesId,ids.get(book.seriesId)??crypto.randomUUID());
        return {...book,id:ids.get(book.id)!,...(book.seriesId?{seriesId:series.get(book.seriesId)!}:{}),uploadedAt:new Date().toISOString()};
      });
      if(incoming.length)await store.repackSeries(incoming[0]!.id,incoming,[]);return incoming.length;
    });
  }
}
