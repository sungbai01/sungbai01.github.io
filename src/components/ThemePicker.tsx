import {useRef,type CSSProperties} from 'react';
import {Moon,Sun,Sunset} from 'lucide-react';
import type {Theme} from '../lib/appearance';
import './theme-picker.css';
export type {Theme} from '../lib/appearance';
const options=[{theme:'paper',label:'라이트',icon:Sun},{theme:'warm',label:'웜',icon:Sunset},{theme:'dark',label:'다크',icon:Moon}] as const;
/** Radix Segmented Control structure with shadcn's sun/moon theme affordance. */
export function ThemePicker({value,onChange}:{value:Theme;onChange:(theme:Theme)=>void}){
 const root=useRef<HTMLDivElement>(null),index=Math.max(0,options.findIndex(option=>option.theme===value));
 return <div ref={root} className="theme-picker theme-toggle" role="radiogroup" aria-label="화면 색감" style={{'--theme-index':index} as CSSProperties} onKeyDown={event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  const focused=Array.from(root.current?.querySelectorAll('button')??[]).indexOf(document.activeElement as HTMLButtonElement),current=focused<0?index:focused;
  const next=event.key==='Home'?0:event.key==='End'?2:(current+(event.key==='ArrowLeft'||event.key==='ArrowUp'?2:1))%3;
  onChange(options[next].theme);root.current?.querySelectorAll('button')[next]?.focus();
 }}><span className="theme-toggle-selection" aria-hidden="true"/>{options.map(({theme,label,icon:Icon})=><button key={theme} type="button" role="radio" aria-checked={value===theme} aria-label={label} title={theme==='warm'?'따뜻한 종이 색감':`${label} 모드`} tabIndex={value===theme?0:-1} onClick={()=>onChange(theme)}><Icon size={15} aria-hidden="true"/><span>{label}</span></button>)}</div>;
}
export default ThemePicker;
