import {useEffect,useId,useRef,useState} from 'react';
import {Download,Images,LoaderCircle,X,Share2,Link,Code2} from 'lucide-react';
import type {Book} from '../lib/library';
import {getAuthSession} from '../lib/auth';
import {cardHtml,downloadBlob,makeShareCard,shareRequest,shareUrl,uploadShareCard,uploadBookShareAssets,usedShareAssets,type ShareInfo} from '../lib/sharing';
import Toast from './Toast';
import {useToast} from '../lib/useToast';
import './share-dialog.css';
export default function ShareDialog({book:sourceBook,loadBook,onClose,onManageAssets,quote='',onSelectQuote}:{quote?:string;onSelectQuote?:()=>void;book:Book;loadBook?:(book:Book)=>Promise<Book>;onClose:()=>void;onManageAssets?:()=>void}){
 const [book,setBook]=useState(sourceBook),[bookPending,setBookPending]=useState(!!loadBook),[bookError,setBookError]=useState('');
 useEffect(()=>{let active=true;setBook(sourceBook);setBookPending(!!loadBook);setBookError('');if(loadBook)void loadBook(sourceBook).then(value=>{if(active)setBook(value);}).catch(()=>{if(active)setBookError('책을 불러오지 못했어요. 닫고 다시 열어 주세요.');}).finally(()=>{if(active)setBookPending(false);});return()=>{active=false;};},[sourceBook,loadBook]);
 const dialog=useRef<HTMLDialogElement>(null),title=useId();
 const [busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[manualCopy,setManualCopy]=useState('');
 const {toast,notify,dismiss}=useToast();
 const shareTools=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!bookError)return;notify(bookError,'error');},[bookError,notify]);
 useEffect(()=>{if(!expanded)return;const close=(event:PointerEvent)=>{if(!shareTools.current?.contains(event.target as Node))setExpanded(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[expanded]);
 const requestBusy=useRef(false),published=useRef<ShareInfo|null>(null),assetsUploaded=useRef(false),hostedCard=useRef('');
 const [card,setCard]=useState<Blob>(),[preview,setPreview]=useState('');const alive=useRef(true);
 useEffect(()=>{alive.current=true;const element=dialog.current!;element.showModal();return()=>{alive.current=false;element.close();};},[]);
 useEffect(()=>{setCard(undefined);setPreview('');hostedCard.current='';assetsUploaded.current=false;published.current=null;},[book,quote]);
 useEffect(()=>{if(!card)return;const url=URL.createObjectURL(card);setPreview(url);return()=>URL.revokeObjectURL(url);},[card]);
 useEffect(()=>{if(bookPending||bookError)return;setCard(undefined);setPreview('');hostedCard.current='';let active=true;void makeShareCard(book,quote).then(value=>{if(active)setCard(value);}).catch(cause=>{if(active)notify(cause instanceof Error?cause.message:'카드를 만들지 못했어요.','error');});return()=>{active=false;};},[book,quote,bookPending,bookError]);
 async function copy(value:string){try{await navigator.clipboard.writeText(value);if(alive.current){setManualCopy('');notify('복사했어요.','success');}}catch{if(alive.current){setManualCopy(value);notify('복사 권한이 없어요. 직접 복사해 주세요.','error',0);}}}
 async function shareCard(format:'url'|'html'){
  if(!card||requestBusy.current||bookPending||bookError)return;
  requestBusy.current=true;setBusy(true);setManualCopy('');notify('공유를 준비하고 있어요.','progress',0);
  try{
   if(!getAuthSession())throw new Error('공유는 로그인한 서재에서 이용할 수 있어요.');
   if(usedShareAssets(book).length>40)throw new Error('공유 이미지는 한 권에 40개까지 넣을 수 있어요.');
   let share=published.current;
   if(!share){share=await shareRequest(book.id,'GET')??await shareRequest(book.id,'POST',undefined,book);if(!share)throw new Error('공유 링크를 만들지 못했어요.');published.current=share;}
   if(!assetsUploaded.current){await uploadBookShareAssets(book,(done,total)=>{if(alive.current)notify(`이미지 ${done}/${total} 업로드 중…`,'progress',0);},true);assetsUploaded.current=true;}
   if(format==='html'&&!hostedCard.current)hostedCard.current=await uploadShareCard(book,card);
   if(alive.current)await copy(format==='url'?shareUrl(share.id):cardHtml(book,shareUrl(share.id),hostedCard.current));
  }catch(cause){if(alive.current)notify(cause instanceof Error?cause.message:'카드를 공유하지 못했어요.','error');}
  finally{requestBusy.current=false;if(alive.current)setBusy(false);}
 }
 const locked=busy||bookPending||!!bookError;
 return <dialog ref={dialog} className="share-ticket-dialog" aria-labelledby={title} onCancel={event=>{event.preventDefault();if(expanded)setExpanded(false);else if(!busy)onClose();}}>
  <h2 id={title} className="sr-only">책 공유</h2>
  <div className="share-ticket-workspace">
   <article className="share-interactive-ticket" aria-label="저장될 공유 카드">
    <h3 className="sr-only">{book.title}</h3>
    {preview?<img className="share-ticket-render" src={preview} alt={`${book.title} 공유 카드 미리보기`}/>:<div className="share-ticket-placeholder" style={{backgroundColor:book.color}} aria-busy="true"><div><small>GALPI / A STORY TO KEEP</small><strong>{book.title}</strong><span className="skeleton-fill"/></div><aside><small>갈피 / SHARED BOOK</small><strong>{String(book.volumeNumber??1).padStart(2,'0')}</strong><small>{book.author||'저자 모델 미상'}</small></aside></div>}
    {onSelectQuote&&<button className="share-ticket-quote-target" data-empty={!quote.trim()} aria-label="공유할 대사 선택" title="본문에서 드래그해 대사 선택 · 선택 없이도 공유 가능" disabled={locked} onClick={onSelectQuote}>{!quote.trim()&&<span>공유할 대사 선택<small>선택 사항</small></span>}</button>}
   </article>
   <nav className="share-ticket-tools" aria-label="공유 도구">
    <button className="share-ticket-close" aria-label="닫기" title="닫기" disabled={busy} onClick={onClose}><X size={20}/></button>
    {onManageAssets&&<button disabled={busy} onClick={onManageAssets} title="공유 카드 이미지 선택" aria-label="공유 카드 이미지 선택"><Images size={20}/></button>}
    <button aria-label="카드 이미지 저장" title="카드 이미지 저장" disabled={!card||locked} onClick={()=>{if(card)downloadBlob(card,`갈피-공유카드.${card.type==='image/webp'?'webp':'png'}`);}}><Download size={20}/></button>
    <div className="share-ticket-share" ref={shareTools}>
     <button aria-label="공유" title="공유" aria-expanded={expanded} aria-controls={`${title}-share-actions`} disabled={!card||locked||expanded} onClick={()=>setExpanded(true)}>{busy?<LoaderCircle className="animate-spin" size={20}/>:<Share2 size={20}/>}</button>
     {expanded&&<div className="share-ticket-actions" id={`${title}-share-actions`} role="group" aria-label="공유 형식">
      <button aria-label="URL로 공유" title="URL로 공유" disabled={locked} onClick={()=>void shareCard('url')}><Link size={18}/><span>URL로 공유</span></button>
      <button aria-label="HTML로 공유" title="HTML로 공유" disabled={locked} onClick={()=>void shareCard('html')}><Code2 size={18}/><span>HTML로 공유</span></button>
     </div>}
    </div>
   </nav>
  </div>
  <Toast key={toast.id} message={toast.message} tone={toast.tone} duration={toast.duration} onDismiss={dismiss}>{manualCopy&&<textarea aria-label="직접 복사할 공유 내용" readOnly value={manualCopy} onFocus={event=>event.currentTarget.select()}/>}</Toast>
 </dialog>;
}
