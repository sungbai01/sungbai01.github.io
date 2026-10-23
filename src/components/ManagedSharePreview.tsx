import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ShareCardPreview} from '../../shared/shareCard';
import {makeShareCard} from '../lib/sharing';
import ShareTicketFace from './ShareTicketFace';
import Toast from './Toast';
import {useToast} from '../lib/useToast';
export default function ManagedSharePreview({card,bookId,onClose}:{card:ShareCardPreview;bookId:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),[closing,setClosing]=useState(false);
 useEffect(()=>{const element=dialog.current!;element.showModal();return()=>{clearTimeout(timer.current);element.close();};},[]);
 function close(){if(closing)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}setClosing(true);timer.current=setTimeout(onClose,260);}
 const [preview,setPreview]=useState('');const {toast,notify,dismiss}=useToast();
 const book=useMemo(()=>({...card,id:bookId,description:'',createdAt:'',updatedAt:'',messages:[],...(card.backgroundUrl?{characterIcon:card.backgroundUrl}:{})}),[card,bookId]);
 useEffect(()=>{let active=true,url='';setPreview('');void makeShareCard(book,card.quote,card.quotePages,undefined,{imagePosition:card.imagePosition}).then(blob=>{if(!active)return;url=URL.createObjectURL(blob);setPreview(url);}).catch(()=>{if(active)notify('카드 미리보기를 만들지 못했어요.','error');});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[book,card,notify]);
 return createPortal(<dialog ref={dialog} className="share-ticket-dialog managed-share-dialog" data-closing={closing||undefined} aria-label={`${card.title} 카드 미리보기`} onCancel={event=>{event.preventDefault();event.stopPropagation();close();}} onClick={event=>{if(event.target===event.currentTarget)close();}}><div className="share-ticket-frame"><div className="share-ticket-workspace"><article className="share-interactive-ticket" data-readonly="true"><ShareTicketFace book={book} preview={preview} layout={{titleSize:48,quoteSize:32}} position={card.imagePosition}/><span className="sr-only" aria-label="공유 대사">{card.quote}</span></article><nav className="share-ticket-tools" aria-label="미리보기 도구"><button className="share-ticket-close" aria-label="미리보기 닫기" title="닫기" onClick={close}><X size={20}/></button></nav></div></div><Toast key={toast.id} message={toast.message} tone={toast.tone} duration={toast.duration} onDismiss={dismiss}/></dialog>,document.body);
}
