import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, LogOut, UserRound } from 'lucide-react';
import { clearAuthSession, getAuthSession, setAuthSession, subscribeAuthSession } from '../lib/auth';
import './google-account.css';

interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: { credential?: string }) => void;
    auto_select: boolean;
    button_auto_select: boolean;
    ux_mode: 'popup';
  }): void;
  renderButton(element: HTMLElement, options: {
    type: 'standard'; theme: 'outline'; size: 'large'; text: 'signin_with';
    locale: string; width: number;
  }): void;
  disableAutoSelect(): void;
}

function googleIdentity(): GoogleIdentity | undefined {
  return (window as Window & { google?: { accounts?: { id?: GoogleIdentity } } }).google?.accounts?.id;
}

let scriptPromise: Promise<GoogleIdentity> | undefined;

// Called exclusively by the explicit login/retry action, never during rendering.
function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const existing = googleIdentity();
  if (existing) return Promise.resolve(existing);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    const finish = (error?: Error) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      const identity = googleIdentity();
      if (error || !identity) {
        script.remove();
        reject(error ?? new Error('Google sign-in unavailable'));
      } else resolve(identity);
    };
    const timer = setTimeout(() => finish(new Error('Google sign-in timeout')), 15_000);
    script.onload = () => finish();
    script.onerror = () => finish(new Error('Google sign-in failed'));
    document.head.append(script);
  }).catch(error => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

const apiBase = (import.meta.env.VITE_AUTH_API_URL as string | undefined)?.trim().replace(/\/+$/, '');
type Phase = 'idle' | 'loading' | 'ready' | 'verifying' | 'pending' | 'error';

/** Standalone account section for the main drawer. No library access is gated. */
export function GoogleAccount({ className = '' }: { className?: string }) {
  const titleId = useId();
  const googleButton = useRef<HTMLDivElement>(null);
  const attempt = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [session, updateSession] = useState(getAuthSession);
  const hadSession = useRef(Boolean(session));
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeAuthSession(() => {
      const next = getAuthSession();
      if (hadSession.current && !next) setMessage('로그인이 만료되었어요. 다시 로그인해 주세요.');
      hadSession.current = Boolean(next);
      updateSession(next);
      setPhase('idle');
    });
    const currentSession = getAuthSession();
    hadSession.current = Boolean(currentSession);
    updateSession(currentSession);
    return () => {
      unsubscribe();
      attempt.current += 1;
      request.current?.abort();
    };
  }, []);

  async function startLogin() {
    if (!apiBase || phase === 'loading' || phase === 'verifying') return;
    const current = ++attempt.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setMessage('');
    setPhase('loading');
    googleButton.current?.replaceChildren();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const configResponse = await fetch(`${apiBase}/auth/config`, {
        method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      });
      if (current !== attempt.current) return;
      if (configResponse.status === 503) {
        if(current!==attempt.current)return;
        setPhase('pending');
        setMessage('로그인 연결 준비 중이에요. 내 서재는 그대로 이용할 수 있어요.');
        return;
      }
      if (!configResponse.ok) throw new Error('Configuration unavailable');
      const config: unknown = await configResponse.json();
      if (!config || typeof config !== 'object'
        || !('clientId' in config) || typeof config.clientId !== 'string' || !config.clientId.trim()) {
        throw new Error('Invalid configuration');
      }
      const identity = await loadGoogleIdentity();
      if (current !== attempt.current) return;
      if (controller.signal.aborted) throw new Error('Login timeout');
      // 64 random hex characters satisfy the backend's [A-Za-z0-9_-]{32,128} contract.
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      let credentialUsed = false;
      identity.initialize({
        client_id: config.clientId,
        nonce,
        auto_select: false,
        button_auto_select: false,
        ux_mode: 'popup',
        callback: response => {
          if (current !== attempt.current || credentialUsed) return;
          credentialUsed = true;
          void verifyCredential(response.credential, nonce, current);
        },
      });
      if (!googleButton.current) return;
      identity.renderButton(googleButton.current, {
        type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', locale: 'ko',
        width: Math.min(320, Math.max(200, googleButton.current.clientWidth)),
      });
      setPhase('ready');
    } catch {
      if (current !== attempt.current) return;
      setPhase('error');
      setMessage('로그인을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async function verifyCredential(credential: string | undefined, nonce: string, current: number) {
    setPhase('verifying');
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      if (!credential) throw new Error('Missing credential');
      const response = await fetch(`${apiBase}/auth/google`, {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, nonce }), signal: controller.signal,
      });
      if (!response.ok) throw new Error('Verification failed');
      const verified: unknown = await response.json();
      if (current !== attempt.current) return;
      setAuthSession(verified);
      googleButton.current?.replaceChildren();
      setMessage('로그인되었어요.');
      setPhase('idle');
    } catch {
      if (current !== attempt.current) return;
      googleButton.current?.replaceChildren();
      setPhase('error');
      setMessage('로그인하지 못했어요. 다시 시도해 주세요.');
    } finally {
      clearTimeout(timeout);
    }
  }

  function logout() {
    attempt.current += 1;
    request.current?.abort();
    clearAuthSession();
    // Local logout always succeeds, including when GIS is unavailable.
    try { googleIdentity()?.disableAutoSelect(); } catch { /* Session is already cleared. */ }
    googleButton.current?.replaceChildren();
    setPhase('idle');
    setMessage('로그아웃되었어요.');
  }

  const busy = phase === 'loading' || phase === 'verifying';
  const pending = !apiBase || phase === 'pending';
  return <section className={`google-account ${className}`} aria-labelledby={titleId}>
    <div className="google-account-heading">
      <UserRound size={16} aria-hidden="true" />
      <h2 id={titleId}>계정</h2>
      {session && <span className="google-account-connected"><Check size={12} aria-hidden="true" />로그인됨</span>}
    </div>

    <div className="google-account-actions" aria-busy={busy}>
      {session ? <button type="button" className="google-account-button" onClick={logout}>
        <LogOut size={14} aria-hidden="true" />로그아웃
      </button> : <>
        {phase !== 'ready' && <span className="google-account-login" title={pending ? '로그인 연결 준비 중' : undefined}>
          <button type="button" className="google-account-button" disabled={pending || busy} onClick={() => void startLogin()}>
            {busy && <LoaderCircle className="google-account-spinner" size={14} aria-hidden="true" />}
            {phase === 'loading' ? '로그인 준비 중…' : phase === 'verifying' ? '로그인 확인 중…' : phase === 'error' ? '다시 시도' : 'Google로 로그인'}
          </button>
        </span>}
        {phase === 'pending' && <button type="button" className="google-account-retry" onClick={() => void startLogin()}>연결 다시 확인</button>}
        <div ref={googleButton} className="google-account-provider" hidden={phase !== 'ready'} />
        {phase === 'ready' && <button type="button" className="google-account-retry" onClick={() => void startLogin()}>로그인 버튼 다시 불러오기</button>}
      </>}
    </div>
    <p className="google-account-privacy">이메일·이름은 저장하지 않아요. <a href="/privacy.html" target="_blank" rel="noopener noreferrer">개인정보 안내</a></p>
    <p className="google-account-message" role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">{message || (phase === 'ready' ? 'Google 버튼을 눌러 로그인해 주세요.' : '')}</p>
  </section>;
}

export default GoogleAccount;
