import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert, LoaderCircle, LogOut, RotateCcw, Upload, UserRound, X } from 'lucide-react';
import { clearAuthSession, getAuthSession, setAuthSession, subscribeAuthSession } from '../lib/auth';
import type { CloudStatus } from '../lib/cloudLibrary';
import './google-account.css';
import AccountSummary from './AccountSummary';

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
function renderGoogleButton(host: HTMLElement, signal: AbortSignal, render: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer:ReturnType<typeof setTimeout>;
    let settled=false;
    let domSince=0,frameSince=0;
    let lastFrameBox="";
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);observer.disconnect();signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish(new Error('Google button cancelled'));
    // GIS may hand a temporary DOM button over to an iframe. Observe stable
    // layout without requiring iframe load, which DOM-only clients never emit.
    const check=()=>{
      clearTimeout(timer);
      if(settled)return;
      const nodes=[...host.querySelectorAll<HTMLElement>('[role="button"],iframe')];
      const visible=nodes.filter(node=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&getComputedStyle(node).display!=='none';});
      const frame=visible.find(node=>node instanceof HTMLIFrameElement&&node.src&&node.src!=='about:blank');
      const now=performance.now();
      if(frame){
        const box=frame.getBoundingClientRect(),signature=[box.x,box.y,box.width,box.height].join(':');
        if(signature!==lastFrameBox){lastFrameBox=signature;frameSince=now;}
        if(now-frameSince>=150){finish();return;}
      }else{
        frameSince=0;lastFrameBox='';
        // GIS briefly exposes a DOM fallback before replacing it with its
        // iframe. Keep that handoff hidden; DOM-only implementations still work.
        if(visible.some(node=>node.getAttribute('role')==='button')){
          if(!domSince)domSince=now;
          if(now-domSince>=700){finish();return;}
        }else domSince=0;
      }
      timer=setTimeout(check,75);
    };
    const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(check,100);});
    observer.observe(host,{childList:true,subtree:true,attributes:true});
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){abort();return;}
    try{render();timer=setTimeout(check,100);}catch{finish(new Error('Google button unavailable'));}
  });
}

type Phase = 'idle' | 'loading' | 'ready' | 'verifying' | 'pending' | 'error';

/** Standalone account section for the main drawer. No library access is gated. */
export function GoogleAccount({ className = '', disabled = false, compact=false, syncStatus, onSyncRetry, onImportGuest }: {
  className?: string;
  disabled?: boolean;
  compact?: boolean;
  syncStatus?: CloudStatus;
  /** Reloads API metadata only; historical prop name retained for App integration. */
  onSyncRetry?: () => void | Promise<unknown>;
  onImportGuest?: () => Promise<void>;
}) {
  const titleId = useId();
  const googleButton = useRef<HTMLDivElement>(null);
  const loginDialog = useRef<HTMLDialogElement>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const attempt = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [session, updateSession] = useState(getAuthSession);
  const hadSession = useRef(Boolean(session));
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [reloadBusy, setReloadBusy] = useState(false);
  const [reloadError, setReloadError] = useState('');
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (!loginOpen) return;
    const dialog = loginDialog.current;
    dialog?.showModal();
    void startLogin();
    return () => {
      attempt.current += 1;
      request.current?.abort();
      dialog?.close();
    };
  }, [loginOpen]);

  function closeLogin() {
    attempt.current += 1;
    request.current?.abort();
    setLoginOpen(false);
    setPhase('idle');
    setMessage('');
  }

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
    if (disabledRef.current) return;
    if (!apiBase) { setPhase('pending'); setMessage('로그인 연결을 준비 중이에요.'); return; }
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
      if (current !== attempt.current) return;
      if (controller.signal.aborted) throw new Error('Login timeout');
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
      let buttonReady = false;
      identity.initialize({
        client_id: config.clientId,
        nonce,
        auto_select: false,
        button_auto_select: false,
        ux_mode: 'popup',
        callback: response => {
          if (current !== attempt.current || controller.signal.aborted || !buttonReady || credentialUsed) return;
          if (disabledRef.current) {
            setPhase('error');setMessage('저장을 마친 뒤 다시 로그인해 주세요.');return;
          }
          credentialUsed = true;
          void verifyCredential(response.credential, nonce, current);
        },
      });
      if (!googleButton.current) return;
      // Measure the laid-out host, not a hidden element or the wider modal.
      const buttonWidth = Math.floor(googleButton.current.getBoundingClientRect().width);
      const renderHost = document.createElement('div');
      googleButton.current.replaceChildren(renderHost);
      await renderGoogleButton(renderHost, controller.signal, () => identity.renderButton(renderHost, {
        type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', locale: 'ko',
        width: Math.max(1, buttonWidth),
      }));
      if (current !== attempt.current || controller.signal.aborted) return;
      buttonReady = true;
      setPhase('ready');
    } catch {
      if (current !== attempt.current) return;
      attempt.current += 1;
      controller.abort();
      googleButton.current?.replaceChildren();
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
      if (disabledRef.current) throw new Error('Local save in progress');
      setLoginOpen(false);
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
    if (disabledRef.current || importBusy) return;
    attempt.current += 1;
    request.current?.abort();
    clearAuthSession();
    // Local logout always succeeds, including when GIS is unavailable.
    try { googleIdentity()?.disableAutoSelect(); } catch { /* Session is already cleared. */ }
    googleButton.current?.replaceChildren();
    setPhase('idle');
    setMessage('로그아웃되었어요.');
  }

  async function importGuest() {
    if (!onImportGuest || disabledRef.current || importBusy) return;
    setImportBusy(true);setImportError('');
    try { await onImportGuest(); }
    catch (error) { setImportError(error instanceof Error ? error.message : '책을 가져오지 못했어요. 다시 시도해 주세요.'); }
    finally { setImportBusy(false); }
  }

  async function reloadLibrary() {
    if (!onSyncRetry || reloadBusy || importBusy || syncStatus?.phase === 'loading' || syncStatus?.phase === 'saving') return;
    setReloadBusy(true);setReloadError('');
    try { await onSyncRetry(); }
    catch(error) { setReloadError(error instanceof Error ? error.message : '서재 목록을 불러오지 못했어요.'); }
    finally { setReloadBusy(false); }
  }

  const busy = phase === 'loading' || phase === 'verifying';
  return <section className={`google-account ${className}`} aria-labelledby={titleId}>
    <h2 id={titleId} className={compact?'sr-only':'google-account-label'}>계정</h2>
    {compact?<AccountSummary connected={!!session} disabled={disabled||importBusy} onLogout={logout}/>:<div className="google-account-heading">
      <span className="google-account-avatar"><UserRound size={19} aria-hidden="true" /></span>
      <div className="google-account-identity"><strong>{session?'Google 계정':'게스트'}</strong><span>{session?'텍스트 · 클라우드 보관':'이 브라우저에 보관'}</span></div>
      {session && <button type="button" className="icon-btn google-account-logout" aria-label="로그아웃" title="로그아웃" disabled={disabled||importBusy} onClick={logout}><LogOut size={16} aria-hidden="true"/></button>}
    </div>}

    <div className="google-account-actions" aria-busy={busy}>
      {!session&&<button type="button" className="google-account-button" disabled={disabled} onClick={()=>setLoginOpen(true)}>로그인</button>}
    </div>
    {loginOpen&&createPortal(<dialog ref={loginDialog} className="modal google-login-modal" aria-label="로그인" onCancel={event=>{event.preventDefault();closeLogin();}} onClick={event=>{if(event.target===event.currentTarget)closeLogin();}}>
      <div className="modal-header"><h2>로그인</h2><button type="button" className="icon-btn" aria-label="닫기" onClick={closeLogin}><X size={19}/></button></div>
      <div className="google-login-slot" aria-busy={busy}>
        {(phase==='idle'||busy)&&<div className="google-login-progress" role="status"><LoaderCircle size={20} className="google-account-spinner"/><span>{phase==='verifying'?'로그인 확인 중…':'연결 중…'}</span></div>}
        <div ref={googleButton} className="google-account-provider" data-ready={phase==='ready'} aria-hidden={phase!=='ready'} inert={disabled||phase!=='ready'}/>
        {(phase==='error'||phase==='pending')&&<button type="button" className="google-account-button" disabled={disabled} onClick={()=>void startLogin()}>다시 시도</button>}
      </div>
      <p className="google-account-message" role={phase==='error'?'alert':'status'} aria-live="polite">{message}</p>
    </dialog>,document.body)}
    {session&&!compact ? <div className="google-account-library">
      {syncStatus && <p className="google-account-library-status" role="status" aria-live="polite">{syncStatus.phase==='error'?<CircleAlert size={12} aria-hidden="true"/>:syncStatus.phase==='loading'||syncStatus.phase==='saving'?<LoaderCircle size={12} className="google-account-spinner" aria-hidden="true"/>:<Check size={12} aria-hidden="true"/>}{syncStatus.message}</p>}
      {onSyncRetry && <button type="button" className="google-account-row" disabled={(disabled&&syncStatus?.phase!=='error')||importBusy||reloadBusy||syncStatus?.phase==='loading'||syncStatus?.phase==='saving'} onClick={()=>void reloadLibrary()}><RotateCcw size={15} className={reloadBusy?'google-account-spinner':undefined}/>{reloadBusy?'불러오는 중…':'목록 새로고침'}</button>}
      {onImportGuest && <div className="google-account-guest-import">
        <button type="button" className="google-account-row" title="게스트 서재의 책을 이 계정에 복사" disabled={disabled||importBusy} onClick={()=>void importGuest()}>{importBusy?<LoaderCircle className="google-account-spinner" size={15} aria-hidden="true"/>:<Upload size={15} aria-hidden="true"/>}이 기기 책 가져오기</button>
      </div>}
      {importError && <p className="google-account-message" role="alert">{importError}</p>}
      {reloadError && <p className="google-account-message" role="alert">{reloadError}</p>}
    </div> : null}
    {!loginOpen&&(!compact||!session)&&<p className="google-account-message" role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">{message}</p>}
  </section>;
}

export default GoogleAccount;
