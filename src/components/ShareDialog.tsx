import type {ShareCardLayout} from '../../shared/shareCard';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Download,Images,LoaderCircle,X,Share2,Link,Code2,ArrowUp,ArrowDown,GripVertical,Image as ImageIcon} from 'lucide-react';
import type {Book} from '../lib/library';
import {getAuthSession} from '../lib/auth';
import {cardHtml,copyImageCard,downloadBlob,makeShareCard,shareRequest,shareUrl,sharedCardImage,saveShareCardLayout,prepareShareUpdate,syncShareImages,withSharedAssets,type ShareInfo} from '../lib/sharing';
import Toast from './Toast';
import ShareCardEditor from './ShareCardEditor';
import ShareTicketFace from './ShareTicketFace';
import {useToast} from '../lib/useToast';
import {type QuotePageRange,type TicketTextLayout} from '../lib/shareTicket';
import './share-dialog.css';
export default function ShareDialog({book:sourceBook,loadBook,onClose,onManageAssets,quote:providedQuote='',quotePages:providedPages,onRestoreSettings,onSelectQuote,onQuoteChange,cardTitle,onCardTitleChange,shelfTitle,imagePosition:initialImagePosition=0,onImagePositionChange}:{onRestoreSettings?:(layout:ShareCardLayout)=>void;imagePosition?:number;onImagePositionChange?:(position:number)=>void;shelfTitle?:string;quote?:string;quotePages?:QuotePageRange;cardTitle?:string;onCardTitleChange?:(title:string)=>void;onSelectQuote?:()=>void;onQuoteChange?:(text:string)=>void;book:Book;loadBook?:(book:Book)=>Promise<Book>;onClose:()=>void;onManageAssets?:()=>void}){
 const [book,setBook]=useState(sourceBook),[bookPending,setBookPending]=useState(!!loadBook),[bookError,setBookError]=useState('');
 useEffect(()=>{let active=true;setBook(sourceBook);setBookPending(!!loadBook);setBookError('');if(loadBook)void loadBook(sourceBook).then(value=>{if(active)setBook(value);}).catch(()=>{if(active)setBookError('책을 불러오지 못했어요. 닫고 다시 열어 주세요.');}).finally(()=>{if(active)setBookPending(false);});return()=>{active=false;};},[sourceBook,loadBook]);
 const [quote,setQuote]=useState(providedQuote),[quotePages,setQuotePages]=useState(providedPages);
 useEffect(()=>setQuote(providedQuote),[providedQuote]);useEffect(()=>setQuotePages(providedPages),[providedPages]);
 const [published,setPublished]=useState<ShareInfo|null>(null),[checking,setChecking]=useState(!!getAuthSession()),[lookupFailed,setLookupFailed]=useState(false),[backgroundName,setBackgroundName]=useState<string>();
 const restoreDraft=useRef(cardTitle===undefined&&!providedQuote);
 const [imagePosition,setImagePosition]=useState(initialImagePosition),[imageDragging,setImageDragging]=useState(false);
 const imageDrag=useRef<{id:number;y:number;position:number;scale:number}|null>(null);
 const [customTitle,setCustomTitle]=useState<string|undefined>(cardTitle);
 const visualBook=useMemo(()=>{const value=withSharedAssets(book,published);const chosen=backgroundName?value.assets?.find(asset=>asset.name===backgroundName):undefined;return chosen?{...value,shareCardAssetId:chosen.id}:value;},[book,published,backgroundName]);
 const cardBook=useMemo(()=>({...visualBook,title:customTitle??shelfTitle??book.seriesTitle??book.title}),[visualBook,customTitle,shelfTitle,book.seriesTitle,book.title]);
 const previousAsset=useRef(book.shareCardAssetId);useEffect(()=>{if(previousAsset.current!==book.shareCardAssetId&&previousAsset.current!==undefined)setBackgroundName(undefined);previousAsset.current=book.shareCardAssetId;},[book.shareCardAssetId]);
 const dialog=useRef<HTMLDialogElement>(null),title=useId();
 const [closing,setClosing]=useState(false);
 const closeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const closeCallback=useRef(onClose);closeCallback.current=onClose;
 useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
 function requestClose(){if(busy||closing)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){closeCallback.current();return;}setClosing(true);closeTimer.current=setTimeout(()=>closeCallback.current(),260);}
 const [busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[shareClosing,setShareClosing]=useState(false),[manualCopy,setManualCopy]=useState('');
 const shareExitTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(shareExitTimer.current),[]);
 function closeShare(){if(shareExitTimer.current)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){setExpanded(false);return;}setShareClosing(true);shareExitTimer.current=setTimeout(()=>{setExpanded(false);setShareClosing(false);shareExitTimer.current=undefined;},190);}
 const {toast,notify,dismiss}=useToast();
 const shareTools=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!bookError)return;notify(bookError,'error');},[bookError,notify]);
 useEffect(()=>{if(!expanded)return;const close=(event:PointerEvent)=>{if(!shareTools.current?.contains(event.target as Node))closeShare();};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[expanded]);
 const requestBusy=useRef(false);
 const [card,setCard]=useState<Blob>(),[preview,setPreview]=useState(''),[layout,setLayout]=useState<TicketTextLayout>({titleSize:48,quoteSize:32}),[renderPending,setRenderPending]=useState(true);
 const alive=useRef(true),previewReady=useRef(false);
 useEffect(()=>{alive.current=true;const element=dialog.current!;element.showModal();return()=>{alive.current=false;element.close();};},[]);
 useEffect(()=>{
  if(!getAuthSession()){setChecking(false);return;}
  const controller=new AbortController();setChecking(true);setLookupFailed(false);
  void shareRequest(sourceBook.id,'GET',controller.signal).then(value=>{if(controller.signal.aborted)return;setPublished(value);if(value?.card&&restoreDraft.current){restoreDraft.current=false;setCustomTitle(value.card.title);setQuote(value.card.quote);setQuotePages(value.card.quotePages);setImagePosition(value.card.imagePosition);setBackgroundName(value.card.backgroundName);onRestoreSettings?.(value.card);}}).catch(cause=>{if(!controller.signal.aborted){setLookupFailed(true);notify(cause instanceof Error?cause.message:'공유 설정을 불러오지 못했어요.','error');}}).finally(()=>{if(!controller.signal.aborted)setChecking(false);});
  return()=>controller.abort();
 },[sourceBook.id]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 const artworkSource=cardBook.assets?.find(asset=>asset.id===cardBook.shareCardAssetId)?.src??cardBook.characterIcon??cardBook.assets?.find(asset=>asset.type==='icon')?.src;
 useEffect(()=>{
  if(bookPending||bookError||imageDragging)return;
  let active=true,temporary='';setRenderPending(true);
  const timer=setTimeout(()=>{
   let pendingLayout:TicketTextLayout|undefined;
   void makeShareCard(cardBook,quote,quotePages,(blob,nextLayout)=>{temporary=URL.createObjectURL(blob);pendingLayout=nextLayout;},{imagePosition}).then(async result=>{
    if(!active){if(temporary)URL.revokeObjectURL(temporary);return;}
    const decoded=new Image();decoded.src=temporary;await decoded.decode();
    if(!active){URL.revokeObjectURL(temporary);return;}
    setCard(result);setPreview(temporary);if(pendingLayout)setLayout(pendingLayout);previewReady.current=true;setRenderPending(false);
   }).catch(cause=>{if(temporary)URL.revokeObjectURL(temporary);if(active){setCard(undefined);setRenderPending(false);notify(cause instanceof Error?cause.message:'카드를 만들지 못했어요.','error');}});
  },previewReady.current?120:0);
  return()=>{active=false;clearTimeout(timer);};
 },[cardBook.title,cardBook.author,cardBook.aiModel,cardBook.color,cardBook.volumeNumber,cardBook.displayPrompt?.id,artworkSource,quote,quotePages?.start,quotePages?.end,bookPending,bookError,notify,imagePosition,imageDragging]);
 async function copy(value:string,html=false){try{if(html&&navigator.clipboard.write&&typeof ClipboardItem!=='undefined'){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([value],{type:'text/html'}),'text/plain':new Blob([value],{type:'text/plain'})})]);}else await navigator.clipboard.writeText(value);if(alive.current){setManualCopy('');notify('복사했어요.','success');}}catch{if(alive.current){setManualCopy(value);notify('복사 권한이 없어요. 직접 복사해 주세요.','error',0);}}}
 const cardSettingsKey=(value?:ShareCardLayout)=>JSON.stringify(value?[value.title.trim(),value.quote,value.quotePages?.start??null,value.quotePages?.end??null,value.imagePosition,value.backgroundName??'']:null);
 const draftLayout=():ShareCardLayout=>({title:cardBook.title,quote,quotePages,imagePosition,...((backgroundName??cardBook.assets?.find(asset=>asset.id===cardBook.shareCardAssetId)?.name)?{backgroundName:backgroundName??cardBook.assets?.find(asset=>asset.id===cardBook.shareCardAssetId)?.name}:{})});
 async function shareCard(format:'url'|'html'|'image'){
  if(!card||renderPending||requestBusy.current||bookPending||bookError||checking||closing)return;
  requestBusy.current=true;setBusy(true);setManualCopy('');notify('공유를 준비하고 있어요.','progress',0);
  try{
   if(!getAuthSession())throw new Error('공유는 로그인한 서재에서 이용할 수 있어요.');
   if(lookupFailed)throw new Error('공유 설정을 불러오지 못했어요. 창을 다시 열어 주세요.');
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   const before=published;let share=before;const prepared=await prepareShareUpdate({...visualBook,shareCardAssetId:cardBook.shareCardAssetId},before);
   if(!share||share.contentHash!==prepared.hash){const next=await shareRequest(book.id,'POST',undefined,prepared.book);if(!next)throw new Error('공유 링크를 만들지 못했어요.');share={...share,...next,contentHash:prepared.hash};if(alive.current)setPublished(share);}
   const media=await syncShareImages(prepared.book,prepared.images,before?.images??[],(done,total)=>{if(alive.current)notify(`이미지 ${done}/${total} 업데이트 중…`,'progress',0);});
   const saved=draftLayout();if(cardSettingsKey(before?.card)!==cardSettingsKey(saved))await saveShareCardLayout(book,saved);
   const ready:ShareInfo={...share!,contentHash:prepared.hash,card:saved,images:media.images,credit:{author:prepared.book.author,aiModel:prepared.book.aiModel,color:prepared.book.color,volumeNumber:prepared.book.volumeNumber,displayPrompt:prepared.book.displayPrompt}};
   if(alive.current){setPublished(ready);if(format==='image'){await copyImageCard({...cardBook,...ready.credit},card,ready.id);notify('이미지와 링크를 복사했어요.','success');return;}await copy(format==='url'?shareUrl(ready.id):cardHtml({...cardBook,...ready.credit,title:saved.title},shareUrl(ready.id),sharedCardImage(ready),saved),format==='html');}
  }catch(cause){if(alive.current)notify(cause instanceof Error?cause.message:'공유를 완료하지 못했어요.','error');}
  finally{requestBusy.current=false;if(alive.current)setBusy(false);}
 }

 const locked=busy||closing||bookPending||!!bookError;
 const movable=!!layout.artwork&&layout.artwork.overflow>0;
 const positionChange=(position:number)=>{setImagePosition(position);onImagePositionChange?.(position);};
 const dragStart=(event:React.PointerEvent<HTMLElement>)=>{
  if(locked||!movable||event.button!==0||!event.isPrimary||imageDrag.current)return;
  if((event.target as Element).closest('input,textarea,button,.share-card-menu'))return;
  event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
  const card=dialog.current?.querySelector('.share-interactive-ticket')?.getBoundingClientRect();if(!card)return;
  imageDrag.current={id:event.pointerId,y:event.clientY,position:imagePosition,scale:card.width/1440};setImageDragging(true);setRenderPending(true);
 };
 const dragMove=(event:React.PointerEvent<HTMLElement>)=>{const drag=imageDrag.current;if(!drag||drag.id!==event.pointerId||!layout.artwork)return;event.preventDefault();positionChange(Math.max(0,Math.min(1,drag.position-(event.clientY-drag.y)/(layout.artwork.overflow*drag.scale))));};
 const dragEnd=(event:React.PointerEvent<HTMLElement>)=>{if(imageDrag.current?.id!==event.pointerId)return;dragMove(event);imageDrag.current=null;setImageDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
 return <dialog ref={dialog} className="share-ticket-dialog" data-closing={closing||undefined} aria-labelledby={title} onCancel={event=>{event.preventDefault();if(expanded)closeShare();else requestClose();}}>
  <h2 id={title} className="sr-only">책 공유</h2>
  <div className="share-ticket-frame"><div className="share-ticket-workspace">
   <div className="share-image-drag-hint" role="slider" aria-label="배경 이미지 상하 위치" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(imagePosition*100)} aria-orientation="vertical" aria-disabled={!movable||locked} tabIndex={movable&&!locked?0:-1} title="배경 이미지를 잡고 위아래로 드래그하세요" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} onLostPointerCapture={()=>{imageDrag.current=null;setImageDragging(false);}} onKeyDown={event=>{if(!movable||locked)return;const value=event.key==='ArrowUp'?imagePosition-.05:event.key==='ArrowDown'?imagePosition+.05:event.key==='Home'?0:event.key==='End'?1:undefined;if(value!==undefined){event.preventDefault();setRenderPending(true);positionChange(Math.max(0,Math.min(1,value)));}}}><ArrowUp size={16}/><span/><GripVertical size={18}/><span/><ArrowDown size={16}/></div>
   <article className="share-interactive-ticket" aria-label="저장될 공유 카드" data-image-movable={movable||undefined} data-image-dragging={imageDragging||undefined} onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} onLostPointerCapture={()=>{imageDrag.current=null;setImageDragging(false);}}>
    <ShareTicketFace book={cardBook} preview={preview} layout={layout} position={imagePosition}/>
    <ShareCardEditor title={cardBook.title} quote={quote} locked={locked} layout={layout} onSelectQuote={onSelectQuote} onQuoteChange={onQuoteChange?value=>{setRenderPending(true);setQuote(value);onQuoteChange(value);}:undefined} onTitleChange={value=>{setRenderPending(true);setCustomTitle(value);onCardTitleChange?.(value);}}/>

   </article>
   <nav className="share-ticket-tools" aria-label="공유 도구">
    <button className="share-ticket-close" aria-label="닫기" title="닫기" disabled={busy||closing} onClick={requestClose}><X size={20}/></button>
    {onManageAssets&&<button disabled={busy} onClick={onManageAssets} title="공유 카드 이미지 선택" aria-label="공유 카드 이미지 선택"><Images size={20}/></button>}
    <button aria-label="카드 이미지 저장" title="카드 이미지 저장" disabled={!card||renderPending||locked} onClick={()=>{if(card)downloadBlob(card,`갈피-공유카드.${card.type==='image/webp'?'webp':'png'}`);}}><Download size={20}/></button>
    <div className="share-ticket-share" ref={shareTools}>
     <button aria-label="공유" title="공유" aria-expanded={expanded} aria-controls={`${title}-share-actions`} disabled={!card||renderPending||locked||checking||expanded} onClick={()=>setExpanded(true)}>{busy||checking?<LoaderCircle className="animate-spin" size={20}/>:<Share2 size={20}/>}</button>
     {expanded&&<div className="share-ticket-actions" data-closing={shareClosing||undefined} inert={shareClosing||undefined} id={`${title}-share-actions`} role="group" aria-label="공유 형식">
      <button aria-label="URL로 공유" title="URL로 공유" disabled={locked||checking||renderPending} onClick={()=>void shareCard('url')}><Link size={18}/></button>
      <button aria-label="HTML로 공유" title="HTML로 공유" disabled={locked||checking||renderPending} onClick={()=>void shareCard('html')}><Code2 size={18}/></button>
      <button aria-label="이미지로 공유" title="이미지로 공유" disabled={locked||checking||renderPending} onClick={()=>void shareCard('image')}><ImageIcon size={18}/></button>
     </div>}
    </div>
   </nav>
  </div>
  </div>
  <Toast key={toast.id} message={toast.message} tone={toast.tone} duration={toast.duration} onDismiss={dismiss}>{manualCopy&&<textarea aria-label="직접 복사할 공유 내용" readOnly value={manualCopy} onFocus={event=>event.currentTarget.select()}/>}</Toast>
 </dialog>;
}
