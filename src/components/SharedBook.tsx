import {useEffect,useRef,useState} from 'react';
import Reader from './Reader';
import BookOpening from './BookOpening';
import {loadSharedBook} from '../lib/sharing';
import type {Book} from '../lib/library';
export default function SharedBook({id}:{id:string}){
 const [book,setBook]=useState<Book>();const [error,setError]=useState('');const [ready,setReady]=useState(false);const [attempt,setAttempt]=useState(0);
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;const controller=new AbortController();setBook(undefined);setError('');setReady(false);void loadSharedBook(id,controller.signal).then(value=>{if(!controller.signal.aborted)setBook(value);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'공유한 책을 열지 못했어요.');});return()=>{alive.current=false;controller.abort();};},[id,attempt]);
 return <><div inert={!ready} aria-hidden={!ready||undefined} style={{visibility:ready?'visible':'hidden'}}>{book&&<Reader key={`${id}:${attempt}`} book={book} initialBookmark={undefined} onReady={()=>{if(alive.current)setReady(true);}} onClose={()=>{location.hash='/';}}/>}</div>{!ready&&<BookOpening error={error} onBack={()=>{location.hash='/';}} onRetry={()=>setAttempt(value=>value+1)}/>}</>;
}
