type Crop={src:string;width:number;height:number};
const cache=new Map<string,Map<number,Promise<Crop>>>();
const recent:{source:string;size:number}[]=[];

/** Lossless, device-pixel-sized crop; the original remains the preview source. */
export function squareAssetCrop(source:string,cssSize:number):Promise<Crop>{
 const size=Math.max(1,Math.ceil(cssSize*Math.max(1,window.devicePixelRatio||1)));
 let sizes=cache.get(source);if(!sizes){sizes=new Map();cache.set(source,sizes);}
 const existing=sizes.get(size);if(existing)return existing;
 const pending=new Promise<Crop>(resolve=>{
  const image=new Image();image.decoding='async';
  if(/^https?:/i.test(source))image.crossOrigin='anonymous';
  image.onerror=()=>resolve({src:source,width:0,height:0});
  image.onload=()=>{
   const width=image.naturalWidth,height=image.naturalHeight;
   try{
    // Preserve animated assets rather than freezing their first frame.
    const comma=source.indexOf(',');
    let header='';
    if(source.startsWith('data:')&&comma>=0){const encoded=source.slice(comma+1,comma+1+4096).replace(/\s/g,'');try{header=atob(encoded.slice(0,Math.floor(encoded.length/4)*4));}catch{}}
    if(/^data:image\/gif/i.test(source)||/\.gif(?:[?#]|$)/i.test(source)||/ANIM|acTL|avis/.test(header)){resolve({src:source,width,height});return;}
    const side=Math.min(width,height),pixels=Math.min(side,Math.max(512,size));
    const canvas=document.createElement('canvas');canvas.width=pixels;canvas.height=pixels;
    const context=canvas.getContext('2d');if(!context)throw new Error('No canvas');
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(image,(width-side)/2,0,side,side,0,0,pixels,pixels);
    resolve({src:canvas.toDataURL('image/png'),width,height});
   }catch{resolve({src:source,width,height});}
  };
  image.src=source;
 });
 sizes.set(size,pending);recent.push({source,size});
 while(recent.length>24){const oldest=recent.shift()!;const entries=cache.get(oldest.source);entries?.delete(oldest.size);if(!entries?.size)cache.delete(oldest.source);}
 return pending;
}
