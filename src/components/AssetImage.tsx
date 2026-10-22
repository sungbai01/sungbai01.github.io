import {useEffect,useRef,useState} from 'react';
import {rasterAssetCrop} from '../lib/assetCrop';

/** Use the actual CSS box, not a transformed flip clone, for raster density. */
export default function AssetImage({src,alt='',className,resolutionScale=1,skeleton=false}:{src:string;alt?:string;className?:string;resolutionScale?:number;skeleton?:boolean}){
 const ref=useRef<HTMLImageElement>(null);
 const [settled,setSettled]=useState<string>();
 useEffect(()=>{if(ref.current?.complete)setSettled(src);},[src]);
 const [crop,setCrop]=useState<{source:string;value:string}|null>(null);
 useEffect(()=>{
  const element=ref.current;if(!element)return;
  let active=true,revision=0,last='';
  const update=()=>{
   const width=element.clientWidth,height=element.clientHeight;
   if(!width||!height)return;
   const key=`${width}x${height}:${window.devicePixelRatio}`;if(last===key)return;last=key;
   const task=++revision;
   void rasterAssetCrop(src,width*resolutionScale,height*resolutionScale).then(result=>{if(active&&task===revision)setCrop({source:src,value:result.src});});
  };
  update();const observer=new ResizeObserver(update);observer.observe(element);window.addEventListener('resize',update);
  return()=>{active=false;observer.disconnect();window.removeEventListener('resize',update);};
 },[src,resolutionScale]);
 return <img ref={ref} className={[className,skeleton&&settled!==src?'skeleton-fill asset-image-loading':''].filter(Boolean).join(' ')} aria-busy={skeleton&&settled!==src||undefined} onLoad={()=>setSettled(src)} onError={()=>setSettled(src)} src={crop?.source===src?crop.value:src} alt={alt} draggable={false}/>;
}
