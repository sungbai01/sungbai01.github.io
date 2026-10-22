import { BookOpen } from 'lucide-react';
import {useEffect,useState} from 'react';
import './book-opening.css';
import {useSkeletonLoading} from '../lib/loadingActivity';
import {ReadingSkeleton,GeneralLoading} from './LoadingSkeleton';

export default function BookOpening({error,label='책을 펼치고 있어요…',backLabel='서재로',onBack,onRetry,variant='reader',network=false}:{network?:boolean;variant?:'library'|'reader';error?:string;label?:string;backLabel?:string;onBack:()=>void;onRetry:()=>void}){
  const skeleton=useSkeletonLoading();
  const [shellReady,setShellReady]=useState(false);
  const [showSkeleton,setShowSkeleton]=useState(false);
  useEffect(()=>{
    let second=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setShellReady(true));});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
  },[]);
  // Opening progresses in one direction: shell, content placeholder, ready.
  // Gaps between fetch, fonts and pagination must not restore the full loader.
  useEffect(()=>{if(shellReady&&variant==='reader'&&(network||skeleton))setShowSkeleton(true);},[shellReady,variant,network,skeleton]);
  if(!error&&(variant==='library'||!showSkeleton))return <div className="book-opening"><GeneralLoading label={label}/></div>;
  if(!error)return <div className="book-opening book-opening-skeleton"><ReadingSkeleton/></div>;
  return <div className="book-opening" role={error?'alert':'status'} aria-live="polite">
    <BookOpen size={28} strokeWidth={1.3} aria-hidden="true"/>
    <p>{error||label}</p>
    {error&&<div className="book-opening-actions"><button className="secondary-btn" onClick={onBack}>{backLabel}</button><button className="secondary-btn" onClick={onRetry}>다시 시도</button></div>}
  </div>;
}
