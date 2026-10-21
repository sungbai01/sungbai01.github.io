import * as local from './library';
import type { Book, BookmarkUpdate } from './library';
import { clearAuthSession, getAuthSession } from './auth';
import { CloudSyncError, syncCloudLibrary } from './cloudSync';

export type CloudStatus = {
  phase: 'guest' | 'loading' | 'waiting' | 'syncing' | 'synced' | 'offline' | 'error';
  message: string;
};
export interface AccountStore {
  loadBooks(): Promise<Book[]>;
  repackSeries(id: string, books: Book[], obsolete: string[]): Promise<void>;
  updateBookmarks(updates: BookmarkUpdate[]): Promise<void>;
  deleteBooks(ids: string[]): Promise<void>;
  deleteBook(id: string): Promise<void>;
}

// Only local work uses this queue. Network requests never hold a local edit lock.
let tail: Promise<unknown> = Promise.resolve();
let active: CloudLibrary | undefined;
function enqueue<T>(owner: string | null, work: () => Promise<T>): Promise<T> {
  const next = tail.then(() => navigator.locks
    ? navigator.locks.request(`galpi-library:${owner ?? 'guest'}`, work) : work());
  tail = next.catch(() => {});
  return next;
}

/** Invalidate old callbacks synchronously when an auth notification arrives. */
export function stopCloudLibrary() { active?.stop(); }

export class CloudLibrary {
  private stopped = true;
  private ticket = 0;
  private generation = -1;
  private ready: Promise<Book[]> = Promise.resolve([]);
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;
  private syncQueued = false;
  private enabled = false;
  private paused = false;
  private editEpoch = 0;
  private pendingEdits = 0;
  private syncStorageUnavailable = false;
  private onBooks: (books: Book[]) => void = () => {};
  private onStatus: (status: CloudStatus) => void = () => {};
  private prepare: (book: Book) => Promise<Book> = async book => book;
  private wake = () => { if (document.visibilityState === 'visible') this.retry(); };
  private online = () => this.retry();
  private offline = () => this.status('offline', '오프라인이에요. 이 기기에 저장하고 있어요.');
  private revisionKey = () => `galpi-local-edit-v1:${encodeURIComponent(this.owner ?? 'guest')}`;
  private storageChanged = (event: StorageEvent) => {
    if (event.key === this.revisionKey() || event.key === null) {
      this.controller.abort();
      this.controller = new AbortController();
      this.changed();
    }
  };

  private readRevision() {
    if (this.syncStorageUnavailable) throw new Error('동기화 기록을 저장할 수 없어요. 이 기기 책은 보관되어 있어요.');
    const revision = Number(localStorage.getItem(this.revisionKey()) ?? '0');
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('동기화 기록을 읽지 못했어요.');
    return revision;
  }

  constructor(readonly owner: string | null) {
    // No database access or network requests at render time.
  }

  assertCurrent = () => {
    if (this.stopped || active !== this || local.getLibraryGeneration() !== this.generation
      || (getAuthSession()?.user.id ?? null) !== this.owner) {
      throw new DOMException('서재 계정이 변경되었어요.', 'AbortError');
    }
  };

  private status(phase: CloudStatus['phase'], message: string) {
    if (!this.stopped && active === this) this.onStatus({ phase, message });
  }

  private rawStore(): AccountStore {
    const checked = async <T,>(action: () => Promise<T>) => {
      this.assertCurrent();
      const result = await action();
      this.assertCurrent();
      return result;
    };
    return {
      loadBooks: () => checked(() => local.loadBooks()),
      repackSeries: (id, books, obsolete) => checked(() => local.repackSeries(id, books, obsolete)),
      updateBookmarks: updates => checked(() => local.updateBookmarks(updates)),
      deleteBooks: ids => checked(() => local.deleteBooks(ids)),
      deleteBook: id => checked(() => local.deleteBook(id)),
    };
  }

  /** For reads outside an edit transaction (e.g. a local backup). */
  async loadBooks() { await this.ready; return this.rawStore().loadBooks(); }

  start(options: {
    initialize: (store: AccountStore) => Promise<Book[]>;
    onBooks: (books: Book[]) => void;
    onStatus: (status: CloudStatus) => void;
    prepare: (book: Book) => Promise<Book>;
  }): Promise<Book[]> {
    active?.stop();
    active = this;
    this.stopped = false;
    this.enabled = false;
    this.syncQueued = false;
    const ticket = ++this.ticket;
    this.controller = new AbortController();
    this.onBooks = options.onBooks;
    this.onStatus = options.onStatus;
    this.prepare = options.prepare;
    this.status('loading', '서재를 열고 있어요.');
    this.ready = enqueue(this.owner, async () => {
      if (this.stopped || active !== this || ticket !== this.ticket) throw new DOMException('Aborted', 'AbortError');
      // Switching the local database always precedes the first account read.
      await local.setLibraryAccount(this.owner);
      this.generation = local.getLibraryGeneration();
      this.assertCurrent();
      const books = await options.initialize(this.rawStore());
      this.assertCurrent();
      if (ticket !== this.ticket) throw new DOMException('Aborted', 'AbortError');
      this.onBooks(books);
      this.enabled = true;
      this.status(this.owner ? 'waiting' : 'guest', this.owner ? '동기화를 준비하고 있어요.' : '이 기기에 저장하고 있어요.');
      return books;
    });
    void this.ready.then(() => {
      if (this.stopped || ticket !== this.ticket || !this.owner) return;
      this.poll = setInterval(() => this.retry(), 60_000);
      document.addEventListener('visibilitychange', this.wake);
      window.addEventListener('online', this.online);
      window.addEventListener('offline', this.offline);
      window.addEventListener('storage', this.storageChanged);
      this.retry();
    }).catch(() => {});
    return this.ready;
  }

  stop() {
    this.stopped = true;
    this.generation = -1;
    this.enabled = false;
    this.ticket += 1;
    this.controller.abort();
    clearTimeout(this.timer);
    clearInterval(this.poll);
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('online', this.online);
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('storage', this.storageChanged);
  }

  /** Entire read/prepare/write sequences run together, preventing remote lost updates. */
  async edit<T>(work: (store: AccountStore) => Promise<T>, options: { publish?: boolean } = {}): Promise<T> {
    // Cancel immediately, before waiting for readiness or a local transaction.
    this.controller.abort();
    this.controller = new AbortController();
    this.editEpoch += 1;
    this.pendingEdits += 1;
    try {
      await this.ready;
      this.assertCurrent();
      return await enqueue(this.owner, async () => {
        this.assertCurrent();
        if (this.owner) {
          try { localStorage.setItem(this.revisionKey(), String(this.readRevision() + 1)); }
          catch { this.syncStorageUnavailable = true; }
        }
        const value = await work(this.rawStore());
        this.assertCurrent();
        // Bookmark writes keep their existing sparse path and live reader references.
        if (options.publish !== false) this.onBooks(await this.rawStore().loadBooks());
        return value;
      });
    } finally {
      this.pendingEdits -= 1;
      this.changed();
    }
  }

  private changed() {
    if (!this.owner || this.stopped || !this.enabled) return;
    clearTimeout(this.timer);
    this.status(navigator.onLine ? 'waiting' : 'offline', navigator.onLine ? '변경 내용을 저장하고 있어요.' : '오프라인이에요. 이 기기에 저장하고 있어요.');
    this.timer = setTimeout(() => this.retry(), 1_000);
  }

  /** Unsaved reader/editor drafts must not receive remote replacements. */
  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.controller.abort();
      this.controller = new AbortController();
      clearTimeout(this.timer);
    } else if (this.enabled) {
      this.timer = setTimeout(() => this.retry(), 1_000);
    }
  }

  retry = () => {
    if (!this.owner || !this.enabled || this.stopped || this.syncQueued || this.paused || this.pendingEdits) return;
    if (!navigator.onLine) { this.offline(); return; }
    clearTimeout(this.timer);
    this.syncQueued = true;
    const ticket = this.ticket;
    const signal = this.controller.signal;
    const run = async () => {
      const epoch = this.editEpoch;
      let revision: number;
      let snapshot: Book[];
      let applied = false;
      const store = this.rawStore();
      const assertSync = () => {
        this.assertCurrent();
        if (signal.aborted || this.paused || epoch !== this.editEpoch || this.pendingEdits
          || (revision !== undefined && revision !== this.readRevision())) {
          throw new DOMException('Local edits superseded sync', 'AbortError');
        }
      };
      try {
        await enqueue(this.owner, async () => {
          assertSync();
          revision = this.readRevision();
          snapshot = await store.loadBooks();
          assertSync();
        });
        this.status('syncing', '서재를 동기화하고 있어요.');
        const result = await syncCloudLibrary({ owner: this.owner!, signal, assertCurrent: assertSync,
          store: {
            loadBooks: async () => snapshot,
            replace: async (books, removed, expected) => {
              const prepared: Book[] = [];
              for (const book of books) { prepared.push(await this.prepare(book)); assertSync(); }
              await enqueue(this.owner, async () => {
                assertSync();
                const latest = new Map((await store.loadBooks()).map(book => [book.id, book]));
                assertSync();
                for (const [id, previous] of expected) {
                  if (JSON.stringify(latest.get(id)) !== JSON.stringify(previous)) {
                    throw new DOMException('Local book changed during sync', 'AbortError');
                  }
                }
                if (prepared.length) { await store.repackSeries(prepared[0]!.id, prepared, removed); applied = true; }
                else if (removed.length) { await store.deleteBooks(removed); applied = true; }
                assertSync();
              });
            },
          },
        });
        this.assertCurrent();
        this.status('synced', result.conflicts ? '동기화했어요. 충돌한 책은 이 기기 사본으로 보관했어요.' : '동기화되었어요.');
      } finally {
        // Even a partial sync must publish its committed local changes.
        if (applied && !this.stopped && ticket === this.ticket) {
          await enqueue(this.owner, async () => {
            const books = await store.loadBooks();
            this.assertCurrent();
            this.onBooks(books);
          });
        }
      }
    };
    // A separate sync-only lock prevents two tabs racing the durable CAS journal;
    // local edits never acquire it and are free to cancel this network run.
    const running = navigator.locks
      ? navigator.locks.request(`galpi-cloud-sync:${this.owner}`, { ifAvailable: true }, lock => lock ? run() : undefined)
      : run();
    void running.catch(error => {
      if (this.stopped || ticket !== this.ticket) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.status('waiting', '이 기기에 저장하고 있어요. 편집을 마치면 동기화해요.');
        return;
      }
      if (error instanceof CloudSyncError && [401, 403].includes(error.status)) { clearAuthSession(); return; }
      this.status(navigator.onLine ? 'error' : 'offline', error instanceof CloudSyncError || error instanceof Error && error.message.startsWith('동기화 기록')
        ? error.message : navigator.onLine ? '동기화하지 못했어요. 이 기기 책은 보관되어 있어요.' : '오프라인이에요. 이 기기에 저장하고 있어요.');
    }).finally(() => { if (ticket === this.ticket) this.syncQueued = false; });
  };

  /** Explicit opt-in: new IDs prevent guest books colliding with cloud books. */
  async importGuestBooks(): Promise<number> {
    if (!this.owner) throw new Error('로그인한 뒤 가져올 수 있어요.');
    return this.edit(async store => {
      this.assertCurrent();
      const guest = await local.loadGuestBooks();
      this.assertCurrent();
      const ids = new Map(guest.map(book => [book.id, crypto.randomUUID()]));
      const series = new Map<string, string>();
      const now = new Date().toISOString();
      const incoming = guest.map(book => {
        if (book.seriesId && !series.has(book.seriesId)) series.set(book.seriesId, ids.get(book.seriesId) ?? crypto.randomUUID());
        return { ...book, id: ids.get(book.id)!, ...(book.seriesId ? { seriesId: series.get(book.seriesId)! } : {}), uploadedAt: now };
      });
      if (incoming.length) await store.repackSeries(incoming[0]!.id, incoming, []);
      return incoming.length;
    }, { publish: true });
  }
}
