import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Check,Copy,Download,Image,Images,Link,LoaderCircle,RotateCcw,Unlink,X,Quote} from 'lucide-react';
import type {Book} from '../lib/library';
import {getAuthSession} from '../lib/auth';
import {cardHtml,downloadBlob,makeShareCard,shareRequest,shareUrl,uploadShareCard,uploadBookShareAssets,usedShareAssets,type ShareInfo} from '../lib/sharing';
import './share-dialog.css';
export default function ShareDialog({book:sourceBook,loadBook,onClose,onLogin,onManageAssets,quote='',onSelectQuote,onClearQuote,initialMode='url'}:{quote?:string;onSelectQuote?:()=>void;onClearQuote?:()=>void;initialMode?:'url'|'card';book:Book;loadBook?:(book:Book)=>Promise<Book>;onClose:()=>void;onLogin:()=>void;onManageAssets?:()=>void}){
 const [book,setBook]=useState(sourceBook),[bookPending,setBookPending]=useState(!!loadBook),[bookError,setBookError]=useState('');
 useEffect(()=>{let active=true;setBook(sourceBook);setBookPending(!!loadBook);setBookError('');if(loadBook)void loadBook(sourceBook).then(value=>{if(active)setBook(value);}).catch(()=>{if(active)setBookError('책을 불러오지 못했어요. 닫고 다시 열어 주세요.');}).finally(()=>{if(active)setBookPending(false);});return()=>{active=false;};},[sourceBook,loadBook]);
 const dialog=useRef<HTMLDialogElement>(null),title=useId();
 const [mode,setMode]=useState<'url'|'card'>(initialMode),[share,setShare]=useState<ShareInfo|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(!!getAuthSession()),[error,setError]=useState(''),[notice,setNotice]=useState(''),[imageUrl,setImageUrl]=useState('');
 const [includeImages,setIncludeImages]=useState(true);
 const [card,setCard]=useState<Blob>(),[preview,setPreview]=useState('');const alive=useRef(true);
 const session=getAuthSession();
 const imageCount=useMemo(()=>usedShareAssets(book).length,[book]);
 useEffect(()=>{alive.current=true;const element=dialog.current!;element.showModal();return()=>{alive.current=false;element.close();};},[]);
 useEffect(()=>{if(!session)return;const controller=new AbortController();void shareRequest(book.id,'GET',controller.signal).then(value=>{if(!controller.signal.aborted){setShare(value);}}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'공유를 확인하지 못했어요.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[book.id,session?.user.id]);
 useEffect(()=>{setCard(undefined);setPreview('');setImageUrl('');},[book,quote]);
 useEffect(()=>{if(!card)return;const url=URL.createObjectURL(card);setPreview(url);return()=>URL.revokeObjectURL(url);},[card]);
 useEffect(()=>{if(bookPending||bookError)return;setCard(undefined);setPreview('');setImageUrl('');let active=true;void makeShareCard(book,quote).then(value=>{if(active)setCard(value);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'카드를 만들지 못했어요.');});return()=>{active=false;};},[book,quote,bookPending,bookError]);
 async function change(method:'POST'|'DELETE'){
  if(busy||loading||bookPending||bookError)return;setBusy(true);setError('');setNotice('');
  try{if(method==='POST'&&includeImages&&imageCount>40)throw new Error('공유 이미지는 한 권에 40개까지 넣을 수 있어요.');const value=await shareRequest(book.id,method,undefined,book);if(!alive.current)return;setShare(value);if(method==='DELETE')setImageUrl('');if(method==='POST'&&imageCount){await uploadBookShareAssets(book,(done,total)=>{if(alive.current)setNotice(`이미지 ${done}/${total} 업로드 중…`);},includeImages);}if(alive.current)setNotice(method==='DELETE'?'공유를 종료했어요.':'공유 링크가 준비됐어요.');}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'공유하지 못했어요.');}finally{if(alive.current)setBusy(false);}
 }
 async function copy(value:string){try{await navigator.clipboard.writeText(value);if(alive.current)setNotice('복사했어요.');}catch{if(alive.current)setError('복사 권한이 없어요. 아래 내용을 직접 복사해 주세요.');}}
 async function hostCard(){if(!card||busy||!share)return;setBusy(true);setError('');try{const hosted=await uploadShareCard(book,card);if(alive.current){setImageUrl(hosted);await copy(cardHtml(book,shareUrl(share.id),hosted));}}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'카드를 올리지 못했어요.');}finally{if(alive.current)setBusy(false);}}
 const url=share?shareUrl(share.id):'';
 let html='';try{if(url&&imageUrl.trim())html=cardHtml(book,url,imageUrl.trim());}catch{/* Input is validated before enabling copy. */}
 const artwork=book.assets?.find(asset=>asset.id===book.shareCardAssetId)?.src??book.characterIcon;
 const locked=busy||loading||bookPending||!!bookError;
 return <dialog ref={dialog} className="share-ticket-dialog" aria-labelledby={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <h2 id={title} className="sr-only">책 공유</h2>
  <div className="share-ticket-workspace">
   <article className="share-interactive-ticket" style={{backgroundColor:book.color}}>
    {artwork&&<img className="share-ticket-artwork" src={artwork} alt=""/>}
    <div className="share-ticket-body"><small>GALPI / A STORY TO KEEP</small><h3>{book.title}</h3>
     <button className="share-ticket-quote" disabled={busy||bookPending||!!bookError||!onSelectQuote} onClick={onSelectQuote} title="책 페이지에서 대사 선택"><Quote size={18}/><span>{quote||'대사 선택'}</span></button>
     {quote&&<button className="share-ticket-clear" disabled={busy} onClick={onClearQuote} title="대사 제거" aria-label="대사 제거"><X size={14}/></button>}
     <span className="share-ticket-author">{book.author||'저자 모델 미상'}</span>
     {onManageAssets&&<button className="share-ticket-art" disabled={busy} onClick={onManageAssets} title="공유 카드 이미지 선택" aria-label="공유 카드 이미지 선택"><Images size={18}/></button>}
    </div>
    <div className="share-ticket-stub"><span className="share-ticket-volume">{String(book.volumeNumber??1).padStart(2,'0')}</span>
     <div className="share-ticket-modes" role="group" aria-label="공유 방식"><button aria-label="URL로 공유" title="URL로 공유" aria-pressed={mode==='url'} onClick={()=>setMode('url')}><Link size={19}/></button><button aria-label="카드로 공유" title="카드로 공유" aria-pressed={mode==='card'} onClick={()=>setMode('card')}><Image size={19}/></button></div>
     {session?<button className="share-ticket-primary" disabled={locked} onClick={()=>share?void copy(url):void change('POST')} title={share?'공유 링크 복사':'링크를 아는 사람에게 이 책 공개'}>{locked?<LoaderCircle className="animate-spin" size={18}/>:share?<Copy size={18}/>:<Link size={18}/>}<span>{share?'링크 복사':'공유 만들기'}</span></button>:<button className="share-ticket-primary" onClick={onLogin}>로그인</button>}
     {session&&imageCount>0&&<label className="share-ticket-images" title="사용한 이미지 포함"><input type="checkbox" checked={includeImages} disabled={locked} onChange={event=>setIncludeImages(event.target.checked)}/>이미지 {imageCount}</label>}
     <small title="7일 동안 열람하지 않으면 공유와 공유 이미지가 만료됩니다. 이미지당 2MB, 한 권 50MB, 공유는 1분 간격입니다.">7 DAYS</small>
    </div>
   </article>
   <nav className="share-ticket-tools" aria-label="공유 도구">
    <button aria-label="닫기" title="닫기" disabled={busy} onClick={onClose}><X size={20}/></button>
    {mode==='card'&&<><button aria-label="카드 이미지 저장" title="카드 이미지 저장" disabled={!card||bookPending} onClick={()=>{if(card)downloadBlob(card,'갈피-공유카드.png');}}><Download size={20}/></button><button aria-label="카드 HTML 복사" title="카드 HTML 복사 · 공유 이미지 업로드" disabled={!card||!share||locked} onClick={()=>{if(html)void copy(html);else void hostCard();}}>{busy?<LoaderCircle className="animate-spin" size={20}/>:<Copy size={20}/>}</button></>}
    {share&&<><button aria-label="공유 내용 갱신" title="공유 내용 갱신" disabled={locked} onClick={()=>void change('POST')}><RotateCcw size={20}/></button><button aria-label="공유 종료" title="공유 종료" disabled={locked} onClick={()=>void change('DELETE')}><Unlink size={20}/></button></>}
   </nav>
  </div>
  {mode==='card'&&preview&&<details className="share-ticket-preview"><summary>저장될 카드 미리보기</summary><img src={preview} alt="공유 카드 미리보기"/></details>}
  {url&&<input className="share-ticket-url" aria-label="공유 링크" readOnly value={url} onFocus={event=>event.currentTarget.select()}/>}
  {(error||bookError)&&<p className="share-ticket-message" role="alert">{bookError||error}</p>}{notice&&<p className="share-ticket-message" role="status"><Check size={14}/>{notice}</p>}
 </dialog>;
}
