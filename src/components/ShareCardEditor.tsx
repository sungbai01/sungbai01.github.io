import {useEffect,useRef,useState} from 'react';
import {Check,X} from 'lucide-react';
import {SHARE_QUOTE_LIMIT,TICKET_QUOTE_MARK} from '../lib/shareTicket';
export default function ShareCardEditor({title,quote,locked,onSelectQuote,onQuoteChange,onTitleChange}:{title:string;quote:string;locked:boolean;onSelectQuote?:()=>void;onQuoteChange?:(text:string)=>void;onTitleChange:(title:string)=>void}){
 const [menu,setMenu]=useState(false),[closing,setClosing]=useState(false),[editing,setEditing]=useState<'title'|'quote'|null>(null),[draft,setDraft]=useState('');
 const root=useRef<HTMLDivElement>(null),field=useRef<HTMLTextAreaElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 function close(after?:()=>void){if(timer.current)return;const finish=()=>{setMenu(false);setClosing(false);timer.current=undefined;after?.();};if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}setClosing(true);timer.current=setTimeout(finish,170);}
 function edit(mode:'title'|'quote'){setDraft(mode==='title'?title:quote);setEditing(mode);}
 useEffect(()=>{if(!menu)return;const down=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close();};document.addEventListener('pointerdown',down);return()=>document.removeEventListener('pointerdown',down);},[menu]);
 useEffect(()=>{if(editing){field.current?.focus();field.current?.select();}},[editing]);
 return <div className="share-card-editor" ref={root} onKeyDown={event=>{if(event.key==='Escape'&&(menu||editing)){event.preventDefault();event.stopPropagation();if(editing)setEditing(null);else close();}}}>
  <button className="share-card-title-target" aria-label="공유 카드 제목 수정" title="제목 수정" disabled={locked} onClick={()=>menu?close(()=>edit('title')):edit('title')}/>
  {!quote.trim()&&!editing&&<svg className="share-ticket-quote-placeholder" viewBox="0 0 1440 720" aria-hidden="true"><text x={TICKET_QUOTE_MARK.x} y={TICKET_QUOTE_MARK.y} fontFamily="Georgia,serif" fontSize={TICKET_QUOTE_MARK.size}>“</text><text x="70" y="310" fontFamily="Gowun Batang,serif" fontSize="32">대사 선택</text></svg>}
  {!editing&&<button className="share-ticket-quote-target" data-empty={!quote.trim()} aria-label="공유할 대사 선택" title="대사 선택 또는 편집" disabled={locked} onClick={()=>menu?close():setMenu(true)}/>}
  {menu&&<div className="share-card-menu" role="group" aria-label="대사 편집" data-closing={closing||undefined} inert={closing||undefined}>
   {onSelectQuote&&<button disabled={locked} onClick={()=>close(onSelectQuote)}>{quote.trim()?'다시 선택':'본문에서 선택'}</button>}
   {onQuoteChange&&<button disabled={locked} onClick={()=>close(()=>edit('quote'))}>{quote.trim()?'수정':'처음부터 작성'}</button>}
   {quote.trim()&&onQuoteChange&&<button className="share-card-quote-delete" disabled={locked} onClick={()=>close(()=>onQuoteChange(''))}>삭제</button>}
  </div>}
  {editing&&<form className="share-card-edit-form" onSubmit={event=>{event.preventDefault();if(editing==='title'){if(!draft.trim())return;onTitleChange(draft.trim());}else onQuoteChange?.(draft.trim());setEditing(null);}}>
   <textarea ref={field} aria-label={editing==='title'?'공유 카드 제목':'공유 대사'} value={draft} maxLength={editing==='title'?160:SHARE_QUOTE_LIMIT} onChange={event=>setDraft(event.target.value)} placeholder={editing==='title'?'제목':'대사를 입력하세요'}/>
   <div><button type="button" aria-label="편집 취소" title="취소" onClick={()=>setEditing(null)}><X size={18}/></button><button type="submit" aria-label="편집 적용" title="적용" disabled={locked||editing==='title'&&!draft.trim()}><Check size={18}/></button></div>
  </form>}
 </div>;
}
