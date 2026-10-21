export interface AuthSession {
  readonly token: string;
  /** Unix timestamp in milliseconds. */
  readonly expiresAt: number;
  readonly user: { readonly id: string };
}

let session: AuthSession | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

export function clearAuthSession() {
  clearTimeout(expiryTimer);
  expiryTimer = undefined;
  if (!session) return;
  session = null;
  notify();
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (!session) return;
  const remaining = session.expiresAt - Date.now();
  if (remaining <= 0) {
    clearAuthSession();
    return;
  }
  expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
}

/** No storage, cookies, profile claims, or Google credentials are retained here. */
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
  if (typeof data.token !== 'string' || !data.token.trim()
    || !user || typeof user.id !== 'string' || !user.id.trim()
    || !Number.isSafeInteger(expiry) || expiry <= Date.now()) {
    throw new Error('Invalid session');
  }
  // Copy only this allowlist, even if the server accidentally includes a profile.
  session = Object.freeze({
    token: data.token,
    expiresAt: Math.min(expiry, Date.now() + 60 * 60 * 1000),
    user: Object.freeze({ id: user.id }),
  });
  scheduleExpiry();
  notify();
}
