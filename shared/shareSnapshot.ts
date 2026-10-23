import type {Book} from '../src/lib/library';
import {cloudBook} from './cloudBook';
/** Same snapshot projection on both sides; timestamps/bookmarks do not trigger publication. */
export function shareSnapshot(book:Book,references:Book['imageReferences']=book.imageReferences??[],style:Book['bookmarkStyle']=book.bookmarkStyle??'normal'){
 const value=cloudBook(book);delete value.bookmarks;delete value.seriesId;delete value.pageLayoutVersion;
 value.description='';value.bookmarkStyle=style;value.imageReferences=references;return value;
}
export async function snapshotHash(book:Book){
 const {updatedAt,...value}=book;void updatedAt;
 const canonical=(item:any):any=>Array.isArray(item)?item.map(canonical):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().filter(key=>item[key]!==undefined).map(key=>[key,canonical(item[key])])):item;
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value))))),byte=>byte.toString(16).padStart(2,'0')).join('');
}
