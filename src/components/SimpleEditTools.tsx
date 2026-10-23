import {useEffect,useId,useRef,useState} from 'react';
import {Check,FilePenLine,LoaderCircle,Settings2,X} from 'lucide-react';
import type {DisplayPrompt} from '../../shared/displayPrompt';
import DisplayPromptControls from './DisplayPromptControls';
import './simple-edit-tools.css';

export default function SimpleEditTools({prompt,onPromptChange,saving,onAdvanced,onCancel,onSave}:{prompt:DisplayPrompt;onPromptChange:(value:DisplayPrompt)=>void;saving:boolean;onAdvanced:()=>void;onCancel:()=>void;onSave:()=>void}){
 const [open,setOpen]=useState(false),[closing,setClosing]=useState(false);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),timer=useRef<ReturnType<typeof setTimeout>>(undefined),id=useId();
 function close(){if(timer.current)return;const finish=()=>{setOpen(false);setClosing(false);timer.current=undefined;};if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}setClosing(true);timer.current=setTimeout(finish,150);}
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 return <div ref={root} className="reader-edit-toolbar reader-edit-tools" data-no-flip onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();trigger.current?.focus();}}}>
  <div className="reader-inline-actions" role="toolbar" aria-label="간단 수정 도구">
   <button ref={trigger} type="button" aria-label="본문 표시 설정" title="본문 표시 설정" aria-expanded={open&&!closing} aria-controls={id} disabled={saving} onClick={()=>open?close():setOpen(true)}><Settings2 size={18}/></button>
   <button type="button" aria-label="고급 수정" title="고급 수정" disabled={saving} onClick={onAdvanced}><FilePenLine size={18}/></button>
   <button type="button" aria-label="취소" title="수정 취소" disabled={saving} onClick={onCancel}><X size={18}/></button>
   <button type="button" aria-label="저장" title={saving?'저장 중…':'저장'} disabled={saving} onClick={onSave}>{saving?<LoaderCircle size={18} className="animate-spin"/>:<Check size={18}/>}</button>
  </div>
  {open&&<div id={id} className="simple-edit-settings" role="region" aria-label="간단 수정 표시 설정" data-closing={closing||undefined} inert={closing||saving||undefined}><DisplayPromptControls value={prompt} onChange={onPromptChange} disabled={saving}/></div>}
 </div>;
}
