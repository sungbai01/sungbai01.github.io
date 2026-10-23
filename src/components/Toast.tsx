import {useEffect,useRef,type ReactNode} from 'react';
import {Check,CircleAlert,LoaderCircle,X} from 'lucide-react';
import './toast.css';
export type ToastTone='success'|'error'|'progress'|'info';
export default function Toast({message,tone='info',duration=3600,onDismiss,children}:{message:string;tone?:ToastTone;duration?:number;onDismiss:()=>void;children?:ReactNode}){
 const dismissRef=useRef(onDismiss);dismissRef.current=onDismiss;
 useEffect(()=>{if(!message||!duration)return;const timer=setTimeout(()=>dismissRef.current(),duration);return()=>clearTimeout(timer);},[message,duration]);
 if(!message)return null;
 return <div className="toast" data-tone={tone} role={tone==='error'?'alert':'status'} aria-live={tone==='error'?'assertive':'polite'}><div className="toast-line">{tone==='progress'?<LoaderCircle className="animate-spin" size={17}/>:tone==='error'?<CircleAlert size={17}/>:tone==='success'?<Check size={17}/>:null}<span>{message}</span><button aria-label="알림 닫기" title="알림 닫기" onClick={onDismiss}><X size={16}/></button></div>{children}</div>;
}
