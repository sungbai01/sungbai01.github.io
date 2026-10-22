import {useEffect,useRef,useState} from 'react';
import Reader from './Reader';
import BookOpening from './BookOpening';
import {loadSharedBook} from '../lib/sharing';
import {readSharedBookmark,saveSharedBookmark,sharedBookmarkStorageKey,type SharedBookmark} from '../lib/sharedBookmarks';
import type {Book} from '../lib/library';
export default function SharedBook({id}:{id:string}){
 const [book,setBook]=useState<Book>();const [bookmark,setBookmark]=useState<SharedBookmark>({anchor:null,style:'normal'});const markRef=useRef(bookmark);markRef.current=bookmark;
 const [error,setError]=useState(''),[ready,setReady]=useState(false),[attempt,setAttempt]=useState(0);
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;const controller=new AbortController();setBook(undefined);setError('');setReady(false);void loadSharedBook(id,controller.signal).then(value=>{
  if(controller.signal.aborted)return;
  // Ignore publisher positions even if an older API response still includes one.
  const shared={...value,bookmarks:undefined};setBookmark(readSharedBookmark(id,shared));setBook(shared);
 }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'공유한 책을 열지 못했어요.');});return()=>{alive.current=false;controller.abort();};},[id,attempt]);
 useEffect(()=>{if(!book)return;const sync=(event:StorageEvent)=>{if(event.storageArea===localStorage&&(event.key===sharedBookmarkStorageKey(id)||event.key===null))setBookmark(readSharedBookmark(id,book));};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[book,id]);
 async function save(anchor:SharedBookmark['anchor'],style=markRef.current.style){const next={anchor,style};saveSharedBookmark(id,next);markRef.current=next;setBookmark(next);}
 const image=book?.assets?.find(asset=>asset.id===book.bookmarkAssetId)?.src??book?.characterIcon;
 return <><div inert={!ready} aria-hidden={!ready||undefined} style={{visibility:ready?'visible':'hidden'}}>{book&&<Reader key={`${id}:${attempt}`} book={book} initialBookmark={bookmark.anchor??undefined} shelfBookmark={bookmark.anchor?{...bookmark.anchor,bookId:book.id,title:book.title,style:bookmark.style,image,icon:book.characterIcon}:undefined} bookmarkStyle={bookmark.style} bookmarkImage={image} characterIcon={book.characterIcon} onBookmarkChange={(anchor,style)=>save(anchor,style)} onBookmarkStyleChange={style=>save(markRef.current.anchor,style)} onOpenError={setError} onReady={()=>{if(alive.current)setReady(true);}} onClose={()=>{location.hash='/';}}/>}</div>{!ready&&<BookOpening error={error} onBack={()=>{location.hash='/';}} onRetry={()=>setAttempt(value=>value+1)}/>}</>;
}
