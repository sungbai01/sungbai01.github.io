import {ImagePlus} from 'lucide-react';
import {useLayoutEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {BOOK_COLORS,type Book} from '../lib/library';
import AssetImage from './AssetImage';
import {CoverTitle} from './SpineTitle';
import './book-cover.css';

/** Shared artwork and typography; reader covers adapt their layout to the leaf ratio. */
export default function BookCover({book,small=false,fit=false,onSelectAsset,disabled=false}:{book:Book;small?:boolean;fit?:boolean;onSelectAsset?:()=>void;disabled?:boolean}){
 const frame=useRef<HTMLDivElement>(null),cover=useRef<HTMLDivElement>(null);
 const [layout,setLayout]=useState({scale:1,height:0});
 const scale=layout.scale;
 useLayoutEffect(()=>{
  if(!fit||!frame.current||!cover.current)return;
  const element=frame.current,design=cover.current;
  const update=()=>{
   const style=getComputedStyle(element),reference=getComputedStyle(design);
   const width=element.clientWidth||parseFloat(style.getPropertyValue('--paper-width'));
   const height=element.clientHeight||parseFloat(style.getPropertyValue('--paper-height'));
   const originalWidth=design.clientWidth||parseFloat(reference.width);
   if(width>0&&height>0&&originalWidth>0){const scale=width/originalWidth,next={scale,height:height/scale};setLayout(previous=>Math.abs(previous.scale-next.scale)<.0001&&Math.abs(previous.height-next.height)<.01?previous:next);}
  };
  update();const observer=new ResizeObserver(update);observer.observe(element);observer.observe(design);
  return()=>observer.disconnect();
 },[fit,small]);
 const icon=book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;
 const title=book.title.replace(/\s*·\s*\d+권\s*$/,'').trim()||book.title;
 const content=<div ref={cover} className={`book-cover ${small?'cover-small':''}${fit?' book-cover-reader':''}`} style={{'--cover':book.color||BOOK_COLORS[0],...(fit?{'--cover-fit-scale':scale,...(layout.height?{height:`${layout.height}px`}:{})}:{})} as CSSProperties}>
  {book.cover&&<AssetImage skeleton={!fit} className="cover-image" src={book.cover} alt="" resolutionScale={fit?scale:1}/>}
  <div className="cover-content"><CoverTitle title={title} small={small}/><div className="cover-portrait">{icon?<AssetImage skeleton={!fit} src={icon} alt={`${book.author||'캐릭터'} 초상`} resolutionScale={fit?scale:1}/>:<span className="cover-ornament" aria-hidden="true">✳</span>}{onSelectAsset&&<button type="button" className="cover-asset-select" aria-label="표지 에셋 선택" title="표지 에셋 선택" disabled={disabled} onClick={onSelectAsset}><ImagePlus size={24}/></button>}</div><span className="cover-volume">{String(book.volumeNumber??1).padStart(2,'0')}</span></div>
 </div>;
 return fit?<div ref={frame} className="book-cover-fit" style={{'--cover':book.color||BOOK_COLORS[0]} as CSSProperties}>{content}</div>:content;
}
