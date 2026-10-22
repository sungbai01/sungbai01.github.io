import {useEffect,useRef,useState} from 'react';
import type {Book} from '../lib/library';

/** Position is a per-browser presentation preference; book/volume identities stay intact. */
export default function useShelfDrag(owner:string|null,enabled:boolean,onDelete:(id:string)=>void){
 const key=`galpi.shelf-order.v1:${owner??'guest'}`;
 const [order,setOrder]=useState<Record<string,string[]>>(()=>{try{const v=JSON.parse(localStorage.getItem(key)??'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}});
 const [preview,setPreview]=useState<{shelf:string;ids:string[]}|null>(null);
 const host=useRef<HTMLDivElement>(null);
 const latest=useRef({onDelete,order});latest.current={onDelete,order};
 useEffect(()=>{
  if(!enabled)return;
  let pending:ReturnType<typeof setTimeout>|undefined;
  let drag:{id:string;shelf:string;source:HTMLElement;ghost:HTMLElement;x:number;y:number;offsetX:number;offsetY:number;pointer:number;active:boolean;box:HTMLElement;ids:string[];slots:{x:number;y:number;width:number;height:number}[];index:number;valid:boolean;view:string}|null=null;
  let bin:HTMLDivElement|null=null,frame=0,suppressUntil=0;
  function finish(commit=false){
   clearTimeout(pending);cancelAnimationFrame(frame);if(!drag)return;
   const d=drag;drag=null;
   if(d.active){suppressUntil=performance.now()+400;const deleting=bin?.dataset.over==='true';
    if(commit&&deleting)latest.current.onDelete(d.id);
    else if(commit&&d.valid){const ids=d.ids.filter(id=>id!==d.id);ids.splice(d.index,0,d.id);const next={...latest.current.order,[d.shelf]:ids};latest.current.order=next;setOrder(next);try{localStorage.setItem(key,JSON.stringify(next));}catch{}}
   }
   setPreview(null);d.source.removeAttribute('data-dragging');d.ghost.remove();bin?.remove();bin=null;document.body.classList.remove('shelf-drag-active');
  }
  function tick(){if(!drag?.active)return;const d=drag;
   const speed=d.y<70?-12:d.y>innerHeight-80?12:0;if(speed)window.scrollBy(0,speed);
   const shelf=d.source.closest<HTMLElement>('.shelf-box');if(shelf){const r=shelf.getBoundingClientRect();if(d.y>=r.top&&d.y<=r.bottom)shelf.scrollLeft+=d.x<r.left+35?-10:d.x>r.right-35?10:0;}
   updateTarget();frame=requestAnimationFrame(tick);
  }
  function activate(){if(!drag)return;const d=drag;d.active=true;document.body.append(d.ghost);d.source.dataset.dragging='true';document.body.classList.add('shelf-drag-active');
   bin=document.createElement('div');bin.className='shelf-trash-target';bin.setAttribute('aria-label','책 삭제');bin.innerHTML='<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';document.body.append(bin);tick();
  }
  function down(e:PointerEvent){if(e.button!==0||drag)return;const target=e.target as HTMLElement;if(!host.current?.contains(target))return;const source=target.closest<HTMLElement>('[data-drag-book]');if(!source||target.closest('.book-menu-wrap'))return;
   const box=source.closest<HTMLElement>('.shelf-box')!,bounds=box.getBoundingClientRect();
   const items=Array.from(box.querySelectorAll<HTMLElement>('[data-drag-book]'));
   const ids=items.map(item=>item.dataset.dragBook!);
   const slots=items.map(item=>{const r=item.getBoundingClientRect();return {x:r.left-bounds.left+box.scrollLeft,y:r.top-bounds.top+box.scrollTop,width:r.width,height:r.height};});
   const rect=source.getBoundingClientRect(),ghost=source.cloneNode(true) as HTMLElement;ghost.querySelectorAll('.book-menu-wrap').forEach(el=>el.remove());ghost.removeAttribute('data-drag-book');ghost.classList.add('shelf-drag-ghost');Object.assign(ghost.style,{width:`${rect.width}px`,height:`${rect.height}px`,left:`${rect.left}px`,top:`${rect.top}px`});ghost.setAttribute('aria-hidden','true');
   for(const selector of ['.book-stage','.book-spine']){const original=source.querySelector<HTMLElement>(selector),copy=ghost.querySelector<HTMLElement>(selector);if(original&&copy){const style=getComputedStyle(original);copy.style.height=style.height;copy.style.padding=style.padding;}}
   const computed=getComputedStyle(source);for(const name of ['--shelf-book-height','--cover-stage-height','--display-stage'])ghost.style.setProperty(name,computed.getPropertyValue(name));
   drag={id:source.dataset.dragBook!,shelf:source.closest<HTMLElement>('.series-shelf')!.dataset.seriesId!,source,ghost,x:e.clientX,y:e.clientY,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top,pointer:e.pointerId,active:false,box,ids,slots,index:ids.indexOf(source.dataset.dragBook!),valid:false,view:box.dataset.shelfView!};
   if(e.pointerType!=='mouse')pending=setTimeout(activate,360);
  }
  function move(e:PointerEvent){if(!drag||e.pointerId!==drag.pointer)return;const d=drag;
   if(!d.active){if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<7)return;if(e.pointerType!=='mouse'){finish();return;}activate();}
   e.preventDefault();d.x=e.clientX;d.y=e.clientY;d.ghost.style.left=`${d.x-d.offsetX}px`;d.ghost.style.top=`${d.y-d.offsetY}px`;
   updateTarget();
  }
  function updateTarget(){
   if(!drag?.active||!bin)return;const d=drag;
   if(d.box.dataset.shelfView!==d.view){finish();return;}
   const r=bin.getBoundingClientRect(),over=d.x>=r.left&&d.x<=r.right&&d.y>=r.top&&d.y<=r.bottom;
   bin.dataset.over=String(over);d.ghost.dataset.trash=String(over);
   const bounds=d.box.getBoundingClientRect();
   const inside=!over&&d.x>=bounds.left&&d.x<=bounds.right&&d.y>=bounds.top&&d.y<=bounds.bottom;
   if(!inside){if(d.valid){d.valid=false;setPreview(null);}return;}
   // Use stationary layout slots, not the animated books under the pointer.
   // This keeps an open insertion gap from oscillating as its neighbors move.
   const x=d.x-bounds.left+d.box.scrollLeft,y=d.y-bounds.top+d.box.scrollTop;
   let index=d.index,distance=Infinity;
   d.slots.forEach((slot,i)=>{const dx=x-(slot.x+slot.width/2),dy=y-(slot.y+slot.height/2);const score=dx*dx+dy*dy;if(score<distance){distance=score;index=i;}});
   if(d.valid&&d.index===index)return;
   d.valid=true;d.index=index;const ids=d.ids.filter(id=>id!==d.id);ids.splice(index,0,d.id);setPreview({shelf:d.shelf,ids});
  }

  const up=(e:PointerEvent)=>{if(drag?.pointer===e.pointerId)finish(true);};
  const cancel=()=>finish();const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')finish();};
  const click=(e:MouseEvent)=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopPropagation();}};
  const native=(e:Event)=>{if(host.current?.contains(e.target as Node))e.preventDefault();};
  const touchMove=(e:TouchEvent)=>{if(drag?.active)e.preventDefault();};
  document.addEventListener('touchmove',touchMove,{passive:false});document.addEventListener('pointerdown',down);document.addEventListener('dragstart',native);document.addEventListener('contextmenu',native);document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);document.addEventListener('click',click,true);document.addEventListener('keydown',escape);window.addEventListener('blur',cancel);
  return()=>{finish();document.removeEventListener('touchmove',touchMove);document.removeEventListener('pointerdown',down);document.removeEventListener('dragstart',native);document.removeEventListener('contextmenu',native);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);document.removeEventListener('click',click,true);document.removeEventListener('keydown',escape);window.removeEventListener('blur',cancel);};
 },[enabled,key]);
 return {host,reset:()=>{setOrder({});try{localStorage.removeItem(key);}catch{}},ordered:(shelf:string,books:Book[])=>{const ids=preview?.shelf===shelf?preview.ids:Array.isArray(order[shelf])?order[shelf]:[];const rank=new Map(ids.map((id,index)=>[id,index]));return [...books].sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));}};
}
