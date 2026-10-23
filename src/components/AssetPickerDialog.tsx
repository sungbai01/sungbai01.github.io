import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {BookAsset} from '../lib/library';
import AssetPicker from './AssetPicker';
export default function AssetPickerDialog({assets,title,selectedIds,onSelect,onClose}:{assets:readonly BookAsset[];title:string;selectedIds?:readonly string[];onSelect:(asset:BookAsset)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),[closing,setClosing]=useState(false);
 useEffect(()=>{const element=dialog.current!;element.showModal();return()=>{clearTimeout(timer.current);element.close();};},[]);
 const close=()=>{if(closing)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}setClosing(true);timer.current=setTimeout(onClose,150);};
 return <dialog ref={dialog} className="modal asset-picker-dialog" aria-label={title} data-closing={closing||undefined} onCancel={event=>{event.preventDefault();event.stopPropagation();close();}} onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget)close();}}><header className="modal-header"><h2>{title}</h2><button type="button" className="icon-btn" aria-label="에셋 선택 닫기" onClick={close}><X size={20}/></button></header><AssetPicker assets={assets} label={title} selectedIds={selectedIds} selectionLabel="선택" disabled={closing} onSelect={asset=>{onSelect(asset);close();}}/></dialog>;
}
