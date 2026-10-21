import {useId} from 'react';
import {Moon,Sun,Sunset} from 'lucide-react';
import type {Theme} from '../lib/appearance';
import './theme-picker.css';
export type {Theme} from '../lib/appearance';
const themes=['paper','warm','dark'] as const;
const labels=['종이','따뜻하게','어둡게'] as const;
export function ThemePicker({value,onChange}:{value:Theme;onChange:(theme:Theme)=>void}){
 const id=useId(),index=Math.max(0,themes.indexOf(value));
 return <div className="theme-picker theme-slider">
  <label className="theme-slider-heading" htmlFor={id}><span>화면 색감</span><span>{labels[index]}</span></label>
  <div className="theme-slider-track"><input id={id} type="range" min={0} max={2} step={1} value={index} aria-valuetext={labels[index]} onChange={event=>{const next=themes[Number(event.currentTarget.value)];if(next&&next!==value)onChange(next);}}/></div>
  <div className="theme-slider-labels" aria-hidden="true"><span data-selected={index===0}><Sun size={14}/><small>종이</small></span><span data-selected={index===1}><Sunset size={14}/><small>따뜻하게</small></span><span data-selected={index===2}><Moon size={14}/><small>어둡게</small></span></div>
 </div>;
}
export default ThemePicker;
