import type {ShareCardLayout} from '../../shared/shareCard';
import {getAuthSession} from './auth';
export function shareDraftKey(bookId:string){return `galpi.share-draft.v1:${getAuthSession()?.user.id??'guest'}:${bookId}`;}
export function readShareDraft(key:string):ShareCardLayout|undefined{
 try{const value=JSON.parse(localStorage.getItem(key)??'null');
  if(!value||typeof value.title!=='string'||value.title.length>1000||typeof value.quote!=='string'||value.quote.length>100000||typeof value.imagePosition!=='number'||!Number.isFinite(value.imagePosition)||value.imagePosition<0||value.imagePosition>1)return;
  const pages=value.quotePages;
  return {title:value.title,quote:value.quote,imagePosition:value.imagePosition,...(typeof value.backgroundName==='string'?{backgroundName:value.backgroundName}:{}),...(pages&&Number.isSafeInteger(pages.start)&&Number.isSafeInteger(pages.end)&&pages.start>0&&pages.end>=pages.start?{quotePages:{start:pages.start,end:pages.end}}:{})};
 }catch{return;}
}
export function writeShareDraft(key:string,value:ShareCardLayout){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Preview cache is optional when storage is unavailable. */}}
