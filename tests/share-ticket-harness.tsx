import React,{useRef} from 'react';
import ShareQuoteSelection from '../src/components/ShareQuoteSelection';
import {createRoot} from 'react-dom/client';
import ShareDialog from '../src/components/ShareDialog';
export function mountTicket(signedIn=false){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const canvas=document.createElement('canvas');canvas.width=10;canvas.height=10;canvas.getContext('2d')!.fillRect(0,0,10,10);
 const book={id:'ticket-test',title:'티켓 테스트',author:'테스트',description:'',color:'#1d3b31',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[],...(signedIn?{assets:[{id:'scene',name:'scene',type:'asset' as const,src:canvas.toDataURL('image/png')}]}:{})};
 root.render(<ShareDialog book={book} loadBook={()=>new Promise(resolve=>{(window as any).finishBook=()=>resolve({...book,messages:[{role:'assistant',name:'화자',content:signedIn?'테스트 본문 <img="scene">':'테스트 본문'}]});})} onClose={()=>root.unmount()} onSelectQuote={()=>{}} onManageAssets={()=>{}}/>);
}

export function mountEmptySelection(){
 function Harness(){const ref=useRef<HTMLDivElement>(null);return <div ref={ref}><ShareQuoteSelection host={ref} onDone={text=>{(window as any).chosenQuote=text;}} onPrevious={()=>{}} onNext={()=>{}}/></div>;}
 const host=document.createElement('div');document.body.append(host);createRoot(host).render(<Harness/>);
}
