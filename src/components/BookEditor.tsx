import Dropdown from './Dropdown';
import {useEffect,useRef,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,LoaderCircle,Plus,Trash2,X} from 'lucide-react';
import type {Book,Message} from '../lib/library';

export default function BookEditor({book,messageIndex,onSave,onClose}:{book:Book;messageIndex:number;onSave:(book:Book)=>Promise<void>;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [draft,setDraft]=useState(()=>({...book,messages:book.messages.map(message=>({...message}))}));
 const [index,setIndex]=useState(Math.max(0,Math.min(messageIndex,book.messages.length-1)));
 const [saving,setSaving]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 const message=draft.messages[index];
 function patch(value:Partial<Message>){setDraft(previous=>({...previous,messages:previous.messages.map((entry,i)=>i===index?{...entry,...value}:entry)}));}
 async function save(){setSaving(true);setError('');try{await onSave({...draft,title:draft.title.trim()||book.title,updatedAt:new Date().toISOString()});onClose();}catch{setError('저장 실패. 다시 시도하세요.');}finally{setSaving(false);}}
 return <dialog ref={dialog} className="reader-editor" aria-label="본문 편집" onCancel={event=>{event.preventDefault();if(!saving)onClose();}}>
  <div className="reader-editor-heading"><h2>본문 편집</h2><button className="reader-icon-button" aria-label="편집 취소" title="취소" disabled={saving} onClick={onClose}><X size={20}/></button></div>
  <label className="reader-editor-field">책 제목<input aria-label="책 제목" maxLength={100} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
  <div className="reader-editor-navigation"><button className="reader-icon-button" aria-label="이전 대화 편집" disabled={index===0||saving} onClick={()=>setIndex(index-1)}><ChevronLeft size={18}/></button><Dropdown label="편집할 대화" value={String(index)} disabled={saving} onChange={next=>setIndex(Number(next))} options={draft.messages.map((entry,i)=>({value:String(i),label:`${i+1}. ${entry.name||entry.role}`}))}/><button className="reader-icon-button" aria-label="다음 대화 편집" disabled={index>=draft.messages.length-1||saving} onClick={()=>setIndex(index+1)}><ChevronRight size={18}/></button><button className="reader-icon-button" aria-label="대화 추가" title="대화 추가" disabled={saving} onClick={()=>{setDraft(previous=>({...previous,messages:[...previous.messages,{role:'assistant',name:'서술',content:''}]}));setIndex(draft.messages.length);}}><Plus size={18}/></button><button className="reader-icon-button" aria-label="현재 대화 삭제" title="현재 대화 삭제" disabled={saving||draft.messages.length<=1} onClick={()=>{setDraft(previous=>({...previous,messages:previous.messages.filter((_,i)=>i!==index)}));setIndex(Math.max(0,index-1));}}><Trash2 size={17}/></button></div>
  {message&&<><div className="reader-editor-speaker"><label className="reader-editor-field">화자<input aria-label="화자" value={message.name} onChange={event=>patch({name:event.target.value})}/></label><div className="reader-editor-field">역할<Dropdown label="역할" value={message.role} disabled={saving} onChange={role=>patch({role})} options={[...new Set(['assistant','user','system','narrator',message.role])].map(role=>({value:role,label:role}))}/></div></div><textarea className="reader-editor-content" aria-label="대화 내용" value={message.content} onChange={event=>patch({content:event.target.value})} spellCheck={false}/></>}
  {error&&<p role="alert" className="reader-error">{error}</p>}
  <div className="reader-editor-actions"><button disabled={saving} onClick={onClose}>취소</button><button className="reader-editor-save" disabled={saving||!draft.title.trim()} onClick={()=>void save()}>{saving?<LoaderCircle size={17} className="animate-spin"/>:<Check size={17}/>} 저장</button></div>
 </dialog>;
}
