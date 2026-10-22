import {beginSkeletonTask} from './loadingActivity';
export interface AuthSession {
  readonly token: string;
  /** Unix timestamp in milliseconds. */
  readonly expiresAt: number;
  readonly user: { readonly id: string };
}

const SESSION_KEY = 'galpi.auth.session.v1';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const apiBase = (import.meta.env.VITE_AUTH_API_URL as string | undefined)?.trim().replace(/\/+$/, '');
let session: AuthSession | null = null;
let revision = 0;
let restorePromise: Promise<void> | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function notify() { listeners.forEach(listener => listener()); }
function removeStoredTicket() {
  try { window.localStorage.removeItem(SESSION_KEY); } catch { /* Storage may be restricted. */ }
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* Memory login remains available. */ }
}

export function clearAuthSession() {
  revision += 1;
  clearTimeout(expiryTimer);
  expiryTimer = undefined;
  removeStoredTicket();
  if (!session) return;
  session = null;
  notify();
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (!session) return;
  const remaining = session.expiresAt - Date.now();
  if (remaining <= 0) { clearAuthSession(); return; }
  expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
}

/** Only a server-verified session enters memory; saved tickets are not identities. */
export function getAuthSession(): AuthSession | null {
  if (session && session.expiresAt <= Date.now()) clearAuthSession();
  return session;
}

export function subscribeAuthSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Accept only the backend's verified session; never decode a Google credential. */
export function setAuthSession(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid session');
  const data = value as Record<string, unknown>;
  const user = data.user as Record<string, unknown> | null;
  const expiry = typeof data.expiresAt === 'number' ? data.expiresAt : NaN;
  if (typeof data.token !== 'string' || !data.token.trim() || data.token.length > 4096
    || !user || typeof user.id !== 'string' || !/^u_[A-Za-z0-9_-]{43}$/.test(user.id)
    || !Number.isSafeInteger(expiry) || expiry <= Date.now()) throw new Error('Invalid session');
  revision += 1;
  session = Object.freeze({
    token: data.token,
    expiresAt: Math.min(expiry, Date.now() + MAX_AGE),
    user: Object.freeze({ id: user.id }),
  });
  // Persist only the service ticket. Identity is reverified by the server on bootstrap.
  try { window.localStorage.setItem(SESSION_KEY, JSON.stringify({token:session.token,expiresAt:session.expiresAt}));
    window.sessionStorage.removeItem(SESSION_KEY); }
  catch { /* Restricted browser storage must not prevent login. */ }
  scheduleExpiry();
  notify();
}

/** Bootstrap before mounting either library. The server alone establishes identity. */
export function restoreAuthSession(): Promise<void> {
  if (getAuthSession()) return Promise.resolve();
  if (restorePromise) return restorePromise;
  restorePromise = restoreTicket().finally(() => { restorePromise = undefined; });
  return restorePromise;
}

async function restoreTicket(): Promise<void> {
  let ticket: {token:string;expiresAt:number};
  try {
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(SESSION_KEY); } catch { /* Try the previous tab ticket. */ }
    raw ??= window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    if (raw.length > 6000) throw new Error('Invalid ticket');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw new Error('Invalid ticket');
    const data = value as Record<string,unknown>;
    if (typeof data.token !== 'string' || !data.token.trim() || data.token.length > 4096
      || typeof data.expiresAt !== 'number' || !Number.isSafeInteger(data.expiresAt)
      || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + MAX_AGE) throw new Error('Expired ticket');
    ticket = {token:data.token,expiresAt:data.expiresAt};
  } catch { removeStoredTicket(); return; }
  if (!apiBase) throw new Error('로그인 서버에 연결하지 못했어요.');
  const expected = revision;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const finishLoading=beginSkeletonTask('network');
  try {
    const response = await fetch(`${apiBase}/auth/me`, {
      method:'GET',credentials:'omit',cache:'no-store',signal:controller.signal,
      headers:{Authorization:`Bearer ${ticket.token}`},
    });
    if (expected !== revision) return;
    if (response.status === 401) { removeStoredTicket(); return; }
    if (!response.ok) throw new Error('Verification unavailable');
    const verified: unknown = await response.json();
    if (expected !== revision) return;
    if (ticket.expiresAt <= Date.now()) { removeStoredTicket(); return; }
    if (!verified || typeof verified !== 'object' || !('user' in verified)) throw new Error('Invalid session');
    setAuthSession({...ticket,user:verified.user});
  } catch {
    if (expected === revision) throw new Error('로그인을 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  } finally { clearTimeout(timer);finishLoading(); }
}

// Explicit logout in another tab must also cancel restoration and clear memory.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.storageArea !== window.localStorage || (event.key !== SESSION_KEY && event.key !== null)) return;
  if (event.newValue === null) {
    revision += 1;
    clearTimeout(expiryTimer); expiryTimer = undefined;
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* Restricted storage. */ }
    if (session) { session = null; notify(); }
  }
});
