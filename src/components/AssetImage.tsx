import {useEffect,useRef,useState} from 'react';
import {rasterAssetCrop} from '../lib/assetCrop';

/** Use the actual CSS box, not a transformed flip clone, for raster density. */
export default function AssetImage({src,alt='',className}:{src:string;alt?:string;className?:string}){
 const ref=useRef<HTMLImageElement>(null);
 const [crop,setCrop]=useState<{source:string;value:string}|null>(null);
 useEffect(()=>{
  const element=ref.current;if(!element)return;
  let active=true,revision=0,last='';
  const update=()=>{
   const width=element.clientWidth,height=element.clientHeight;
   if(!width||!height)return;
   const key=`${width}x${height}:${window.devicePixelRatio}`;if(last===key)return;last=key;
   const task=++revision;
   void rasterAssetCrop(src,width,height).then(result=>{if(active&&task===revision)setCrop({source:src,value:result.src});});
  };
  update();const observer=new ResizeObserver(update);observer.observe(element);window.addEventListener('resize',update);
  return()=>{active=false;observer.disconnect();window.removeEventListener('resize',update);};
 },[src]);
 return <img ref={ref} className={className} src={crop?.source===src?crop.value:src} alt={alt} draggable={false}/>;
}
