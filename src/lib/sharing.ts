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
export function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function cardHtml(book:Book,url:string,imageUrl:string,layout:ShareCardLayout={title:book.title,quote:'',imagePosition:0}){
 const image=imageUrl?new URL(imageUrl):null;if(image&&image.protocol!=='https:')throw new Error('HTTPS 이미지 주소를 입력해 주세요.');
 const link=new URL(url);if(!['https:','http:'].includes(link.protocol))throw new Error('공유 주소가 올바르지 않아요.');
 const credit=bookAuthor(book,'\n✦\n').split('\n').map(line=>line==='✦'?'<span style="font-size:12px;">✦</span>':escapeHtml(line)).join('<br>');
 const quote=layout.quote.trim();const pages=quote&&layout.quotePages?(layout.quotePages.start===layout.quotePages.end?`p. ${layout.quotePages.start}`:`pp. ${layout.quotePages.start}–${layout.quotePages.end}`):'';
 const color=/^#[a-f0-9]{6}$/i.test(book.color)?book.color:'#1d3b31';
 const background=image?`background-image:linear-gradient(35deg,rgba(16,24,19,.93),rgba(16,24,19,.27)),url(&quot;${escapeHtml(image.href)}&quot;);background-size:cover;background-position:center ${Math.round(Math.max(0,Math.min(1,layout.imagePosition))*100)}%;`:'';
 return `<div style="text-align:center;"><div style="display:inline-block;width:720px;max-width:100%;"><table role="presentation" align="center" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed;border-collapse:collapse;overflow:hidden;border-radius:12px;background:${color};"><tbody><tr><td width="78%" style="width:78%;vertical-align:top;padding:24px 30px;color:#fffdf5;text-align:left;${background}"><div style="font:10px sans-serif;letter-spacing:1px;">GALPI / A STORY TO KEEP</div><div style="font:24px/1.4 Georgia,serif;margin:22px 0 38px;word-break:keep-all;overflow-wrap:break-word;">${escapeHtml(layout.title)}</div>${!image?'<div data-galpi-image-slot="true" style="background:#ffffff12;border:1px dashed #ffffff66;padding:32px 12px;margin:0 0 24px;text-align:center;min-height:100px;"><p style="margin:0;font:13px sans-serif;">이미지를 여기에 붙여넣으세요</p></div>':''}${quote?`<div style="font:36px Georgia,serif;line-height:1;">“</div><div style="font:16px/1.6 Georgia,serif;white-space:pre-wrap;overflow-wrap:break-word;">${escapeHtml(quote)}</div>${pages?`<div style="text-align:right;font:10px sans-serif;margin-top:12px;">${pages}</div>`:''}`:''}<div style="border-top:1px solid #ffffff55;margin-top:32px;padding-top:14px;font:10px sans-serif;">${quote?'이 이야기의 한 장면':'당신에게 건네는 이야기'}</div></td><td width="22%" style="width:22%;vertical-align:top;padding:24px 16px;background:#f1eee6;color:#263d32;text-align:center;border-left:1px dashed #ccc8bd;"><div style="font:9px sans-serif;">갈피 / 간직할 이야기</div><div style="font:9px sans-serif;margin-top:30px;">VOLUME</div><div style="font:54px Georgia,serif;margin:10px 0 38px;">${String(book.volumeNumber??1).padStart(2,'0')}</div><div style="font:13px/1.7 Georgia,serif;word-break:keep-all;overflow-wrap:break-word;">${credit}</div><div style="font:14px Georgia,serif;margin-top:52px;"><a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">책 읽기 ↗</a></div></td></tr></tbody></table></div></div>`;
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
async function uploadShareMedia(book:Book,blob:Blob,name:string,role:'asset'|'icon'){
 const session=getAuthSession();if(!session||!apiBase)throw new Error('다시 로그인해 주세요.');
 const response=await fetch(`${apiBase}/library/books/${encodeURIComponent(book.id)}/share/images`,{method:'POST',credentials:'omit',cache:'no-store',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':blob.type,'X-Image-Name':encodeURIComponent(name),'X-Image-Role':role},body:blob});
 const result=await response.json() as {url?:string;error?:string};if(!response.ok||!result.url)throw new Error(result.error||'공유 이미지를 업로드하지 못했어요.');if(getAuthSession()?.user.id!==session.user.id)throw new Error('계정이 변경되었어요.');return result.url;
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
 const missing=images.filter(image=>!same(image));const removed=existing.some(old=>!images.some(image=>image.name===old.name&&image.role===old.role));
 if(!missing.length&&!removed)return false;
 const matches=missing.length?await existingShareMedia(book,missing):[];let done=0;const seen=new Set(existing.filter(image=>image.hash).map(image=>image.hash));
 for(const image of missing){let url=matches.find(entry=>entry.name===image.name&&entry.role===image.role)?.url;
  if(!url&&seen.has(image.hash))url=(await existingShareMedia(book,[image]))[0]?.url;
  if(!url){if(!image.blob)throw new Error('공유 이미지를 다시 선택해 주세요.');await uploadShareMedia(book,image.blob,image.name,image.role);}
  seen.add(image.hash);onProgress(++done,missing.length);
 }
 await existingShareMedia(book,images,true);return true;
}
export async function uploadBookShareAssets(book:Book,onProgress:(done:number,total:number)=>void){const prepared=await prepareShareUpdate(book,null);await syncShareImages(prepared.book,prepared.images,[],onProgress);}
