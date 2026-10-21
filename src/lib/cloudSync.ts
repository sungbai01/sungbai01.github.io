import type { Book } from './library';
import { getAuthSession } from './auth';
import { cloudBook } from '../../shared/cloudBook';

export class CloudSyncError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Row = { id: string; revision: number; deleted: boolean; updatedAt: number };
type Entry = {
  revision: number;
  fingerprint: string | null;
  deleted: boolean;
  pending?: { kind: 'put' | 'delete'; fingerprint?: string };
  copyId?: string;
};
type Index = { entries: Map<string, Entry>; series: Map<string, string> };

export interface SyncStore {
  loadBooks(): Promise<Book[]>;
  /** All replacements and removals are committed in one local transaction. */
  replace(books: Book[], removed: string[], expected: Map<string, Book | undefined>): Promise<void>;
}

const apiBase = (import.meta.env.VITE_AUTH_API_URL as string | undefined)?.trim().replace(/\/+$/, '');
const indexKey = (owner: string) => `galpi-cloud-index-v1:${encodeURIComponent(owner)}`;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

/** The fingerprint contains only the exact, image-free cloud payload. */
export async function cloudFingerprint(book: Book): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(cloudBook(book))));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function readIndex(owner: string): Index {
  const raw = localStorage.getItem(indexKey(owner));
  if (!raw) return { entries: new Map(), series: new Map() };
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.series)) {
    throw new Error('동기화 기록을 읽지 못했어요. 이 기기 책은 보관되어 있어요.');
  }
  for (const pair of data.entries) {
    const entry = pair?.[1];
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !entry
      || !Number.isSafeInteger(entry.revision) || entry.revision < 0
      || typeof entry.deleted !== 'boolean'
      || (entry.fingerprint !== null && typeof entry.fingerprint !== 'string')
      || (entry.copyId !== undefined && typeof entry.copyId !== 'string')
      || (entry.pending && !['put', 'delete'].includes(entry.pending.kind))) {
      throw new Error('동기화 기록을 읽지 못했어요. 이 기기 책은 보관되어 있어요.');
    }
  }
  if (data.series.some((pair: unknown[]) => !Array.isArray(pair) || pair.length !== 2 || pair.some(value => typeof value !== 'string'))) {
    throw new Error('동기화 기록을 읽지 못했어요. 이 기기 책은 보관되어 있어요.');
  }
  return { entries: new Map(data.entries), series: new Map(data.series) };
}

function writeIndex(owner: string, index: Index) {
  // Fail before network writes if durable revision/pending metadata is unavailable.
  try {
    localStorage.setItem(indexKey(owner), JSON.stringify({ version: 1, entries: [...index.entries], series: [...index.series] }));
  } catch {
    throw new Error('동기화 기록을 저장할 공간이 부족해요. 이 기기 책은 보관되어 있어요.');
  }
}

function validRevision(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }

function readManifest(data: unknown): Row[] {
  const rows = (data as { books?: unknown })?.books;
  if (!Array.isArray(rows)) throw new Error('서재 응답을 읽지 못했어요. 다시 시도해 주세요.');
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id)
      || !validRevision(row.revision) || typeof row.deleted !== 'boolean'
      || !Number.isFinite(row.updatedAt)) throw new Error('서재 응답을 읽지 못했어요. 다시 시도해 주세요.');
    seen.add(row.id);
  }
  return rows;
}

/** Retain device-only images, image bookmarks and unchanged source text locally. */
export function mergeCloudBook(remote: Book, local?: Book): Book {
  const clean = cloudBook(remote);
  if (!local) return clean;
  const messages = clean.messages.map((message, index) => {
    const previous = local.messages[index];
    return previous && previous.content === message.content && previous.role === message.role && previous.name === message.name
      ? { ...message, originalContent: previous.originalContent, originalMap: previous.originalMap } : message;
  });
  const sameText = JSON.stringify(clean.messages) === JSON.stringify(cloudBook(local).messages);
  return { ...clean, messages,
    cover: local.cover, backCover: local.backCover, characterIcon: local.characterIcon,
    assets: local.assets, imageRules: local.imageRules, displayRules: local.displayRules,
    bookmarkAssetId: local.bookmarkAssetId, bookmarkStyle: local.bookmarkStyle ?? clean.bookmarkStyle,
    ...(sameText ? { pageCount: local.pageCount, pageLayoutVersion: local.pageLayoutVersion } : {}),
  };
}

export async function syncCloudLibrary(options: {
  owner: string; signal: AbortSignal; assertCurrent: () => void; store: SyncStore;
}): Promise<{ conflicts: number }> {
  const { owner, signal, assertCurrent, store } = options;
  const check = () => {
    assertCurrent();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const session = getAuthSession();
    if (!session || session.user.id !== owner) throw new CloudSyncError(401, '다시 로그인해 주세요.');
    return session;
  };
  async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const session = check();
    if (!apiBase) throw new CloudSyncError(503, '서재 연결 준비 중이에요.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 20_000);
    try {
      const response = await fetch(`${apiBase}/library/books${path}`, {
        method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${session.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      check();
      if (!response.ok) {
        const messages: Record<number, string> = {
          400: '책 형식을 확인하지 못했어요. 이 기기 책은 보관되어 있어요.',
          401: '로그인이 만료되었어요. 다시 로그인해 주세요.',
          403: '서재에 연결할 수 없어요. 다시 로그인해 주세요.',
          409: '다른 기기에서 변경된 책이에요.',
          413: '책 크기나 서재 용량 한도를 넘었어요. 이 기기 책은 보관되어 있어요.',
          503: '서재 연결 준비 중이에요. 잠시 후 다시 시도해 주세요.',
        };
        throw new CloudSyncError(response.status, messages[response.status] ?? '서재를 연결하지 못했어요. 다시 시도해 주세요.');
      }
      const data: unknown = await response.json();
      check();
      return data;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  check();
  const index = readIndex(owner);
  writeIndex(owner, index);
  const books = new Map((await store.loadBooks()).map(book => [book.id, book]));
  const remote = new Map(readManifest(await request('')).map(row => [row.id, row]));
  const ids = new Set([...books.keys(), ...remote.keys(), ...index.entries.keys()]);
  let conflicts = 0;
  const failures: unknown[] = [];
  function record(id: string, entry: Entry) { check(); index.entries.set(id, entry); writeIndex(owner, index); }
  async function apply(incoming: Book[], removed: string[]) {
    check();
    const expected = new Map([...incoming.map(book => book.id), ...removed].map(id => [id, books.get(id)]));
    await store.replace(incoming, removed, expected);
    check();
    for (const id of removed) books.delete(id);
    for (const book of incoming) books.set(book.id, book);
  }
  async function fetchRemote(row: Row): Promise<{ row: Row; book?: Book }> {
    if (row.deleted) return { row };
    const data = await request(`/${encodeURIComponent(row.id)}`) as { book: Book; revision: number };
    if (!data.book || data.book.id !== row.id || !validRevision(data.revision) || !Array.isArray(data.book.messages)) {
      throw new Error('책 응답을 읽지 못했어요. 다시 시도해 주세요.');
    }
    return { row: { ...row, revision: data.revision }, book: cloudBook(data.book) };
  }
  async function latestRemote(id: string): Promise<{ row?: Row; book?: Book }> {
    const row = readManifest(await request('')).find(item => item.id === id);
    if (!row) return {};
    try { return await fetchRemote(row); }
    catch (error) {
      if (error instanceof CloudSyncError && error.status === 404) throw new Error('책이 다시 변경되었어요. 잠시 후 동기화할게요.');
      throw error;
    }
  }

  async function resolve(id: string, row: Row | undefined, remoteBook: Book | undefined, forceConflict = false) {
    const local = books.get(id);
    const entry = index.entries.get(id);
    const remoteFingerprint = remoteBook ? await cloudFingerprint(remoteBook) : null;
    const localFingerprint = local ? await cloudFingerprint(local) : null;
    const cleanLocal = !!entry && !entry.deleted && localFingerprint === entry.fingerprint;
    const alreadyRemote = !!local && !!remoteBook && localFingerprint === remoteFingerprint;
    let copy: Book | undefined;
    // A lost PUT response is acknowledged by payload, even if its revision advanced.
    const acknowledged = !!remoteBook && entry?.pending?.kind === 'put' && entry.pending.fingerprint === remoteFingerprint;
    if (acknowledged) {
      record(id, { revision: row!.revision, fingerprint: remoteFingerprint, deleted: false });
      return;
    }
    if (local && !alreadyRemote && (forceConflict || !cleanLocal)) {
      const copyId = entry?.copyId ?? crypto.randomUUID();
      let seriesId: string | undefined;
      if (local.seriesId) {
        seriesId = index.series.get(local.seriesId) ?? crypto.randomUUID();
        index.series.set(local.seriesId, seriesId);
      }
      record(id, { ...(entry ?? { revision: 0, fingerprint: null, deleted: true }), copyId });
      const now = new Date().toISOString();
      copy = books.get(copyId) ?? { ...local, id: copyId, title: `${local.title} (이 기기 사본)`,
        seriesId, seriesTitle: local.seriesTitle ? `${local.seriesTitle} (이 기기 사본)` : undefined,
        createdAt: now, updatedAt: now,
      };
      ids.add(copyId);
      conflicts += 1;
    } else if (!local && entry && !entry.deleted && remoteBook) {
      // A remote edit wins over a conflicting local deletion; never erase that edit.
      conflicts += 1;
    }
    const incoming = remoteBook ? [alreadyRemote ? local! : mergeCloudBook(remoteBook, local)] : [];
    if (copy) incoming.push(copy);
    await apply(incoming, remoteBook ? [] : [id]);
    record(id, { revision: row?.revision ?? entry?.revision ?? 0, fingerprint: remoteFingerprint, deleted: !remoteBook });
  }

  async function upload(id: string, local: Book | undefined, baseline: Entry | undefined) {
    const baseRevision = baseline?.revision ?? 0;
    const fingerprint = local ? await cloudFingerprint(local) : null;
    record(id, { ...(baseline ?? { revision: 0, fingerprint: null, deleted: true }),
      pending: local ? { kind: 'put', fingerprint: fingerprint! } : { kind: 'delete' },
    });
    try {
      const data = await request(`/${encodeURIComponent(id)}`, local ? 'PUT' : 'DELETE',
        local ? { book: cloudBook(local), baseRevision } : { baseRevision }) as { revision: number };
      if (!validRevision(data.revision) || data.revision <= baseRevision) throw new Error('저장 응답을 확인하지 못했어요. 다시 연결할게요.');
      record(id, { revision: data.revision, fingerprint, deleted: !local });
    } catch (error) {
      if (!(error instanceof CloudSyncError) || error.status !== 409) throw error;
      const latest = await latestRemote(id);
      await resolve(id, latest.row, latest.book, true);
    }
  }

  for (const id of ids) {
    check();
    try {
      const local = books.get(id);
      const row = remote.get(id);
      const entry = index.entries.get(id);
      if (row?.deleted) {
        if (!local && entry?.deleted && entry.revision === row.revision && !entry.pending) continue;
        await resolve(id, row, undefined);
      } else if (row) {
        if (entry && !entry.deleted && entry.revision === row.revision) {
          if (!local || await cloudFingerprint(local) !== entry.fingerprint) await upload(id, local, entry);
        } else {
          const latest = await fetchRemote(row);
          await resolve(id, latest.row, latest.book);
          // A recovered lost response may leave a newer local edit/delete pending.
          const currentEntry = index.entries.get(id)!;
          const currentBook = books.get(id);
          if (!currentBook || await cloudFingerprint(currentBook) !== currentEntry.fingerprint) await upload(id, currentBook, currentEntry);
        }
      } else if (local) {
        if (entry && entry.revision > 0) await resolve(id, undefined, undefined, true);
        else await upload(id, local, entry);
      }
    } catch (error) {
      check();
      if (error instanceof CloudSyncError && [401, 403, 503].includes(error.status)) throw error;
      failures.push(error);
    }
  }
  if (failures.length) throw failures[0];
  return { conflicts };
}
