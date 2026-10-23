import {shareSnapshot,snapshotHash} from '../../shared/shareSnapshot';
import type {ShareCardLayout} from '../../shared/shareCard';
import {bookAuthor} from './bookAuthor';
import {beginSkeletonTask} from './loadingActivity';
import {getAuthSession} from './auth';
import type {Book} from './library';
import {resolveDisplayImageReferences} from './displayRules';
import {extractAssetSegments} from './assets';
const apiBase=(import.meta.env.VITE_AUTH_API_URL as string|undefined)?.trim().replace(/\/+$/,'');
export const SHARES_CHANGED='galpi:shares-changed';
export async function getActiveShareCount(signal?:AbortSignal):Promise<number>{
 const session=getAuthSession();if(!session||!apiBase)throw new Error('로그인이 필요해요.');
 const response=await fetch(`${apiBase}/library/shares?count=1`,{credentials:'omit',cache:'no-store',signal,headers:{Authorization:`Bearer ${session.token}`}});
 const result=await response.json();if(!response.ok||getAuthSession()?.user.id!==session.user.id||!Number.isSafeInteger(result.activeCount)||result.activeCount<0)throw new Error('공유 개수를 불러오지 못했어요.');return result.activeCount;
}
export type SharedImage={name:string;role:string;hash:string|null;url:string};
export type ShareInfo={id:string;updatedAt:number;cardUrl?:string|null;contentHash?:string;card?:ShareCardLayout;credit?:Pick<Book,'author'|'aiModel'|'color'|'volumeNumber'|'displayPrompt'>;images?:SharedImage[]};
export function sharedCardImage(share:ShareInfo){
 const names=[share.card?.backgroundName,'__galpi_share_background__','__galpi_cover_icon__'].filter(Boolean);
 for(const name of names){const image=share.images?.find(image=>image.name===name&&image.role!=='card');if(image)return image.url;}
 return '';
}
export function shareUrl(id:string){return `${location.origin}${location.pathname}#/share/${id}`;}
export async function shareRequest(bookId:string,method='GET',signal?:AbortSignal,book?:Book):Promise<ShareInfo|null>{
 const session=getAuthSession();if(!session)throw new Error('공유하려면 Google 로그인이 필요해요.');
 if(!apiBase)throw new Error('공유 서버에 연결하지 못했어요.');
 if(book&&method==='POST')book={...book,imageReferences:await resolveDisplayImageReferences(book)};
 const response=await fetch(`${apiBase}/library/books/${encodeURIComponent(bookId)}/share`,{method,credentials:'omit',cache:'no-store',signal,headers:{Authorization:`Bearer ${session.token}`,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({bookmarkStyle:book?.bookmarkStyle??'normal',references:book?book.messages.flatMap((message,index)=>extractAssetSegments(message.content,book.assets??[],book.imageRules??[],book.imageReferences?.filter(reference=>reference.message===index)).flatMap(segment=>segment.type==='asset'?[{message:index,start:segment.start,end:segment.end,name:segment.asset.name}]:[])):[]})}:{})});
 const result=await response.json() as {share?:ShareInfo|null;error?:string};
 if(!response.ok)throw new Error(result.error||'공유를 완료하지 못했어요.');
 if(getAuthSession()?.user.id!==session.user.id)throw new Error('계정이 변경되었어요.');
 if(method!=='GET')window.dispatchEvent(new Event(SHARES_CHANGED));
 return result.share??null;
}
export async function loadSharedBook(id:string,signal:AbortSignal):Promise<Book>{
 if(!apiBase||! /^[A-Za-z0-9_-]{43}$/.test(id))throw new Error('공유 주소가 올바르지 않아요.');
 const finishLoading=beginSkeletonTask('network');
 try{
 const response=await fetch(`${apiBase}/shares/${id}`,{credentials:'omit',cache:'no-store',signal});
 const result=await response.json() as {book?:Book;error?:string};
 if(!response.ok||!result.book)throw new Error(result.error||'공유한 책을 불러오지 못했어요.');
 return result.book;
 }finally{finishLoading();}
}
const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function cardHtml(book:Book,url:string,imageUrl:string,layout:ShareCardLayout={title:book.title,quote:'',imagePosition:0}){
 const image=imageUrl?new URL(imageUrl):null;if(image&&(image.protocol!=='https:'||image.username||image.password))throw new Error('HTTPS 이미지 주소를 입력해 주세요.');
 const link=new URL(url);if(!['https:','http:'].includes(link.protocol))throw new Error('공유 주소가 올바르지 않아요.');
 const quote=layout.quote.trim().slice(0,240),color=/^#[a-f0-9]{6}$/i.test(book.color)?book.color:'#1d3b31';
 const position=Math.round(Math.max(0,Math.min(1,Number.isFinite(layout.imagePosition)?layout.imagePosition:0))*100);
 const text=(value:string,left:number,top:number,width:number,size:number,color='#fffdf5',extra='')=>`<span style="position:absolute;display:block;box-sizing:border-box;left:${left}%;top:${top}%;width:${width}%;margin:0;padding:0;border:0;font:400 ${size/14.4}cqw/1.3 'Gowun Batang',serif;color:${color};white-space:pre-wrap;overflow-wrap:anywhere;text-decoration:none;${extra}">${escapeHtml(value)}</span>`;
 const credit=bookAuthor(book,'\n✦\n');
 const pages=quote&&layout.quotePages?(layout.quotePages.start===layout.quotePages.end?`p. ${layout.quotePages.start}`:`pp. ${layout.quotePages.start}–${layout.quotePages.end}`):'';
 const picture=image?`<img src="${escapeHtml(image.href)}" alt="${escapeHtml(layout.title)}" referrerpolicy="no-referrer" style="position:absolute;display:block;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;object-position:center ${position}%;margin:0;padding:0;border:0;">`:'';
 return `<div style="display:block;margin:0;padding:0;"><a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;vertical-align:top;position:relative;container-type:inline-size;box-sizing:border-box;width:720px;max-width:100%;margin:0;padding:0;border:0;color:inherit;text-decoration:none;"><span style="position:relative;display:block;width:100%;padding-top:50%;height:0;overflow:hidden;border-radius:1.6667cqw;background:${color};mask-image:radial-gradient(circle at 77.7778% 0,transparent 0 1.3194cqw,#000 1.4cqw),radial-gradient(circle at 77.7778% 100%,transparent 0 1.3194cqw,#000 1.4cqw);mask-composite:intersect;"><span style="position:absolute;display:block;inset:0;overflow:hidden;">${picture}<span style="position:absolute;display:block;inset:0;background:linear-gradient(55.56deg,#101813ed 0%,#101813b8 60%,#10181344 100%);"></span><span style="position:absolute;display:block;left:77.7778%;top:0;width:22.2222%;height:100%;background:#f1eee6f2;"></span>${text('GALPI  /  A STORY TO KEEP',4.4444,6.2,69,20,'#eeede7','font-family:sans-serif;')}${text(layout.title.replace(/\s*·\s*\d+권\s*$/,''),4.4444,12.1,68.75,48,'#fffdf5','white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}${quote?text('“',4.1667,30.8,10,70,'#fffdf5','font-family:Georgia,serif;')+text(quote,4.8611,39,66.6667,32,'#fffdf5','max-height:43%;overflow:hidden;'):''}${pages?text(pages,4.8611,81,66.6667,20,'#eeede7','text-align:right;font-family:sans-serif;'):''}<span style="position:absolute;display:block;left:4.4444%;top:88.6111%;width:68.8889%;height:0;border:0;border-top:1px solid #ffffff55;"></span>${text(quote?'이 이야기의 한 장면':'당신에게 건네는 이야기',4.4444,92,69,20,'#eeede7','font-family:sans-serif;')}${text('갈피  /  간직할 이야기',80.5556,6.2,18,19,'#545952','font-family:sans-serif;')}${text('VOLUME',80.5556,18,18,18,'#263d32','font-family:sans-serif;')}${text(String(book.volumeNumber??1).padStart(2,'0'),80.1389,24,18,108,'#263d32','font-family:Georgia,serif;')}${text(credit,80.5556,49,16.3889,26,'#263d32','text-align:center;line-height:1.45;')}${text('책 읽기  ↗',80.5556,88,18,28,'#263d32')}<span style="position:absolute;display:block;left:77.7778%;top:4.1667%;height:91.6667%;width:0;border:0;border-left:1px dashed #f1eee666;"></span></span></span></a></div>`;

}
export async function saveShareCardLayout(book:Book,layout:ShareCardLayout){
 const session=getAuthSession();if(!session||!apiBase)throw new Error('다시 로그인해 주세요.');const response=await fetch(`${apiBase}/library/books/${encodeURIComponent(book.id)}/share/card`,{method:'PUT',credentials:'omit',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify(layout)});const result=await response.json();if(!response.ok)throw new Error(result.error||'공유 카드를 저장하지 못했어요.');if(getAuthSession()?.user.id!==session.user.id)throw new Error('계정이 변경되었어요.');
}

export {makeTicketCard as makeShareCard} from './shareTicket';

async function hashBlob(blob:Blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function existingShareMedia(book:Book,images:{name:string;role:string;hash:string}[],complete=false){
 const session=getAuthSession();if(!session||!apiBase)throw new Error('다시 로그인해 주세요.');
 const response=await fetch(`${apiBase}/library/books/${encodeURIComponent(book.id)}/share/images`,{method:'PUT',credentials:'omit',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({images,complete})});const result=await response.json();if(!response.ok)throw new Error(result.error||'공유 이미지를 확인하지 못했어요.');if(getAuthSession()?.user.id!==session.user.id)throw new Error('계정이 변경되었어요.');return result.images as {name:string;role:string;hash:string;url:string|null}[];
}
async function uploadShareMedia(book:Book,blob:Blob,name:string,role:'asset'|'icon'|'card'){
 const session=getAuthSession();if(!session||!apiBase)throw new Error('다시 로그인해 주세요.');
 const response=await fetch(`${apiBase}/library/books/${encodeURIComponent(book.id)}/share/images`,{method:'POST',credentials:'omit',cache:'no-store',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':blob.type,'X-Image-Name':encodeURIComponent(name),'X-Image-Role':role},body:blob});
 const result=await response.json() as {url?:string;error?:string};if(!response.ok||!result.url)throw new Error(result.error||'공유 이미지를 업로드하지 못했어요.');if(getAuthSession()?.user.id!==session.user.id)throw new Error('계정이 변경되었어요.');return result.url;
}
export function imageCardHtml(title:string,url:string,imageUrl:string){
 const link=new URL(url),image=new URL(imageUrl);if(!['http:','https:'].includes(link.protocol)||image.protocol!=='https:'||image.username||image.password)throw new Error('공유 주소가 올바르지 않아요.');
 return `<div><a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:720px;max-width:100%;text-decoration:none;"><img src="${escapeHtml(image.href)}" alt="${escapeHtml(title)}" width="720" height="360" referrerpolicy="no-referrer" style="display:block;width:100%;max-width:100%;height:auto;margin:0;border:0;"></a></div>`;
}
export async function uploadShareCard(book:Book,blob:Blob){const hash=await hashBlob(blob),images=await existingShareMedia(book,[{name:'__galpi_ticket_card__',role:'card',hash}]);return images[0]?.url??uploadShareMedia(book,blob,'__galpi_ticket_card__','card');}
/** PNG only: pasting must not select external-image HTML instead of attaching the image. */
export async function copyPngImage(source:Blob|Promise<Blob>){
 if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw new Error('이 브라우저에서는 이미지 복사를 지원하지 않아요.');
 const png=Promise.resolve(source).then(async blob=>{
  if(blob.type==='image/png')return blob;
  const image=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d')!.drawImage(image,0,0);image.close();
  return new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('이미지를 복사하지 못했어요.')),'image/png'));
 });
 await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
}
export async function shareBackgroundBlob(book:Book,mime='image/webp'){
 const src=book.assets?.find(asset=>asset.id===book.shareCardAssetId)?.src??book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;return src?shareImageBlob(src,mime):null;
}
async function shareImageBlob(src:string,mime='image/webp'):Promise<Blob>{
 const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{image.src='';reject(new Error('이미지를 열지 못했어요.'));},10000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('이미지를 열지 못했어요.'));};image.src=src;});
 const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
 const context=canvas.getContext('2d');if(!context)throw new Error('이미지를 만들지 못했어요.');context.drawImage(image,0,0,canvas.width,canvas.height);
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('이미지를 만들지 못했어요.')),mime,.9));
}
export function usedShareAssets(book:Book,includeBody=true){
 const used=new Map<string,NonNullable<Book['assets']>[number]>();
 if(includeBody)for(const [index,message] of book.messages.entries())for(const segment of extractAssetSegments(message.content,book.assets??[],book.imageRules??[],book.imageReferences?.filter(reference=>reference.message===index)))if(segment.type==='asset')used.set(segment.asset.name,segment.asset);
 const icon=book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;
 if(icon)used.set('__galpi_cover_icon__',{id:'cover-icon',name:'__galpi_cover_icon__',src:icon,type:'icon'});
 const mark=book.assets?.find(asset=>asset.id===book.bookmarkAssetId)?.src??icon;
 if(mark)used.set('__galpi_bookmark__',{id:'bookmark-image',name:'__galpi_bookmark__',src:mark,type:'asset'});
 const background=book.assets?.find(asset=>asset.id===book.shareCardAssetId)?.src??icon;if(background)used.set('__galpi_share_background__',{id:'share-background',name:'__galpi_share_background__',src:background,type:'asset'});
 return [...used.values()];
}
type StagedImage={name:string;role:'asset'|'icon';hash:string;blob?:Blob};
export function withSharedAssets(book:Book,share:ShareInfo|null):Book{
 const remote=share?.images??[],assets=[...(book.assets??[])];
 for(const image of remote)if(image.role!=='card'&&!assets.some(asset=>asset.name===image.name))assets.push({id:image.name,name:image.name,src:image.url,type:image.role==='icon'?'icon':'asset'});
 const icon=book.characterIcon??remote.find(image=>image.name==='__galpi_cover_icon__')?.url;
 return {...book,assets,characterIcon:icon,bookmarkAssetId:book.bookmarkAssetId??assets.find(asset=>asset.name==='__galpi_bookmark__')?.id,shareCardAssetId:book.shareCardAssetId??assets.find(asset=>asset.name==='__galpi_share_background__')?.id};
}
export async function prepareShareUpdate(book:Book,share:ShareInfo|null){
 book=withSharedAssets(book,share);book={...book,imageReferences:await resolveDisplayImageReferences(book)};
 const references=book.messages.flatMap((message,index)=>extractAssetSegments(message.content,book.assets??[],book.imageRules??[],book.imageReferences?.filter(reference=>reference.message===index)).flatMap(segment=>segment.type==='asset'?[{message:index,start:segment.start,end:segment.end,name:segment.asset.name}]:[]));
 const hash=await snapshotHash(shareSnapshot(book,references));
 const assets=usedShareAssets(book);if(assets.length>40)throw new Error('공유 이미지는 한 권에 40개까지 넣을 수 있어요.');
 const images:StagedImage[]=[],sources=new Map<string,Promise<Blob>>();
 for(const asset of assets){const old=share?.images?.find(image=>image.url===asset.src);const identity={name:asset.name,role:asset.type==='icon'?'icon' as const:'asset' as const};
  if(old?.hash){images.push({...identity,hash:old.hash});continue;}
  let pending=sources.get(asset.src);if(!pending){pending=old?fetch(old.url,{credentials:'omit'}).then(response=>{if(!response.ok)throw new Error('기존 공유 이미지를 확인하지 못했어요.');return response.blob();}):shareImageBlob(asset.src);sources.set(asset.src,pending);}const blob=await pending;images.push({...identity,blob,hash:await hashBlob(blob)});
 }
 return {book,hash,images};
}
export async function syncShareImages(book:Book,images:StagedImage[],existing:SharedImage[],onProgress:(done:number,total:number)=>void){
 const same=(image:StagedImage)=>existing.some(old=>old.name===image.name&&old.role===image.role&&old.hash===image.hash);
 const missing=images.filter(image=>!same(image));const removed=existing.filter(old=>old.role!=='card').some(old=>!images.some(image=>image.name===old.name&&image.role===old.role));
 if(!missing.length&&!removed)return {changed:false,images:existing};
 const matches=missing.length?await existingShareMedia(book,missing):[];let done=0;const seen=new Set(existing.filter(image=>image.hash).map(image=>image.hash));
 for(const image of missing){let url=matches.find(entry=>entry.name===image.name&&entry.role===image.role)?.url;
  if(!url&&seen.has(image.hash))url=(await existingShareMedia(book,[image]))[0]?.url;
  if(!url){if(!image.blob)throw new Error('공유 이미지를 다시 선택해 주세요.');await uploadShareMedia(book,image.blob,image.name,image.role);}
  seen.add(image.hash);onProgress(++done,missing.length);
 }
 const final=await existingShareMedia(book,images,true);return {changed:true,images:[...existing.filter(image=>image.role==='card'),...final.map(image=>{if(!image.url)throw new Error('공유 이미지 주소를 확인하지 못했어요.');return {...image,url:image.url};})]};
}
export async function uploadBookShareAssets(book:Book,onProgress:(done:number,total:number)=>void){const prepared=await prepareShareUpdate(book,null);await syncShareImages(prepared.book,prepared.images,[],onProgress);}
