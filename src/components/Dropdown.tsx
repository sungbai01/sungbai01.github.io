import {useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import './dropdown.css';
export type DropdownOption={value:string;label:string;danger?:boolean;disabled?:boolean};
export default function Dropdown({label,value,options,onChange,disabled=false,compact=false,triggerContent,mode='listbox',open:controlledOpen,onOpenChange,minMenuWidth=0}:{label:string;value?:string;options:readonly DropdownOption[];onChange:(value:string)=>void;disabled?:boolean;compact?:boolean;triggerContent?:ReactNode;mode?:'listbox'|'menu';open?:boolean;onOpenChange?:(open:boolean)=>void;minMenuWidth?:number}){
 const id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const [localOpen,setLocalOpen]=useState(false),[visible,setVisible]=useState(false),[closing,setClosing]=useState(false),[page,setPage]=useState(0);
 const requested=(controlledOpen??localOpen)&&!disabled;const size=60;
 const [position,setPosition]=useState<{left:number;top:number;width:number;maxHeight:number}>();
 const changeOpen=(next:boolean)=>{if(controlledOpen===undefined)setLocalOpen(next);onOpenChange?.(next);};
 useLayoutEffect(()=>{if(requested){setPage(Math.floor(Math.max(0,options.findIndex(option=>option.value===value))/size));setVisible(true);setClosing(false);return;}if(!visible)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){setVisible(false);return;}setClosing(true);const timer=setTimeout(()=>{setVisible(false);setClosing(false);setPosition(undefined);},130);return()=>clearTimeout(timer);},[requested]);
 useLayoutEffect(()=>{
  if(!visible||!requested)return;const list=menu.current!,button=trigger.current!;list.showPopover();
  const place=()=>{const anchor=button.getBoundingClientRect(),dialog=button.closest('dialog')?.getBoundingClientRect(),view=visualViewport;
   const left=Math.max((view?.offsetLeft??0)+8,dialog?dialog.left+8:0),right=Math.min((view?.offsetLeft??0)+(view?.width??innerWidth)-8,dialog?dialog.right-8:Infinity);
   const top=Math.max((view?.offsetTop??0)+8,dialog?dialog.top+8:0),bottom=Math.min((view?.offsetTop??0)+(view?.height??innerHeight)-8,dialog?dialog.bottom-8:Infinity);
   if(anchor.bottom<top||anchor.top>bottom){changeOpen(false);return;}
   const width=Math.max(0,Math.min(Math.max(anchor.width,minMenuWidth),right-left));
   // Measure at the final width before choosing direction; short lists use their real height.
   list.style.width=`${width}px`;const desired=Math.min(180,list.scrollHeight+list.offsetHeight-list.clientHeight);
   const below=Math.max(0,bottom-anchor.bottom-6),above=Math.max(0,anchor.top-top-6),upward=below<desired&&above>below;
   const height=Math.min(desired,upward?above:below);const next={left:Math.max(left,Math.min(anchor.left,right-width)),top:upward?anchor.top-6-height:anchor.bottom+6,width,maxHeight:height};
   setPosition(previous=>previous&&Object.keys(next).every(key=>previous[key as keyof typeof next]===next[key as keyof typeof next])?previous:next);
  };
  place();const observer=new ResizeObserver(place);observer.observe(button);observer.observe(list);const dialog=button.closest('dialog');if(dialog)observer.observe(dialog);
  const scroll=(event:Event)=>{if(!list.contains(event.target as Node))place();};window.addEventListener('scroll',scroll,true);window.addEventListener('resize',place);visualViewport?.addEventListener('resize',place);visualViewport?.addEventListener('scroll',place);
  return()=>{observer.disconnect();window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',place);visualViewport?.removeEventListener('resize',place);visualViewport?.removeEventListener('scroll',place);};
 },[visible,requested,page,options.length,minMenuWidth]);
 useLayoutEffect(()=>{if(!visible||!requested||!position)return;const list=menu.current;focus(list?.querySelector<HTMLButtonElement>('[aria-selected=true], [aria-current=true]')??list?.querySelector<HTMLButtonElement>('.dropdown-option:not(:disabled)')??undefined);},[visible,requested,page,!!position]);
 useEffect(()=>{if(!requested)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))changeOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[requested]);
 const focus=(item:HTMLButtonElement|undefined)=>{if(!item)return;item.focus({preventScroll:true});const list=menu.current!;if(item.offsetTop<list.scrollTop)list.scrollTop=item.offsetTop;else if(item.offsetTop+item.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=item.offsetTop+item.offsetHeight-list.clientHeight;};
 return <div className={`dropdown-control${compact?' dropdown-compact':''}`} ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))changeOpen(false);}} onKeyDown={event=>{
  if(event.key==='Escape'&&requested){event.preventDefault();event.stopPropagation();changeOpen(false);trigger.current?.focus({preventScroll:true});}
  if(requested&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const items=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('.dropdown-option:not(:disabled)')??[]),index=items.indexOf(document.activeElement as HTMLButtonElement);focus(items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]);}
 }}>
 <button ref={trigger} type="button" className={`dropdown-trigger${triggerContent?' dropdown-icon-trigger':''}`} aria-label={label} title={triggerContent?label:undefined} disabled={disabled} aria-haspopup={mode} aria-expanded={requested} aria-controls={id} onClick={event=>{event.stopPropagation();changeOpen(!requested);}} onKeyDown={event=>{if(!requested&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();changeOpen(true);}}}>{triggerContent??<><span>{options.find(option=>option.value===value)?.label??'없음'}</span><ChevronDown size={14}/></>}</button>
 {visible&&<div ref={menu} id={id} popover="manual" className="dropdown-options" role={mode} aria-label={`${label} 목록`} data-closing={closing||undefined} inert={!requested||undefined} style={position?{...position,visibility:'visible'}:{visibility:'hidden'}}>
 {options.slice(page*size,(page+1)*size).map(option=><button key={option.value} type="button" className="dropdown-option" role={mode==='menu'?'menuitem':'option'} aria-selected={mode==='listbox'?value===option.value:undefined} aria-current={mode==='menu'&&value===option.value?'true':undefined} data-danger={option.danger||undefined} disabled={option.disabled} onClick={()=>{changeOpen(false);trigger.current?.focus({preventScroll:true});onChange(option.value);}}><span>{option.label}</span>{mode==='listbox'&&value===option.value&&<Check size={14}/>}</button>)}
 {options.length>size&&<div className="dropdown-pages" role="group" aria-label="목록 페이지"><button type="button" disabled={page===0} onClick={()=>setPage(index=>index-1)}>이전 목록</button><span>{page+1} / {Math.ceil(options.length/size)}</span><button type="button" disabled={(page+1)*size>=options.length} onClick={()=>setPage(index=>index+1)}>다음 목록</button></div>}
 </div>}
 </div>;
}
