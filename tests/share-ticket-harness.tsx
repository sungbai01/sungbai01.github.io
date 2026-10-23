import ShareManager from '../src/components/ShareManager';
import React,{useRef,useState} from 'react';
import ShareQuoteSelection from '../src/components/ShareQuoteSelection';
import {createRoot} from 'react-dom/client';
import ShareDialog from '../src/components/ShareDialog';
export function mountTicket(signedIn=false,initialQuote='',withArtwork=false){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const canvas=document.createElement('canvas');canvas.width=withArtwork?400:10;canvas.height=withArtwork?1200:10;canvas.getContext('2d')!.fillRect(0,0,10,10);
 const book={id:'ticket-test',title:'티켓 테스트',seriesTitle:'테스트 책장',author:'테스트',description:'',color:'#1d3b31',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[],...(signedIn||withArtwork?{shareCardAssetId:withArtwork?'scene':undefined,assets:[{id:'scene',name:'scene',type:'asset' as const,src:canvas.toDataURL('image/png')}]}:{})};
 const loadBook=()=>new Promise<any>(resolve=>{(window as any).finishBook=()=>{const value={...book,messages:[{role:'assistant',name:'화자',content:signedIn?'테스트 본문 <img="scene">':'테스트 본문'}]};(window as any).ticketBook=value;resolve(value);};});
 function Harness(){const [quote,setQuote]=useState(initialQuote);return <ShareDialog book={book} loadBook={loadBook} quote={quote} onQuoteChange={setQuote} onClose={()=>root.unmount()} onSelectQuote={()=>{(window as any).selectedFromBook=true;}} onManageAssets={()=>{}}/>;}
 root.render(<Harness/>);
}

export function mountEmptySelection(){
 function Harness(){const ref=useRef<HTMLDivElement>(null);return <div ref={ref}><ShareQuoteSelection host={ref} onDone={text=>{(window as any).chosenQuote=text;}} onPrevious={()=>{}} onNext={()=>{}}/></div>;}
 const host=document.createElement('div');document.body.append(host);createRoot(host).render(<Harness/>);
}

export function mountRangeSelection(){
 function Harness(){const ref=useRef<HTMLDivElement>(null);return <div ref={ref}><article className="reader-page"><p className="reader-prose">앞쪽 대사</p><span className="reader-page-number">17</span></article><article className="reader-page"><p className="reader-prose">뒷쪽 대사</p><span className="reader-page-number">18</span></article><ShareQuoteSelection host={ref} onDone={(text,pages)=>{(window as any).selectedRange={text,pages};}} onPrevious={()=>{}} onNext={()=>{}}/></div>;}
 const host=document.createElement('div');document.body.append(host);createRoot(host).render(<Harness/>);
}

export function mountShareManager(){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);root.render(<ShareManager onClose={()=>root.unmount()}/>);}
