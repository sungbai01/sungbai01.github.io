import {useLayoutEffect,useRef,useState} from 'react';

/** Upright glyphs, with two deliberate font sizes and bottom aligned columns. */
export default function BookmarkTitle({title,className}:{title:string;className:string}){
 const ref=useRef<HTMLElement>(null);
 const [layout,setLayout]=useState({font:14,lines:1,text:title});
 useLayoutEffect(()=>{
  const element=ref.current;if(!element)return;
  const update=()=>{
   if(element.clientHeight<=0)return;
   const style=getComputedStyle(element);
   const one=parseFloat(style.getPropertyValue('--bookmark-title-one'))||18;
   const two=parseFloat(style.getPropertyValue('--bookmark-title-two'))||14;
   const glyphs=Array.from(title.trim());
   const fits=glyphs.length<=Math.max(1,Math.floor(element.clientHeight/one));
   const font=fits?one:two,lines=fits?1:2;
   const capacity=Math.max(1,Math.floor(element.clientHeight/font))*lines;
   const text=glyphs.length>capacity?glyphs.slice(0,Math.max(0,capacity-1)).join('')+'…':title.trim();
   setLayout(previous=>previous.font===font&&previous.lines===lines&&previous.text===text?previous:{font,lines,text});
  };
  update();const observer=new ResizeObserver(update);observer.observe(element);
  return()=>observer.disconnect();
 },[title]);
 return <strong ref={ref} className={className} data-lines={layout.lines} title={title} style={{fontSize:layout.font,width:`${layout.font*1.4*layout.lines}px`,textAlign:'end'}}>{layout.text}</strong>;
}
