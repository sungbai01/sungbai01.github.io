import {useEffect,useLayoutEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import './author-picker.css';

// Display the current catalog in reverse order, newest first.
export const AUTHOR_CHOICES=['Gemini 4 Argon','Opus 5.5','Gemini 3.8 Flash','Gemini 3.7 Flash','GPT 5.6-Sol','GLM 5.2','Fable','Deepseek V4 Pro','GPT 5.5','Kimi 2.6','GPT 5.4','Opus 4.6','GPT 5.1'] as const;

export default function AuthorPicker({value,onChange,disabled=false,label='모델',choices=AUTHOR_CHOICES.map(choice=>({value:choice,label:choice})),allowCustom=true,triggerLabel}:{value:string;onChange:(value:string)=>void;disabled?:boolean;label?:string;choices?:readonly {value:string;label:string}[];allowCustom?:boolean;triggerLabel?:string}){
 const known=(value:string)=>choices.some(choice=>choice.value===value);
 const [open,setOpen]=useState(false);const [custom,setCustom]=useState(allowCustom&&!!value&&!known(value));const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const input=useRef<HTMLInputElement>(null);const id=useId();
 const menu=useRef<HTMLDivElement>(null);const [position,setPosition]=useState<{left:number;top:number;width:number;maxHeight:number}|null>(null);
 const options=[{value:'',label:'선택 안 함'},...choices,...(allowCustom?[{value:'__other__',label:'기타'}]:[])];
 function focusOption(item:HTMLButtonElement|undefined){
  if(!item)return;item.focus({preventScroll:true});const list=menu.current;if(!list)return;
  if(item.offsetTop<list.scrollTop)list.scrollTop=item.offsetTop;
  else if(item.offsetTop+item.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=item.offsetTop+item.offsetHeight-list.clientHeight;
 }
 useLayoutEffect(()=>{
  if(!open||disabled)return;
  function place(){
   const button=trigger.current;if(!button)return;const anchor=button.getBoundingClientRect();const dialog=button.closest('dialog')?.getBoundingClientRect();const viewport=window.visualViewport;
   const viewLeft=viewport?.offsetLeft??0;const viewTop=viewport?.offsetTop??0;
   const left=Math.max(viewLeft+8,dialog?dialog.left+8:viewLeft+8);const right=Math.min(viewLeft+(viewport?.width??innerWidth)-8,dialog?dialog.right-8:innerWidth-8);
   const top=Math.max(viewTop+8,dialog?dialog.top+8:viewTop+8);const bottom=Math.min(viewTop+(viewport?.height??innerHeight)-8,dialog?dialog.bottom-8:innerHeight-8);
   if(anchor.bottom<top||anchor.top>bottom){setOpen(false);return;}
   const below=Math.max(0,bottom-anchor.bottom-6);const above=Math.max(0,anchor.top-top-6);const upward=below<180&&above>below;
   const maxHeight=Math.min(180,upward?above:below);const width=Math.max(0,Math.min(anchor.width,right-left));
   const next={left:Math.max(left,Math.min(anchor.left,right-width)),top:upward?anchor.top-6-maxHeight:anchor.bottom+6,width,maxHeight};
   setPosition(previous=>previous&&Object.keys(next).every(key=>previous[key as keyof typeof next]===next[key as keyof typeof next])?previous:next);
  }
  const scroll=(event:Event)=>{if(!menu.current?.contains(event.target as Node))place();};const observer=new ResizeObserver(place);if(trigger.current)observer.observe(trigger.current);const dialog=trigger.current?.closest('dialog');if(dialog)observer.observe(dialog);
  place();window.addEventListener('resize',place);window.addEventListener('scroll',scroll,true);window.visualViewport?.addEventListener('resize',place);window.visualViewport?.addEventListener('scroll',place);
  return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true);window.visualViewport?.removeEventListener('resize',place);window.visualViewport?.removeEventListener('scroll',place);};
 },[open,disabled]);
 useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);focusOption(menu.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')??undefined);return()=>document.removeEventListener('pointerdown',close);},[open]);

 function keys(event:KeyboardEvent<HTMLDivElement>){
  if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus({preventScroll:true});}
  if(open&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role=option]'));const index=items.indexOf(document.activeElement as HTMLButtonElement);focusOption(items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]);}
 }
 return <div className="field author-picker" ref={root} onKeyDown={keys} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}}><span id={`${id}-label`}>{label}</span><button ref={trigger} type="button" className="author-picker-trigger" disabled={disabled} aria-label={triggerLabel} aria-labelledby={triggerLabel?undefined:`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} onClick={()=>setOpen(previous=>!previous)} onKeyDown={event=>{if(!open&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();setOpen(true);}}}><span id={`${id}-value`}>{custom?'기타':choices.find(choice=>choice.value===value)?.label||value||'선택 안 함'}</span><ChevronDown size={14}/></button>{open&&!disabled&&<div ref={menu} id={`${id}-list`} className="author-picker-options" style={position?{...position,visibility:'visible'}:{visibility:'hidden'}} role="listbox" aria-labelledby={`${id}-label`}>{options.map(option=><button key={option.value} type="button" role="option" aria-selected={option.value==='__other__'?custom:!custom&&value===option.value} onClick={()=>{const other=option.value==='__other__';setCustom(other);if(!other)onChange(option.value);else if(known(value))onChange('');setOpen(false);if(other)requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));else trigger.current?.focus({preventScroll:true});}}><span>{option.label}</span>{(option.value==='__other__'?custom:!custom&&value===option.value)&&<Check size={14}/>}</button>)}</div>}{custom&&<input ref={input} className="author-picker-custom" aria-label="모델 직접 입력" placeholder="모델 이름" maxLength={160} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>}</div>;
}
