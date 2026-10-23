import React from 'react';
import {createRoot} from 'react-dom/client';
import Reader from '../src/components/Reader';
export function mountFailure(){
 const host=document.createElement('div');document.body.append(host);
 createRoot(host).render(<Reader book={{id:'failure',title:'실패 테스트',author:'',description:'',color:'#1d3b31',createdAt:'',updatedAt:'',messages:[{role:'assistant',content:'테스트 본문. '.repeat(300)}]}} onClose={()=>{}} onBookmarkChange={async()=>{throw new Error('test');}}/>);
}
