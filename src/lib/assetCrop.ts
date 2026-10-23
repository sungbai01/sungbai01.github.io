import {prepareAssetPreview} from './assetPreview';
type Crop={src:string;width:number;height:number};
const cache=new Map<string,Map<string,Promise<Crop>>>();
const recent:{source:string;size:string}[]=[];

/** Lossless, device-pixel-sized crop; the original remains the preview source. */
export function squareAssetCrop(source:string,cssSize:number):Promise<Crop>{return rasterAssetCrop(source,cssSize,cssSize);}
export function rasterAssetCrop(source:string,cssWidth:number,cssHeight:number):Promise<Crop>{
 const dpr=Math.max(1,window.devicePixelRatio||1);
 const targetWidth=Math.max(1,Math.ceil(cssWidth*dpr)),targetHeight=Math.max(1,Math.ceil(cssHeight*dpr));
 const size=`${targetWidth}x${targetHeight}`;
 let sizes=cache.get(source);if(!sizes){sizes=new Map();cache.set(source,sizes);}
 const existing=sizes.get(size);if(existing)return existing;
 const pending=new Promise<Crop>(resolve=>{
  const image=new Image();image.decoding='async';let preparedUrl='';const release=()=>{if(preparedUrl)URL.revokeObjectURL(preparedUrl);};
  if(/^https?:/i.test(source))image.crossOrigin='anonymous';
  image.onerror=()=>{release();resolve({src:source,width:0,height:0});};
  image.onload=()=>{
   release();
   const width=image.naturalWidth,height=image.naturalHeight;
   try{
    // Preserve animated assets rather than freezing their first frame.
    const comma=source.indexOf(',');
    let header='';
    if(source.startsWith('data:')&&comma>=0){const encoded=source.slice(comma+1,comma+1+4096).replace(/\s/g,'');try{header=atob(encoded.slice(0,Math.floor(encoded.length/4)*4));}catch{}}
    if(/^data:image\/gif/i.test(source)||/\.gif(?:[?#]|$)/i.test(source)||/ANIM|acTL|avis/.test(header)){resolve({src:source,width,height});return;}
    const ratio=targetWidth/targetHeight;
    const cropWidth=Math.min(width,height*ratio),cropHeight=cropWidth/ratio;
    const scale=Math.min(1,Math.max(targetWidth/cropWidth,targetHeight/cropHeight,512/Math.max(cropWidth,cropHeight)));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(cropWidth*scale));canvas.height=Math.max(1,Math.round(cropHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('No canvas');
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(image,(width-cropWidth)/2,0,cropWidth,cropHeight,0,0,canvas.width,canvas.height);
    resolve({src:canvas.toDataURL('image/png'),width,height});
   }catch{resolve({src:source,width,height});}
  };
  if(/^https?:/i.test(source))void prepareAssetPreview(source).then(blob=>{preparedUrl=URL.createObjectURL(blob);image.src=preparedUrl;},()=>{image.src=source;});else image.src=source;
 });
 sizes.set(size,pending);recent.push({source,size});
 while(recent.length>24){const oldest=recent.shift()!;const entries=cache.get(oldest.source);entries?.delete(oldest.size);if(!entries?.size)cache.delete(oldest.source);}
 return pending;
}
