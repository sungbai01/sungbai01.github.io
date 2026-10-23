import {useEffect,useMemo,useState} from 'react';
import type {ShareCardPreview} from '../../shared/shareCard';
import {makeShareCard} from '../lib/sharing';
import ShareTicketFace from './ShareTicketFace';
import Toast from './Toast';
import {useToast} from '../lib/useToast';
export default function ManagedSharePreview({card,bookId}:{card:ShareCardPreview;bookId:string}){
 const [preview,setPreview]=useState('');const {toast,notify,dismiss}=useToast();
 const book=useMemo(()=>({...card,id:bookId,description:'',createdAt:'',updatedAt:'',messages:[],...(card.backgroundUrl?{characterIcon:card.backgroundUrl}:{})}),[card,bookId]);
 useEffect(()=>{let active=true,url='';setPreview('');void makeShareCard(book,card.quote,card.quotePages,undefined,{imagePosition:card.imagePosition}).then(blob=>{if(!active)return;url=URL.createObjectURL(blob);setPreview(url);}).catch(()=>{if(active)notify('카드 미리보기를 만들지 못했어요.','error');});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[book,card,notify]);
 return <div className="managed-share-preview" aria-label={`${card.title} 카드 미리보기`}><article className="share-interactive-ticket" data-readonly="true"><ShareTicketFace book={book} preview={preview} layout={{titleSize:48,quoteSize:32}} position={card.imagePosition}/></article><Toast key={toast.id} message={toast.message} tone={toast.tone} duration={toast.duration} onDismiss={dismiss}/></div>;
}
