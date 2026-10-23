import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Reader} from '../src/components/Reader';
export function mountBookmarkAsset(){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const canvas=document.createElement('canvas');canvas.width=400;canvas.height=800;canvas.getContext('2d')!.fillStyle='#245ba5';canvas.getContext('2d')!.fillRect(0,0,400,800);
 const book={id:'asset-mark',title:'겹침 확인',author:'test',description:'',color:'#fc0000',createdAt:'2026-10-01',updatedAt:'2026-10-01',assets:[{id:'image',name:'image',type:'asset' as const,src:canvas.toDataURL()}],messages:[{role:'assistant',name:'bot',content:'<img="image">\n첫 페이지 문장입니다. '+ '이어지는 이야기를 읽는다. '.repeat(300)},{role:'assistant',name:'bot',content:'마지막 챕터의 이야기. '.repeat(200)}]};
 function Harness(){const [selecting,setSelecting]=useState(false);(window as any).beginQuote=()=>setSelecting(true);return <Reader book={book} onClose={()=>{}} shelfBookmark={{bookId:book.id,title:book.title,message:1,char:500}} onBookmarkChange={async()=>{}} selectingQuote={selecting} onQuoteSelected={(text,pages)=>{(window as any).selectedQuote={text,pages};}}/>;}
 root.render(<Harness/>);
}
