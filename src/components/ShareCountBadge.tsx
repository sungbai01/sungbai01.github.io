import {useEffect,useState} from 'react';
import {getActiveShareCount,SHARES_CHANGED} from '../lib/sharing';

export default function ShareCountBadge({open}:{open:boolean}){
 const [count,setCount]=useState<number>();
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();let pending=false;
  const refresh=async()=>{if(pending)return;pending=true;try{const value=await getActiveShareCount(controller.signal);if(!controller.signal.aborted)setCount(value);}catch{/* A failed request must not report a false zero. */}finally{pending=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),30000);
  const update=()=>void refresh();window.addEventListener(SHARES_CHANGED,update);window.addEventListener('focus',update);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener(SHARES_CHANGED,update);window.removeEventListener('focus',update);};
 },[open]);
 return count===undefined?null:<small className="share-count-badge" role="status" aria-label={`공유 중 ${count}개`}>{count}</small>;
}
