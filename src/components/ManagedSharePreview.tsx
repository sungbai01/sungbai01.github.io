import {useEffect,useMemo,useRef,useState} from 'react';
import type {ShareCardPreview} from '../../shared/shareCard';
import {cardHtml,shareUrl} from '../lib/sharing';
export default function ManagedSharePreview({card,id,bookId}:{card:ShareCardPreview;id:string;bookId:string}){
 const ref=useRef<HTMLDivElement>(null),[scale,setScale]=useState(.6);
 useEffect(()=>{const element=ref.current;if(!element)return;const resize=()=>setScale(Math.min(1,element.clientWidth/720));resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();},[]);
 const html=useMemo(()=>`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline';"><style>html,body{margin:0;padding:0;width:720px;background:transparent}</style></head><body>${cardHtml({...card,id:bookId,description:'',createdAt:'',updatedAt:'',messages:[]},shareUrl(id),card.backgroundUrl??'',card)}</body></html>`,[card,id,bookId]);
 return <div ref={ref} className="managed-share-preview" style={{height:440*scale}}><iframe title={`${card.title} 카드 미리보기`} sandbox="" srcDoc={html} style={{width:720,height:440,transform:`scale(${scale})`,transformOrigin:'top left'}}/></div>;
}
