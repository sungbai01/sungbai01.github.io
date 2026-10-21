import {getAuthSession} from './auth';
import type {Book} from './library';
import {extractAssetSegments} from './assets';
const apiBase=(import.meta.env.VITE_AUTH_API_URL as string|undefined)?.trim().replace(/\/+$/,'');
export type ShareInfo={id:string;updatedAt:number;cardUrl?:string|null};
export function shareUrl(id:string){return `${location.origin}${location.pathname}#/share/${id}`;}
export async function shareRequest(bookId:string,method='GET',signal?:AbortSignal,book?:Book):Promise<ShareInfo|null>{
 const session=getAuthSession();if(!session)throw new Error('공유하려면 Google 로그인이 필요해요.');
 if(!apiBase)throw new Error('공유 서버에 연결하지 못했어요.');
 const response=await fetch(`${apiBase}/library/books/${encodeURIComponent(bookId)}/share`,{method,credentials:'omit',cache:'no-store',signal,headers:{Authorization:`Bearer ${session.token}`,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({bookmarkStyle:book?.bookmarkStyle??'normal',references:book?book.messages.flatMap((message,index)=>extractAssetSegments(message.content,book.assets??[],book.imageRules??[]).flatMap(segment=>segment.type==='asset'?[{message:index,start:segment.start,end:segment.end,name:segment.asset.name}]:[])):[]})}:{})});
 const result=await response.json() as {share?:ShareInfo|null;error?:string};
 if(!response.ok)throw new Error(result.error||'공유를 완료하지 못했어요.');
 if(getAuthSession()?.user.id!==session.user.id)throw new Error('계정이 변경되었어요.');
 return result.share??null;
}
export async function loadSharedBook(id:string,signal:AbortSignal):Promise<Book>{
 if(!apiBase||! /^[A-Za-z0-9_-]{43}$/.test(id))throw new Error('공유 주소가 올바르지 않아요.');
 const response=await fetch(`${apiBase}/shares/${id}`,{credentials:'omit',cache:'no-store',signal});
 const result=await response.json() as {book?:Book;error?:string};
 if(!response.ok||!result.book)throw new Error(result.error||'공유한 책을 불러오지 못했어요.');
 return result.book;
}
export function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function cardHtml(book:Book,url:string,imageUrl:string){
 const image=new URL(imageUrl);if(image.protocol!=='https:')throw new Error('HTTPS 이미지 주소를 입력해 주세요.');
 return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(image.href)}" alt="${escapeHtml(book.title)} · 책 읽기" width="720" style="max-width:100%;height:auto;"></a>`;
}

/** Portable raster card; hyperlink is supplied separately by the wrapping HTML. */
export async function makeShareCard(book:Book):Promise<Blob>{
 const selected=book.assets?.find(asset=>asset.id===book.shareCardAssetId);
 if(selected)return shareImageBlob(selected.src);
 await document.fonts.ready;
 const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=810;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('카드 이미지를 만들지 못했어요.');
 ctx.fillStyle='#f3f3f2';ctx.fillRect(0,0,1440,810);
 ctx.fillStyle=book.color;ctx.beginPath();ctx.roundRect(84,72,438,650,9);ctx.fill();
 ctx.fillStyle='#ffffff25';ctx.fillRect(98,78,3,638);
 ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='24px sans-serif';ctx.fillText(String(book.volumeNumber??1).padStart(2,'0'),303,675);
 const icon=book.characterIcon??book.assets?.find(a=>a.type==='icon')?.src;
 if(icon){try{
  const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{image.src='';reject(new Error('이미지 시간 초과'));},8000);image.onload=()=>{clearTimeout(timeout);resolve();};image.onerror=()=>{clearTimeout(timeout);reject(new Error('이미지 오류'));};image.src=icon;});
  const size=Math.min(image.naturalWidth,image.naturalHeight);ctx.drawImage(image,(image.naturalWidth-size)/2,0,size,size,127,220,352,352);
 }catch{/* Keep a plain cover when the source cannot be embedded. */}}
 const wrap=(text:string,width:number,maxLines:number)=>{const lines:string[]=[];let line='';for(const char of text){if(ctx.measureText(line+char).width>width&&line){lines.push(line);line='';}line+=char;}if(line)lines.push(line);const cut=lines.slice(0,maxLines);if(lines.length>maxLines){let last=cut.at(-1)!;while(ctx.measureText(last+'…').width>width)last=last.slice(0,-1);cut[cut.length-1]=last+'…';}return cut;};
 const title=book.title.replace(/\s*·\s*\d+권\s*$/,'');
 ctx.font='30px "Gowun Batang",serif';wrap(title,342,2).forEach((line,i)=>ctx.fillText(line,303,133+i*45));
 ctx.textAlign='left';ctx.fillStyle='#208368';ctx.font='24px "Gowun Batang",serif';ctx.fillText('갈피',610,140);
 ctx.fillStyle='#21201c';ctx.font='48px "Gowun Batang",serif';wrap(title,725,3).forEach((line,i)=>ctx.fillText(line,610,272+i*73));
 ctx.fillStyle='#63635e';ctx.font='24px sans-serif';ctx.fillText((book.author?.trim()||'저자 모델 미상').slice(0,44),610,535);
 ctx.fillStyle='#d3d1cc';ctx.fillRect(610,585,700,1);
 ctx.fillStyle='#208368';ctx.font='28px sans-serif';ctx.fillText('책 읽기 →',610,665);
 ctx.textAlign='right';ctx.fillStyle='#63635e';ctx.font='20px sans-serif';ctx.fillText('GALPI · SHARED BOOK',1310,665);
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('카드를 저장하지 못했어요.')),'image/png'));
}

async function uploadShareMedia(book:Book,blob:Blob,name:string,role:'asset'|'icon'|'card'){
 const session=getAuthSession();if(!session||!apiBase)throw new Error('다시 로그인해 주세요.');
 const response=await fetch(`${apiBase}/library/books/${encodeURIComponent(book.id)}/share/images`,{method:'POST',credentials:'omit',cache:'no-store',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':blob.type,'X-Image-Name':encodeURIComponent(name),'X-Image-Role':role},body:blob});
 const result=await response.json() as {url?:string;error?:string};
 if(!response.ok||!result.url)throw new Error(result.error||'공유 이미지를 업로드하지 못했어요.');
 if(getAuthSession()?.user.id!==session.user.id)throw new Error('계정이 변경되었어요.');
 return result.url;
}
export async function uploadShareCard(book:Book,blob:Blob){return uploadShareMedia(book,blob,'share-card','card');}
async function shareImageBlob(src:string):Promise<Blob>{
 const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{image.src='';reject(new Error('이미지를 열지 못했어요.'));},10000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('이미지를 열지 못했어요.'));};image.src=src;});
 const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
 const context=canvas.getContext('2d');if(!context)throw new Error('이미지를 만들지 못했어요.');context.drawImage(image,0,0,canvas.width,canvas.height);
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('이미지를 만들지 못했어요.')),'image/webp',.9));
}
export function usedShareAssets(book:Book,includeBody=true){
 const used=new Map<string,NonNullable<Book['assets']>[number]>();
 if(includeBody)for(const message of book.messages)for(const segment of extractAssetSegments(message.content,book.assets??[],book.imageRules??[]))if(segment.type==='asset')used.set(segment.asset.name,segment.asset);
 const icon=book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;
 if(icon)used.set('__galpi_cover_icon__',{id:'cover-icon',name:'__galpi_cover_icon__',src:icon,type:'icon'});
 const mark=book.assets?.find(asset=>asset.id===book.bookmarkAssetId)?.src??icon;
 if(mark)used.set('__galpi_bookmark__',{id:'bookmark-image',name:'__galpi_bookmark__',src:mark,type:'asset'});
 return [...used.values()];
}
export async function uploadBookShareAssets(book:Book,onProgress:(done:number,total:number)=>void,includeBody=true){
 const assets=usedShareAssets(book,includeBody);if(assets.length>40)throw new Error('공유 이미지는 한 권에 40개까지 넣을 수 있어요.');
 let done=0;for(const asset of assets){const blob=await shareImageBlob(asset.src);await uploadShareMedia(book,blob,asset.name,asset.type==='icon'?'icon':'asset');onProgress(++done,assets.length);}
}
