import {Check,Moon,Sun} from 'lucide-react';
import type {Theme} from '../lib/appearance';
export type {Theme} from '../lib/appearance';
export function ThemePicker({value,onChange}:{value:Theme;onChange:(theme:Theme)=>void}){
 return <div className="theme-picker" style={{display:'flex',gap:8,width:'100%'}} role="group" aria-label="화면 테마">{(['paper','warm','dark'] as const).map(theme=><button key={theme} type="button" className={`theme-choice theme-choice-${theme} ${theme==='dark'?'dark':'light'}`} aria-pressed={value===theme} onClick={()=>onChange(theme)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:7,padding:'12px 9px',borderRadius:7,border:value===theme?'1px solid var(--jade-8)':'1px solid var(--sand-5)',background:theme==='warm'?'var(--bronze-3)':'var(--sand-2)',color:theme==='warm'?'var(--bronze-12)':'var(--sand-12)',flex:1,minWidth:0,fontSize:11}}><span style={{display:'flex',gap:5,alignItems:'center'}}>{theme==='dark'?<Moon size={17}/>:<Sun size={17}/>} {value===theme&&<Check size={13}/>}</span><span>{theme==='paper'?'종이':theme==='warm'?'따뜻하게':'어둡게'}</span></button>)}</div>;
}
export default ThemePicker;
