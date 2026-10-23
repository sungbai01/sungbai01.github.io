import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ShareQuoteSelection from '../src/components/ShareQuoteSelection';
export function mountContinuation(){
 function Harness(){const host=useRef<HTMLDivElement>(null),[page,setPage]=useState(1);return <><div ref={host}><article className="reader-page"><section data-message={0} data-char={(page-1)*10}><p className="reader-prose">{page===1?'첫 페이지 문장':'다음 페이지 문장'}</p></section><span className="reader-page-number">{page}</span></article></div><ShareQuoteSelection host={host} onPrevious={()=>setPage(1)} onNext={()=>setPage(2)} onDone={(text,pages)=>{(window as any).continuation={text,pages};}}/></>;}
 const host=document.createElement('div');document.body.append(host);createRoot(host).render(<Harness/>);
}
