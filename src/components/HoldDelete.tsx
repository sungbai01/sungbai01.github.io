import {useEffect,useRef,useState} from 'react';
import {Trash2} from 'lucide-react';

export default function HoldDelete({disabled,onConfirm}:{disabled:boolean;onConfirm:()=>void}){
 const [holding,setHolding]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const fired=useRef(false);
 function cancel(){if(timer.current)clearTimeout(timer.current);timer.current=null;setHolding(false);}
 function start(){if(disabled||timer.current||fired.current)return;setHolding(true);timer.current=setTimeout(()=>{timer.current=null;fired.current=true;setHolding(false);onConfirm();},1400);}
 useEffect(()=>{if(disabled)cancel();else fired.current=false;},[disabled]);
 useEffect(()=>{const hidden=()=>{if(document.hidden)cancel();};window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',hidden);return()=>{if(timer.current)clearTimeout(timer.current);window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden);};},[]);
 return <button type="button" className="danger-btn hold-delete" data-holding={holding||undefined} disabled={disabled} aria-label="책장 삭제: 1.4초 동안 누르세요" onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);start();}} onPointerMove={event=>{const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)cancel();}} onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel} onKeyDown={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();if(!event.repeat)start();}}} onKeyUp={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();cancel();}}} onContextMenu={event=>event.preventDefault()}><Trash2 size={16}/><span>{disabled?'삭제 중…':'길게 눌러 책장 삭제'}</span></button>;
}
