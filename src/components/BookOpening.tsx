import { BookOpen } from 'lucide-react';
import './book-opening.css';

export default function BookOpening({error,onBack,onRetry}:{error?:string;onBack:()=>void;onRetry:()=>void}){
  return <div className="book-opening" role={error?'alert':'status'} aria-live="polite">
    <BookOpen size={28} strokeWidth={1.3} aria-hidden="true"/>
    <p>{error||'책을 펼치고 있어요…'}</p>
    {error&&<div className="book-opening-actions"><button className="secondary-btn" onClick={onBack}>서재로</button><button className="secondary-btn" onClick={onRetry}>다시 시도</button></div>}
  </div>;
}
