import {useEffect,useState,type RefObject} from 'react';
import {Check,ChevronLeft,ChevronRight,X} from 'lucide-react';
import {SHARE_QUOTE_LIMIT,type QuotePageRange} from '../lib/shareTicket';

export default function ShareQuoteSelection({host,onDone,onPrevious,onNext}:{host:RefObject<HTMLDivElement|null>;onDone:(text?:string,pages?:QuotePageRange)=>void;onPrevious:()=>void;onNext:()=>void}){
 const [text,setText]=useState('');
 const [pages,setPages]=useState<QuotePageRange>();
 useEffect(()=>{
  const element=host.current;if(!element)return;
  let start:{node:Node;offset:number}|null=null,pointer:number|null=null;
  const caret=(x:number,y:number)=>{
   const doc=document as Document & {caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null;caretRangeFromPoint?:(x:number,y:number)=>Range|null};
   const position=doc.caretPositionFromPoint?.(x,y),range=position?null:doc.caretRangeFromPoint?.(x,y);
   const node=position?.offsetNode??range?.startContainer,offset=position?.offset??range?.startOffset;
   const parent=node?.nodeType===Node.ELEMENT_NODE?node as Element:node?.parentElement;
   if(!node||offset===undefined||!parent?.closest('.reader-prose')||!element.contains(node)||parent.closest('[data-flip-copy]'))return null;
   return {node,offset};
  };
  const read=()=>{
   const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed){setText('');setPages(undefined);return;}
   const range=selection.getRangeAt(0);
   if(!element.contains(range.startContainer)||!element.contains(range.endContainer)){setText('');setPages(undefined);return;}
   const pieces:string[]=[],numbers:number[]=[];
   for(const prose of element.querySelectorAll<HTMLElement>('.reader-page:not([data-flip-copy]) .reader-prose')){
    if(!prose.getClientRects().length||!range.intersectsNode(prose))continue;
    const part=document.createRange();part.selectNodeContents(prose);
    if(prose.contains(range.startContainer))part.setStart(range.startContainer,range.startOffset);
    if(prose.contains(range.endContainer))part.setEnd(range.endContainer,range.endOffset);
    const value=part.toString();if(value){pieces.push(value);const number=Number(prose.closest('.reader-page')?.querySelector('.reader-page-number')?.textContent);if(Number.isInteger(number)&&number>0)numbers.push(number);}
   }
   setText(pieces.join('\n').trim());
   const start=Math.min(...numbers),end=Math.max(...numbers);setPages(previous=>numbers.length?(previous?.start===start&&previous.end===end?previous:{start,end}):undefined);
  };
  const down=(event:PointerEvent)=>{
   if(!event.isPrimary||event.button!==0)return;
   start=caret(event.clientX,event.clientY);if(!start)return;
   event.preventDefault();event.stopPropagation();pointer=event.pointerId;
   element.setPointerCapture(pointer);window.getSelection()?.setBaseAndExtent(start.node,start.offset,start.node,start.offset);
  };
  const move=(event:PointerEvent)=>{
   if(!start||pointer!==event.pointerId)return;
   event.preventDefault();event.stopPropagation();const end=caret(event.clientX,event.clientY);
   if(end)window.getSelection()?.setBaseAndExtent(start.node,start.offset,end.node,end.offset);
  };
  const up=(event:PointerEvent)=>{if(pointer!==event.pointerId)return;move(event);if(element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);pointer=null;start=null;read();};
  document.addEventListener('selectionchange',read);
  element.addEventListener('pointerdown',down,true);element.addEventListener('pointermove',move,true);element.addEventListener('pointerup',up,true);element.addEventListener('pointercancel',up,true);
  return()=>{document.removeEventListener('selectionchange',read);element.removeEventListener('pointerdown',down,true);element.removeEventListener('pointermove',move,true);element.removeEventListener('pointerup',up,true);element.removeEventListener('pointercancel',up,true);if(pointer!==null&&element.hasPointerCapture(pointer))element.releasePointerCapture(pointer);window.getSelection()?.removeAllRanges();};
 },[host]);
 const tooLong=text.length>SHARE_QUOTE_LIMIT;
 return <div className="reader-quote-tools" role="region" aria-label="공유할 대사 선택" data-no-flip onPointerDown={event=>event.preventDefault()}>
  <button className="reader-icon-button" aria-label="이전 페이지" onClick={()=>{window.getSelection()?.removeAllRanges();onPrevious();}}><ChevronLeft size={18}/></button>
  <span role="status">{text?`${text.length} / ${SHARE_QUOTE_LIMIT}`:'대사를 드래그하세요'}</span>
  <button className="reader-icon-button" aria-label="다음 페이지" onClick={()=>{window.getSelection()?.removeAllRanges();onNext();}}><ChevronRight size={18}/></button>
  <button className="reader-icon-button" title={tooLong?`${SHARE_QUOTE_LIMIT}자까지 선택하세요`:text?'선택한 대사 첨부':'대사 없이 공유'} aria-label={text?'선택한 대사 첨부':'대사 없이 공유'} disabled={tooLong} onClick={()=>onDone(text,text?pages:undefined)}><Check size={18}/></button>
  <button className="reader-icon-button" aria-label="대사 선택 취소" onClick={()=>onDone()}><X size={18}/></button>
 </div>;
}
