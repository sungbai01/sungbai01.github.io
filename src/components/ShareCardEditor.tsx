import {useEffect,useRef,useState} from 'react';
import {SquarePen,TextSelect,X} from 'lucide-react';
import {SHARE_QUOTE_LIMIT,TICKET_QUOTE_MARK,type TicketTextLayout} from '../lib/shareTicket';
export default function ShareCardEditor({title,quote,locked,onSelectQuote,onQuoteChange,onTitleChange,layout}:{title:string;quote:string;locked:boolean;onSelectQuote?:()=>void;onQuoteChange?:(text:string)=>void;onTitleChange:(title:string)=>void;layout:TicketTextLayout}){
 const [menu,setMenu]=useState(false),[closing,setClosing]=useState(false),[writing,setWriting]=useState(false);
 const root=useRef<HTMLDivElement>(null),field=useRef<HTMLTextAreaElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{if(writing)field.current?.focus();},[writing]);
 function close(after?:()=>void){if(timer.current)return;const finish=()=>{setMenu(false);setClosing(false);timer.current=undefined;after?.();};if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish();return;}setClosing(true);timer.current=setTimeout(finish,170);}
 useEffect(()=>{if(!menu)return;const down=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close();};document.addEventListener('pointerdown',down);return()=>document.removeEventListener('pointerdown',down);},[menu]);
 return <div className="share-card-editor" ref={root} onKeyDown={event=>{if(event.key==='Escape'&&(menu||writing)){event.preventDefault();event.stopPropagation();if(menu)close();else setWriting(false);}}}>
  <input className="share-card-title-field" aria-label="공유 카드 제목" title="책장 제목 수정" value={title} maxLength={160} disabled={locked} spellCheck={false} onChange={event=>onTitleChange(event.target.value)} style={{fontSize:`${layout.titleSize/14.4}cqw`}}/>
  {quote.trim()&&<svg className="share-ticket-quote-placeholder" viewBox="0 0 1440 720" aria-hidden="true"><text x={TICKET_QUOTE_MARK.x} y={TICKET_QUOTE_MARK.y} fontFamily="Georgia,serif" fontSize={TICKET_QUOTE_MARK.size}>“</text></svg>}
  {writing?<textarea ref={field} className="share-card-quote-field" aria-label="공유 대사" placeholder="대사 작성" value={quote} maxLength={SHARE_QUOTE_LIMIT} disabled={locked||!onQuoteChange} spellCheck={false} onChange={event=>{const value=event.target.value;onQuoteChange?.(value);if(!value.trim())setWriting(false);}} onBlur={()=>setWriting(false)} style={{fontSize:`${layout.quoteSize/14.4}cqw`}}/>:
   <button className="share-card-quote-field share-card-quote-choice" aria-label="공유할 대사 선택" disabled={locked} onClick={()=>menu?close():setMenu(true)} style={{fontSize:`${layout.quoteSize/14.4}cqw`}}><span data-empty={!quote.trim()||undefined}>{quote||'대사 선택'}</span></button>}
  {menu&&<div className="share-card-menu" role="group" aria-label="대사 편집" data-closing={closing||undefined} inert={closing||undefined}>
   <button aria-label="작성" title="작성" disabled={locked||!onQuoteChange} onClick={()=>close(()=>setWriting(true))}><SquarePen aria-hidden="true" size={20}/></button>
   <button aria-label="본문에서 선택" title="본문에서 선택" disabled={locked||!onSelectQuote} onClick={()=>close(onSelectQuote)}><TextSelect aria-hidden="true" size={20}/></button>
   <button aria-label="대사 메뉴 닫기" title="닫기" onClick={()=>close()}><X aria-hidden="true" size={20}/></button>
  </div>}
 </div>;
}
