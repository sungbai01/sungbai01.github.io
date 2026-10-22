import { BookOpen } from 'lucide-react';
import './book-opening.css';
import {LibrarySkeleton,ReadingSkeleton} from './LoadingSkeleton';

export default function BookOpening({error,label='책을 펼치고 있어요…',backLabel='서재로',onBack,onRetry,variant='reader'}:{variant?:'library'|'reader';error?:string;label?:string;backLabel?:string;onBack:()=>void;onRetry:()=>void}){
  if(!error)return <div className="book-opening book-opening-skeleton">{variant==='library'?<LibrarySkeleton shell/>:<ReadingSkeleton/>}</div>;
  return <div className="book-opening" role={error?'alert':'status'} aria-live="polite">
    <BookOpen size={28} strokeWidth={1.3} aria-hidden="true"/>
    <p>{error||label}</p>
    {error&&<div className="book-opening-actions"><button className="secondary-btn" onClick={onBack}>{backLabel}</button><button className="secondary-btn" onClick={onRetry}>다시 시도</button></div>}
  </div>;
}
