import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Check,Copy,Download,Image,Link,LoaderCircle,RotateCcw,Unlink,X} from 'lucide-react';
import type {Book} from '../lib/library';
import {getAuthSession} from '../lib/auth';
import {cardHtml,downloadBlob,makeShareCard,shareRequest,shareUrl,uploadShareCard,uploadBookShareAssets,usedShareAssets,type ShareInfo} from '../lib/sharing';
import './share-dialog.css';
export default function ShareDialog({book,onClose,onLogin}:{book:Book;onClose:()=>void;onLogin:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),title=useId();
 const [mode,setMode]=useState<'url'|'card'>('url'),[share,setShare]=useState<ShareInfo|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(!!getAuthSession()),[error,setError]=useState(''),[notice,setNotice]=useState(''),[imageUrl,setImageUrl]=useState('');
 const [includeImages,setIncludeImages]=useState(true);
 const [card,setCard]=useState<Blob>(),[preview,setPreview]=useState('');const alive=useRef(true);
 const session=getAuthSession();
 const imageCount=useMemo(()=>usedShareAssets(book).length,[book]);
 useEffect(()=>{alive.current=true;const element=dialog.current!;element.showModal();return()=>{alive.current=false;element.close();};},[]);
 useEffect(()=>{if(!session)return;const controller=new AbortController();void shareRequest(book.id,'GET',controller.signal).then(value=>{if(!controller.signal.aborted){setShare(value);if(value?.cardUrl)setImageUrl(value.cardUrl);}}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'공유를 확인하지 못했어요.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[book.id,session?.user.id]);
 useEffect(()=>{if(!card)return;const url=URL.createObjectURL(card);setPreview(url);return()=>URL.revokeObjectURL(url);},[card]);
 useEffect(()=>{if(mode!=='card'||card)return;let active=true;void makeShareCard(book).then(value=>{if(active)setCard(value);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'카드를 만들지 못했어요.');});return()=>{active=false;};},[mode,book,card]);
 async function change(method:'POST'|'DELETE'){
  if(busy||loading)return;setBusy(true);setError('');setNotice('');
  try{if(method==='POST'&&includeImages&&imageCount>40)throw new Error('공유 이미지는 한 권에 40개까지 넣을 수 있어요.');const value=await shareRequest(book.id,method,undefined,book);if(!alive.current)return;setShare(value);if(method==='DELETE')setImageUrl('');if(method==='POST'&&includeImages&&imageCount){await uploadBookShareAssets(book,(done,total)=>{if(alive.current)setNotice(`이미지 ${done}/${total} 업로드 중…`);});}if(alive.current)setNotice(method==='DELETE'?'공유를 종료했어요.':'공유 링크가 준비됐어요.');}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'공유하지 못했어요.');}finally{if(alive.current)setBusy(false);}
 }
 async function copy(value:string){try{await navigator.clipboard.writeText(value);if(alive.current)setNotice('복사했어요.');}catch{if(alive.current)setError('복사 권한이 없어요. 아래 내용을 직접 복사해 주세요.');}}
 async function hostCard(){if(!card||busy||!share)return;setBusy(true);setError('');try{const hosted=await uploadShareCard(book,card);if(alive.current){setImageUrl(hosted);setNotice('카드를 업로드했어요. HTML을 복사해 붙여 넣으세요.');}}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'카드를 올리지 못했어요.');}finally{if(alive.current)setBusy(false);}}
 const url=share?shareUrl(share.id):'';
 let html='';try{if(url&&imageUrl.trim())html=cardHtml(book,url,imageUrl.trim());}catch{/* Input is validated before enabling copy. */}
 return <dialog ref={dialog} className="modal share-dialog" aria-labelledby={title} onCancel={event=>{event.preventDefault();if(event.target===event.currentTarget&&!busy)onClose();}}>
  <div className="modal-header"><h2 id={title}>공유</h2><button className="icon-btn" aria-label="닫기" disabled={busy} onClick={onClose}><X size={20}/></button></div>
  <p className="share-book-title">{book.title}</p>
  <div role="tablist" aria-label="공유 방식" className="share-tabs">{([{id:'url',label:'URL로 공유',icon:Link},{id:'card',label:'카드로 공유',icon:Image}] as const).map(item=><button type="button" key={item.id} role="tab" id={`${title}-${item.id}`} aria-controls={`${title}-panel`} aria-selected={mode===item.id} onClick={()=>{setMode(item.id);setNotice('');}}><item.icon size={17}/>{item.label}</button>)}</div>
  <div id={`${title}-panel`} role="tabpanel" aria-labelledby={`${title}-${mode}`}>
   {session&&imageCount>0&&<label className="share-images-option"><input type="checkbox" checked={includeImages} disabled={busy} onChange={event=>setIncludeImages(event.target.checked)}/>사용한 이미지 포함 · {imageCount}개</label>}
   {!session?<div className="share-login"><p>공유하려면 로그인 후 책을 계정 서재에 저장해 주세요.</p><button className="primary-btn" onClick={onLogin}>Google로 로그인</button></div>:<>
    {loading?<p className="share-status" role="status"><LoaderCircle size={16} className="animate-spin"/>공유 확인 중…</p>:!share?<div className="share-create"><p>이 권을 링크를 아는 사람에게 공개해요.</p><button className="primary-btn" disabled={busy} onClick={()=>void change('POST')}>{busy?<LoaderCircle size={16} className="animate-spin"/>:<Link size={16}/>}공유 링크 만들기</button></div>:<>
      <label className="field">공유 링크<div className="share-url"><input readOnly value={url} onFocus={event=>event.currentTarget.select()}/><button className="icon-btn" aria-label="링크 복사" title="링크 복사" disabled={busy} onClick={()=>void copy(url)}><Copy size={17}/></button></div></label>
      <div className="share-manage"><button title="현재 책의 텍스트로 갱신" disabled={busy} onClick={()=>void change('POST')}><RotateCcw size={14}/>공유 내용 갱신</button><button title="기존 링크의 읽기 권한 종료" disabled={busy} onClick={()=>void change('DELETE')}><Unlink size={14}/>공유 종료</button></div>
    </>}
   </>}
   {mode==='card'&&<div className="share-card">
    {preview?<img src={preview} alt={`${book.title} 공유 카드`}/>:<div className="share-card-loading" role="status"><LoaderCircle size={20} className="animate-spin"/></div>}
    <button className="secondary-btn" disabled={!card} onClick={()=>{if(card)downloadBlob(card,`${book.title.replace(/[\\/:*?"<>|]/g,'-')}-공유카드.png`);}}><Download size={15}/>카드 이미지 저장</button>
    <p className="share-hint">HTML 복사를 사용하면 카드를 따로 첨부할 필요 없어요.</p>{url&&<button className="secondary-btn" disabled={!card||busy} onClick={()=>void hostCard()}>{busy?<LoaderCircle size={15} className="animate-spin"/>:<Image size={15}/>}카드 업로드</button>}{html&&<button className="primary-btn" disabled={busy} onClick={()=>void copy(html)}><Copy size={15}/>HTML 복사</button>}
    {url&&<details className="share-html"><summary>HTML 직접 복사 · 이미지 주소 변경</summary><label className="field">첨부한 카드 이미지 주소<input type="url" placeholder="https://…" value={imageUrl} onChange={event=>setImageUrl(event.target.value)}/></label><textarea aria-label="공유 카드 HTML" readOnly value={html||'이미지 주소를 입력하면 링크가 포함된 HTML이 만들어져요.'} onFocus={event=>event.currentTarget.select()}/><button className="secondary-btn" disabled={!html} onClick={()=>void copy(html)}><Copy size={15}/>HTML 복사</button></details>}
   </div>}
  </div>
  <p className="share-hint" title="공유 생성·갱신과 카드 업로드는 계정별 1분에 1회, 하루 30회까지 가능해요. 이미지 원본은 브라우저에 유지하고 공유용 사본만 올려요.">이미지당 2MB · 한 권 10MB · 공유는 1분 간격</p>
  <p className="share-hint">7일 동안 책을 열지 않으면 공유가 만료되고 공유 이미지가 삭제돼요.</p>
  {error&&<p className="error-message" role="alert">{error}</p>}{notice&&<p className="share-status" role="status"><Check size={14}/>{notice}</p>}
 </dialog>;
}
