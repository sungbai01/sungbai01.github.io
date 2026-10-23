import {useEffect,useRef,useState} from 'react';
import {Bookmark,Check,X} from 'lucide-react';
import type {BookAsset} from '../lib/library';
import AssetPicker from './AssetPicker';
export default function BookmarkEditor({assets,style,assetId,onChange,onClose}:{assets:readonly BookAsset[];style:string;assetId?:string;onChange:(style:'normal'|'image',assetId?:string)=>void;onClose:()=>void}){
 const [closing,setClosing]=useState(false);const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const close=()=>{if(closing)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}setClosing(true);timer.current=setTimeout(onClose,150);};
 const dialog=useRef<HTMLDialogElement>(null);useEffect(()=>{const element=dialog.current!;element.showModal();return()=>{clearTimeout(timer.current);element.close();};},[]);
 return <dialog ref={dialog} className="modal asset-picker-dialog" data-closing={closing||undefined} aria-label="책갈피 편집" onCancel={event=>{event.preventDefault();event.stopPropagation();close();}}><header className="modal-header"><h2>책갈피 편집</h2><button type="button" className="icon-btn" aria-label="책갈피 편집 닫기" onClick={close}><X size={20}/></button></header><button type="button" className="secondary-btn" aria-pressed={style==='normal'} onClick={()=>onChange('normal',assetId)}><Bookmark size={18}/>기본{style==='normal'&&<Check size={16}/>}</button><AssetPicker assets={assets} label="책갈피 이미지" selectedIds={style==='image'&&assetId?[assetId]:[]} onSelect={asset=>onChange('image',asset.id)}/></dialog>;
}
