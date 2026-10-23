import {useEffect,useRef,useState} from 'react';
import {SHARE_QUOTE_LIMIT,TICKET_QUOTE_MARK,type TicketTextLayout} from '../lib/shareTicket';
export default function ShareCardEditor({title,quote,locked,onSelectQuote,onQuoteChange,onTitleChange,layout}:{title:string;quote:string;locked:boolean;onSelectQuote?:()=>void;onQuoteChange?:(text:string)=>void;onTitleChange:(title:string)=>void;layout:TicketTextLayout}){
 const [menu,setMenu]=useState(false),[closing,setClosing]=useState(false);
 const root=useRef<HTMLDivElement>(null),field=useRef<HTMLTextAreaElement>(null),titleField=useRef<HTMLTextAreaElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 function close(after?:()=>void){if(timer.current)return;const finish=()=>{setMenu(false);setClosing(false);timer.current=undefined;after?.();};if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}setClosing(true);timer.current=setTimeout(finish,170);}
 function edit(){field.current?.focus();field.current?.select();}
 useEffect(()=>{if(!menu)return;const down=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close();};document.addEventListener('pointerdown',down);return()=>document.removeEventListener('pointerdown',down);},[menu]);
 return <div className="share-card-editor" ref={root} onKeyDown={event=>{if(event.key==='Escape'&&menu){event.preventDefault();event.stopPropagation();close();}}}>
  <textarea ref={titleField} className="share-card-title-field" aria-label="공유 카드 제목" title="제목 수정" value={title} maxLength={160} disabled={locked} rows={2} spellCheck={false} onChange={event=>onTitleChange(event.target.value)} style={{fontSize:`${layout.titleSize/14.4}cqw`}}/>
  <svg className="share-ticket-quote-placeholder" viewBox="0 0 1440 720" aria-hidden="true"><text x={TICKET_QUOTE_MARK.x} y={TICKET_QUOTE_MARK.y} fontFamily="Georgia,serif" fontSize={TICKET_QUOTE_MARK.size}>“</text></svg>
  <textarea ref={field} className="share-card-quote-field" aria-label="공유 대사" placeholder="대사 선택" value={quote} maxLength={SHARE_QUOTE_LIMIT} disabled={locked||!onQuoteChange} spellCheck={false} onChange={event=>onQuoteChange?.(event.target.value)} style={{fontSize:`${layout.quoteSize/14.4}cqw`}}/>
  <button className="share-card-quote-menu-trigger" aria-label="공유할 대사 선택" title="대사 메뉴" disabled={locked} onClick={()=>menu?close():setMenu(true)}/>
  {menu&&<div className="share-card-menu" role="group" aria-label="대사 편집" data-closing={closing||undefined} inert={closing||undefined}>
   {onSelectQuote&&<button disabled={locked} onClick={()=>close(onSelectQuote)}>{quote.trim()?'다시 선택':'본문에서 선택'}</button>}
   {onQuoteChange&&<button disabled={locked} onClick={()=>close(edit)}>{quote.trim()?'수정':'처음부터 작성'}</button>}
   {quote.trim()&&onQuoteChange&&<button className="share-card-quote-delete" disabled={locked} onClick={()=>close(()=>onQuoteChange(''))}>삭제</button>}
  </div>}

 </div>;
}
