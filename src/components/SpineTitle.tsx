import {useEffect,useRef,useState} from 'react';

type Layout={length:number;cross:number;fontSize:number;lines:number};
export default function SpineTitle({title}:{title:string}){
 const root=useRef<HTMLSpanElement>(null);const text=useRef<HTMLElement>(null);const [layout,setLayout]=useState<Layout>({length:154,cross:34,fontSize:10,lines:2});
 useEffect(()=>{
  const element=root.current;if(!element)return;let active=true;const canvas=document.createElement('canvas');const context=canvas.getContext('2d');
  function measure(){
   if(!active||!element||!context)return;
   const length=Math.max(0,element.clientHeight-4);const cross=Math.max(0,element.clientWidth-2);if(!length||!cross)return;
   const computed=getComputedStyle(text.current??element);const spacing=parseFloat(computed.letterSpacing)||0;const characters=Array.from(title.replace(/\s+/g,' ').trim());
   let fontSize=10;let lines=Math.max(1,Math.min(2,Math.floor(cross/(10*1.12))));
   for(let size=22;size>=10;size--){
    const allowed=Math.max(1,Math.min(2,Math.floor(cross/(size*1.12))));if(size*1.12>cross)continue;
    context.font=`${computed.fontWeight} ${size}px ${computed.fontFamily}`;
    let count=1;let line='';let fits=true;
    for(const character of characters){const candidate=line+character;const width=context.measureText(candidate).width+Math.max(0,Array.from(candidate).length-1)*spacing;if(width>length){if(!line||++count>allowed){fits=false;break;}line=character;}else line=candidate;}
    if(fits){fontSize=size;lines=allowed;break;}
   }
   setLayout(previous=>previous.length===length&&previous.cross===cross&&previous.fontSize===fontSize&&previous.lines===lines?previous:{length,cross,fontSize,lines});
  }
  const observer=new ResizeObserver(measure);observer.observe(element);measure();
  void document.fonts.ready.then(measure);document.fonts.addEventListener('loadingdone',measure);
  return()=>{active=false;observer.disconnect();document.fonts.removeEventListener('loadingdone',measure);};
 },[title]);
 return <span ref={root} className="spine-title-zone" title={title}><span className="spine-title-rotator" style={{width:layout.length,height:layout.cross}}><strong ref={text} className="spine-title" style={{fontSize:layout.fontSize,WebkitLineClamp:layout.lines,maxHeight:`${layout.lines*1.12}em`}}>{title}</strong></span></span>;
}
