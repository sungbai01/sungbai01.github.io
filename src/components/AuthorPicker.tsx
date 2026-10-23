import {useRef,useState} from 'react';
import Dropdown from './Dropdown';
export const AUTHOR_CHOICES=['Gemini 4 Argon','Opus 5.5','Gemini 3.8 Flash','Gemini 3.7 Flash','GPT 5.6-Sol','GLM 5.2','Fable','Deepseek V4 Pro','GPT 5.5','Kimi 2.6','GPT 5.4','Opus 4.6','GPT 5.1'] as const;
export default function AuthorPicker({value,onChange,disabled=false,label='모델',choices=AUTHOR_CHOICES.map(choice=>({value:choice,label:choice})),allowCustom=true,triggerLabel}:{value:string;onChange:(value:string)=>void;disabled?:boolean;label?:string;choices?:readonly {value:string;label:string}[];allowCustom?:boolean;triggerLabel?:string}){
 const known=(value:string)=>choices.some(choice=>choice.value===value);
 const [custom,setCustom]=useState(allowCustom&&!!value&&!known(value)),input=useRef<HTMLInputElement>(null);
 const options=[{value:'',label:'선택 안 함'},...choices,...(allowCustom?[{value:'__other__',label:'기타'}]:[])];
 return <div className="field dropdown-field"><span>{label}</span><Dropdown label={triggerLabel??`${label} ${custom?'기타':value||'선택 안 함'}`} value={custom?'__other__':value} options={options} disabled={disabled} onChange={next=>{const other=next==='__other__';setCustom(other);if(!other)onChange(next);else{if(known(value))onChange('');requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));}}}/>{custom&&<input ref={input} aria-label="모델 직접 입력" placeholder="모델 이름" maxLength={160} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>}</div>;
}
