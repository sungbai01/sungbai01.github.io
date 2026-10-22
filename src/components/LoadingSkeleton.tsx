import {useEffect,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import {beginSkeletonTask} from '../lib/loadingActivity';
import {classifyReaderViewport,readReaderViewport,readerPageCount} from '../lib/readerLayout';
import './loading-skeleton.css';
import ShelfBox from './ShelfBox';

function Bar({className=''}:{className?:string}){return <span className={`skeleton-fill ${className}`}/>;}

/** Track the reader bundle download without changing state during render. */
export function NetworkLoadingMarker(){useEffect(()=>beginSkeletonTask('network'),[]);return null;}

export function GeneralLoading({label='불러오는 중…'}:{label?:string}){
 return <div className="general-loading" role="status" aria-busy="true"><LoaderCircle size={22} aria-hidden="true"/><span>{label}</span></div>;
}

export function LibraryLoading({view}:{view:'covers'|'spines'}){
 return <section className="series-shelf shelf-loading" aria-label="책장을 불러오는 중" aria-busy="true">
  <header className="series-heading"><Bar className="skeleton-shelf-title"/></header>
  <ShelfBox view={view}>
   {view==='spines'&&<span className="shelf-bookstop shelf-bookstop-start" aria-hidden="true"/>}
   {Array.from({length:view==='spines'?8:4},(_,index)=><article key={index} className={`book-item shelf-loading-book ${view==='spines'?'spine-item':''}`} aria-hidden="true"><div className="book-stage"><Bar className={view==='spines'?'shelf-loading-spine':'shelf-loading-cover'}/></div>{view==='covers'&&<div className="shelf-loading-details"><Bar className="skeleton-caption"/><Bar className="skeleton-author"/></div>}</article>)}
   {view==='spines'&&<span className="shelf-bookstop shelf-bookstop-end" aria-hidden="true"/>}
  </ShelfBox>
 </section>;
}

export function LibrarySkeleton({shell=false,view='covers'}:{shell?:boolean;view?:'covers'|'spines'}){
 const shelves=<div className="skeleton-shelves">{[0,1].map(row=><section key={row} className="skeleton-shelf"><Bar className="skeleton-shelf-title"/><div className={`skeleton-books skeleton-books-${view}`}>{Array.from({length:view==='spines'?10:6},(_,index)=><div className="skeleton-book" key={index}><Bar className="skeleton-cover"/>{view==='covers'&&<><Bar className="skeleton-caption"/><Bar className="skeleton-author"/></>}</div>)}</div></section>)}</div>;
 return <div className={`library-skeleton${shell?' library-skeleton-shell':''}`} role="status" aria-label="서재를 불러오는 중" aria-busy="true"><span className="sr-only">서재를 불러오는 중</span><div aria-hidden="true">{shell?<><div className="skeleton-site-header"><Bar/><Bar/></div><div className="skeleton-library-main"><div className="skeleton-library-heading"><Bar/><Bar/></div><div className="skeleton-library-controls"><Bar/><Bar/></div>{shelves}</div></>:shelves}</div></div>;
}

export function ReadingSkeleton({embedded=false,pages,fullwindow}:{embedded?:boolean;pages?:number;fullwindow?:boolean}){
 const [viewport,setViewport]=useState(readReaderViewport);
 useEffect(()=>{const resize=()=>setViewport(readReaderViewport());window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 const device=classifyReaderViewport(viewport);
 let full=fullwindow??device!=='desktop';
 if(fullwindow===undefined&&device!=='phone')try{const saved=localStorage.getItem(device==='fold'?'galpi.reader.fold-fullwindow.v1':'galpi.reader.fullwindow.v1');if(saved!==null)full=saved==='true';}catch{}
 const count=pages??readerPageCount(viewport.width,viewport);
 return <div className={`reading-skeleton${embedded?' reading-skeleton-embedded':''}`} data-device={device} data-fullwindow={full} data-pages={count} role="status" aria-label="책 페이지를 불러오는 중" aria-busy="true"><span className="sr-only">책 페이지를 불러오는 중</span><div className="skeleton-reader-layout" aria-hidden="true">{!embedded&&!full&&<div className="skeleton-reader-toolbar"><Bar/><Bar/><Bar/></div>}{!embedded&&full&&<Bar className="skeleton-reader-handle"/>}<div className="skeleton-reader-stage"><div className="skeleton-paper-stack">{Array.from({length:count},(_,index)=><div className="skeleton-paper" key={index}><div className="skeleton-chapter"><Bar/></div><div className="skeleton-prose">{Array.from({length:15},(_,line)=><Bar key={line} className={`skeleton-line skeleton-line-${line%5}`}/>)}</div><Bar className="skeleton-page-number"/></div>)}</div></div>{!embedded&&!full&&<div className="skeleton-reader-footer"><Bar/></div>}</div></div>;
}
