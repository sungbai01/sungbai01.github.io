import {useLayoutEffect,useRef,useState} from 'react';

/** Upright word wrapping, up to three bottom-aligned columns. */
export default function BookmarkTitle({title,className}:{title:string;className:string}){
 const ref=useRef<HTMLElement>(null);
 const [layout,setLayout]=useState({font:14,lines:1,text:title});
 useLayoutEffect(()=>{
  const element=ref.current;if(!element)return;let active=true;
  const update=()=>{
   if(!active||element.clientHeight<=0)return;
   const style=getComputedStyle(element),one=parseFloat(style.getPropertyValue('--bookmark-title-one'))||18,two=parseFloat(style.getPropertyValue('--bookmark-title-two'))||14;
   const probe=element.cloneNode(false) as HTMLElement;probe.removeAttribute('title');probe.setAttribute('aria-hidden','true');Object.assign(probe.style,{position:'absolute',visibility:'hidden',pointerEvents:'none',height:`${element.clientHeight}px`,maxHeight:'none',maxWidth:'none',transition:'none'});element.parentElement!.append(probe);
   const fits=(text:string,font:number,lines:number)=>{probe.style.fontSize=`${font}px`;probe.style.width=`${font*1.4*lines}px`;probe.textContent=text;return probe.scrollWidth<=probe.clientWidth+1&&probe.scrollHeight<=probe.clientHeight+1;};
   const full=title.trim();let font=one,lines=1,text=full;
   if(!fits(full,font,lines)){font=two;lines=fits(full,font,2)?2:3;if(!fits(full,font,lines)){const glyphs=Array.from(full);let low=0,high=glyphs.length;while(low<high){const middle=Math.ceil((low+high)/2);if(fits(glyphs.slice(0,middle).join('')+'…',font,lines))low=middle;else high=middle-1;}text=glyphs.slice(0,low).join('')+'…';}}
   probe.remove();setLayout(previous=>previous.font===font&&previous.lines===lines&&previous.text===text?previous:{font,lines,text});
  };
  update();const observer=new ResizeObserver(update);observer.observe(element);void document.fonts.ready.then(update);document.fonts.addEventListener('loadingdone',update);
  return()=>{active=false;observer.disconnect();document.fonts.removeEventListener('loadingdone',update);};
 },[title]);
 return <strong ref={ref} className={className} data-lines={layout.lines} title={title} style={{fontSize:layout.font,width:`${layout.font*1.4*layout.lines}px`,maxWidth:'none',textAlign:'end',wordBreak:'keep-all',overflowWrap:'break-word'}}>{layout.text}</strong>;
}
