import {useEffect,useRef,useState} from 'react';

type Layout={length:number;cross:number;lines:1|2;textWidth:number};
const SPINE_SINGLE=20;const SPINE_DOUBLE=14;
export default function SpineTitle({title}:{title:string}){
 const root=useRef<HTMLSpanElement>(null);const text=useRef<HTMLElement>(null);const [layout,setLayout]=useState<Layout>({length:154,cross:34,lines:2,textWidth:154});
 useEffect(()=>{
  const element=root.current;if(!element)return;let active=true;const context=document.createElement('canvas').getContext('2d');
  function measure(){
   if(!active||!element||!context)return;
   const length=Math.max(0,element.clientHeight-4);const cross=Math.max(0,element.clientWidth-2);if(!length||!cross)return;
   const computed=getComputedStyle(text.current??element);const spacing=parseFloat(computed.letterSpacing)||0;const label=title.replace(/\s+/g,' ').trim();
   const width=(size:number)=>{context!.font=`${computed.fontWeight} ${size}px ${computed.fontFamily}`;return context!.measureText(label).width+Math.max(0,Array.from(label).length-1)*spacing;};
   const lines:1|2=width(SPINE_SINGLE)<=length?1:2;const textWidth=Math.min(length,Math.ceil(width(lines===1?SPINE_SINGLE:SPINE_DOUBLE))+1);
   setLayout(previous=>previous.length===length&&previous.cross===cross&&previous.lines===lines&&previous.textWidth===textWidth?previous:{length,cross,lines,textWidth});
  }
  const observer=new ResizeObserver(measure);observer.observe(element);measure();void document.fonts.ready.then(measure);document.fonts.addEventListener('loadingdone',measure);
  return()=>{active=false;observer.disconnect();document.fonts.removeEventListener('loadingdone',measure);};
 },[title]);
 return <span ref={root} className="spine-title-zone" title={title}><span className="spine-title-rotator" style={{width:layout.length,height:layout.cross}}><strong ref={text} className="spine-title" data-title-lines={layout.lines} style={{width:layout.textWidth,fontSize:layout.lines===1?SPINE_SINGLE:SPINE_DOUBLE,WebkitLineClamp:layout.lines,maxHeight:`${layout.lines*1.12}em`}}>{title}</strong></span></span>;
}

export function CoverTitle({title,small=false}:{title:string;small?:boolean}){
 const root=useRef<HTMLDivElement>(null);const text=useRef<HTMLHeadingElement>(null);const [lines,setLines]=useState<1|2>(2);const single=small?9:16;const double=small?8:13;
 useEffect(()=>{
  const element=root.current;if(!element)return;let active=true;const context=document.createElement('canvas').getContext('2d');
  function measure(){if(!active||!element||!context||!element.clientWidth)return;const computed=getComputedStyle(text.current??element);context.font=`${computed.fontWeight} ${single}px ${computed.fontFamily}`;const label=title.replace(/\s+/g,' ').trim();const spacing=parseFloat(computed.letterSpacing)||0;setLines(context.measureText(label).width+Math.max(0,Array.from(label).length-1)*spacing<=element.clientWidth?1:2);}
  const observer=new ResizeObserver(measure);observer.observe(element);measure();void document.fonts.ready.then(measure);document.fonts.addEventListener('loadingdone',measure);
  return()=>{active=false;observer.disconnect();document.fonts.removeEventListener('loadingdone',measure);};
 },[title,single]);
 return <div ref={root} className="cover-title-zone"><h3 ref={text} data-title-lines={lines} style={{fontSize:lines===1?single:double,WebkitLineClamp:lines,maxHeight:`${lines*1.1}em`}}>{title}</h3></div>;
}
