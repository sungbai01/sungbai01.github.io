import React from 'react';
import {createRoot} from 'react-dom/client';
import ShareDialog from '../src/components/ShareDialog';
export function mountTicket(){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const book={id:'ticket-test',title:'티켓 테스트',author:'테스트',description:'',color:'#1d3b31',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]};
 root.render(<ShareDialog book={book} loadBook={()=>new Promise(resolve=>{(window as any).finishBook=()=>resolve({...book,messages:[{role:'assistant',name:'화자',content:'테스트 본문'}]});})} onClose={()=>root.unmount()} onLogin={()=>{}} onSelectQuote={()=>{}} onManageAssets={()=>{}}/>);
}
