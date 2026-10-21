import {useLayoutEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {BOOK_COLORS,type Book} from '../lib/library';
import AssetImage from './AssetImage';
import {CoverTitle} from './SpineTitle';
import './book-cover.css';

/** Both library and reader use the same cover, uniformly fitted without stretching. */
export default function BookCover({book,small=false,fit=false}:{book:Book;small?:boolean;fit?:boolean}){
 const frame=useRef<HTMLDivElement>(null),cover=useRef<HTMLDivElement>(null);
 const [scale,setScale]=useState(1);
 useLayoutEffect(()=>{
  if(!fit||!frame.current||!cover.current)return;
  const element=frame.current,design=cover.current;
  const update=()=>{
   const style=getComputedStyle(element),reference=getComputedStyle(design);
   const width=element.clientWidth||parseFloat(style.getPropertyValue('--paper-width'));
   const height=element.clientHeight||parseFloat(style.getPropertyValue('--paper-height'));
   const originalWidth=design.clientWidth||parseFloat(reference.width);
   const originalHeight=design.clientHeight||parseFloat(reference.height);
   if(width>0&&height>0&&originalWidth>0&&originalHeight>0){const next=Math.min(width/originalWidth,height/originalHeight);setScale(previous=>previous===next?previous:next);}
  };
  update();const observer=new ResizeObserver(update);observer.observe(element);observer.observe(design);
  return()=>observer.disconnect();
 },[fit,small]);
 const icon=book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;
 const title=book.title.replace(/\s*·\s*\d+권\s*$/,'').trim()||book.title;
 const content=<div ref={cover} className={`book-cover ${small?'cover-small':''}${fit?' book-cover-reader':''}`} style={{'--cover':book.color||BOOK_COLORS[0],...(fit?{'--cover-fit-scale':scale}:{})} as CSSProperties}>
  {book.cover&&<AssetImage className="cover-image" src={book.cover} alt="" resolutionScale={fit?scale:1}/>}
  <div className="cover-content"><CoverTitle title={title} small={small}/><div className="cover-portrait">{icon?<AssetImage src={icon} alt={`${book.author||'캐릭터'} 초상`} resolutionScale={fit?scale:1}/>:<span className="cover-ornament" aria-hidden="true">✳</span>}</div><span className="cover-volume">{String(book.volumeNumber??1).padStart(2,'0')}</span></div>
 </div>;
 return fit?<div ref={frame} className="book-cover-fit" style={{'--cover':book.color||BOOK_COLORS[0]} as CSSProperties}>{content}</div>:content;
}
