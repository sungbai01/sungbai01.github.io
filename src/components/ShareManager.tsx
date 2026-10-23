import type {ShareCardPreview} from '../../shared/shareCard';
import ManagedSharePreview from './ManagedSharePreview';
import {useEffect,useRef,useState} from 'react';
import {Copy,Link,LoaderCircle,RotateCcw,Trash2,X,Eye,Code2} from 'lucide-react';
import {getAuthSession} from '../lib/auth';
import {cardHtml,shareUrl,SHARES_CHANGED} from '../lib/sharing';
import './share-manager.css';
import Toast from './Toast';
import {useToast} from '../lib/useToast';
type Entry={id:string;bookId:string;title:string;createdAt:number;expiresAt:number;status:'active'|'expired';views?:number;card?:ShareCardPreview};
const apiBase=(import.meta.env.VITE_AUTH_API_URL as string|undefined)?.trim().replace(/\/+$/,'');
async function request(path:string,method='GET',signal?:AbortSignal){
 const session=getAuthSession();if(!session||!apiBase)throw new Error('다시 로그인해 주세요.');
 const response=await fetch(`${apiBase}/library/shares${path}`,{method,credentials:'omit',cache:'no-store',signal,headers:{Authorization:`Bearer ${session.token}`}});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'공유 목록을 불러오지 못했어요.');if(getAuthSession()?.user.id!==session.user.id)throw new Error('계정이 변경되었어요.');return result as {shares:Entry[];nextCursor:number|null;imageBytes:number;imageLimit:number;urlLimit:number};
}
function remaining(until:number,now:number){const minutes=Math.max(0,Math.ceil((until-now)/60000));return minutes>=1440?`${Math.floor(minutes/1440)}일 ${Math.floor(minutes%1440/60)}시간 남음`:minutes>=60?`${Math.floor(minutes/60)}시간 ${minutes%60}분 남음`:`${minutes}분 남음`;}
export default function ShareManager({onClose}:{onClose:()=>void}){
 const {toast,notify,dismiss}=useToast();
 const [manualCopy,setManualCopy]=useState('');
 const [preview,setPreview]=useState(''),[imageBytes,setImageBytes]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true);const [entries,setEntries]=useState<Entry[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[removing,setRemoving]=useState(''),[confirm,setConfirm]=useState(''),[cursor,setCursor]=useState<number|null>(null),[attempt,setAttempt]=useState(0),[now,setNow]=useState(Date.now);
 useEffect(()=>{alive.current=true;const element=dialog.current!;element.showModal();const timer=setInterval(()=>setNow(Date.now()),30000);return()=>{alive.current=false;clearInterval(timer);element.close();};},[]);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');void request('', 'GET',controller.signal).then(result=>{if(!controller.signal.aborted){setEntries(result.shares);setCursor(result.nextCursor);setImageBytes(result.imageBytes??0);}}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'불러오지 못했어요.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[attempt]);
 async function more(){if(cursor===null||loading)return;setLoading(true);try{const result=await request(`?cursor=${cursor}`);if(alive.current){setEntries(previous=>[...previous,...result.shares]);setCursor(result.nextCursor);}}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'불러오지 못했어요.');}finally{if(alive.current)setLoading(false);}}
 async function remove(id:string){if(removing)return;setRemoving(id);setError('');try{await request(`/${id}`,'DELETE');window.dispatchEvent(new Event(SHARES_CHANGED));if(alive.current){setEntries(previous=>previous.filter(entry=>entry.id!==id));setConfirm('');setNotice('공유를 삭제했어요. 이미지는 정리 작업에서 삭제돼요.');}}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'삭제하지 못했어요.');}finally{if(alive.current)setRemoving('');}}
 async function copy(entry:Entry,html=false){
  let value=shareUrl(entry.id);
  try{
   if(html){if(!entry.card)throw new Error('공유 카드 설정이 없어요.');value=cardHtml({...entry.card,id:entry.bookId,description:'',createdAt:'',updatedAt:'',messages:[]},value,entry.card.backgroundUrl??'',entry.card);}
   if(html&&navigator.clipboard.write&&typeof ClipboardItem!=='undefined')await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([value],{type:'text/html'}),'text/plain':new Blob([value],{type:'text/plain'})})]);else await navigator.clipboard.writeText(value);
   if(alive.current){setManualCopy('');notify(html?'HTML을 복사했어요.':'링크를 복사했어요.','success');}
  }catch(cause){if(alive.current){setManualCopy(value);notify(cause instanceof Error?cause.message:'직접 복사해 주세요.','error',0);}}
 }

 return <dialog ref={dialog} className="modal share-manager" aria-label="공유 URL 관리" onCancel={event=>{event.preventDefault();if(event.target===event.currentTarget&&!removing)onClose();}}>
  <header className="modal-header"><h2>공유 URL 관리</h2><div className="share-manager-actions"><button className="icon-btn" title="새로고침" aria-label="공유 목록 새로고침" disabled={loading||!!removing} onClick={()=>setAttempt(value=>value+1)}><RotateCcw size={17}/></button><button className="icon-btn" aria-label="닫기" disabled={!!removing} onClick={onClose}><X size={20}/></button></div></header>
  {loading&&!entries.length?<p className="share-manager-status" role="status"><LoaderCircle size={18} className="animate-spin"/>불러오는 중…</p>:!entries.length?<p className="share-manager-status">공유한 책이 없어요.</p>:<ul className="share-manager-list">{entries.map(entry=>{const expired=entry.status==='expired'||entry.expiresAt<=now;return <li key={entry.id}><div className="share-manager-item"><Link size={17}/><div><strong>{entry.title||'제목 없는 책'}</strong><small data-expired={expired}>{expired?'만료됨':remaining(entry.expiresAt,now)}</small><small className="share-view-count" title="공유 책 열람 횟수">조회 {(entry.views??0).toLocaleString('ko-KR')}회</small><time title={expired?'만료일':'만료 예정일'}>{new Date(entry.expiresAt).toLocaleString('ko-KR')}</time></div>{!expired&&entry.card&&<button className="icon-btn" aria-label={`${entry.title} 카드 미리보기`} title="카드 미리보기" aria-expanded={preview===entry.id} onClick={()=>setPreview(preview===entry.id?'':entry.id)}><Eye size={16}/></button>}<button className="icon-btn" aria-label={`${entry.title} 링크 복사`} title="링크 복사" disabled={expired||!!removing} onClick={()=>void copy(entry)}><Copy size={16}/></button><button className="icon-btn" aria-label={`${entry.title} HTML 복사`} title="HTML 복사" disabled={expired||!!removing||!entry.card} onClick={()=>void copy(entry,true)}><Code2 size={16}/></button><button className="icon-btn" aria-label={`${entry.title} 공유 삭제`} title="공유 삭제" disabled={!!removing} onClick={()=>setConfirm(confirm===entry.id?'':entry.id)}>{removing===entry.id?<LoaderCircle size={16} className="animate-spin"/>:<Trash2 size={16}/>}</button></div>{!expired&&preview===entry.id&&(entry.card?<ManagedSharePreview card={entry.card} bookId={entry.bookId} onClose={()=>setPreview('')}/>:null)}{!expired&&<input className="share-manager-url" readOnly aria-label={`${entry.title} 공유 주소`} value={shareUrl(entry.id)} onFocus={event=>event.currentTarget.select()}/ >}{confirm===entry.id&&<div className="share-manager-confirm"><span>{expired?'만료 이력을 삭제할까요?':'공유 링크를 삭제할까요?'}</span><button disabled={!!removing} onClick={()=>setConfirm('')}>취소</button><button disabled={!!removing} onClick={()=>void remove(entry.id)}>삭제</button></div>}</li>;})}</ul>}
  {cursor!==null&&<button className="secondary-btn" disabled={loading} onClick={()=>void more()}>더 보기</button>}
  <p className="share-manager-note">공유 URL 최대 10개 · 공유 이미지 {(imageBytes/1000000).toFixed(1)} / 100MB<br/>마지막 열람 후 7일 동안 유효해요.</p>{error&&<p className="error-message" role="alert">{error}</p>}{notice&&<p className="share-manager-note" role="status">{notice}</p>}
  <Toast key={toast.id} message={toast.message} tone={toast.tone} duration={toast.duration} onDismiss={dismiss}>{manualCopy&&<textarea aria-label="직접 복사할 공유 내용" readOnly value={manualCopy} onFocus={event=>event.currentTarget.select()}/>}</Toast>
 </dialog>;
}
