import {useId,useRef} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import {normalizeDisplayPrompt,type DisplayPrompt} from '../../shared/displayPrompt';
import './prompt-picker.css';
export default function PromptPicker({value,onChange,disabled=false}:{value?:DisplayPrompt;onChange:(value:DisplayPrompt)=>void;disabled?:boolean}){
 const id=useId(),menu=useRef<HTMLDetailsElement>(null),prompt=normalizeDisplayPrompt(value);
 const options=[{id:'default',label:'선택 안 함'},{id:'soakma',label:'소악마'}] as const;
 return <section className="intake-prompt" aria-labelledby={id}><h3 id={id}>프롬프트</h3><details ref={menu} className="intake-prompt-picker"><summary aria-disabled={disabled} onClick={event=>{if(disabled)event.preventDefault();}} aria-label="표시 프롬프트 선택">{options.find(option=>option.id===prompt.id)?.label}<ChevronDown size={15}/></summary><div role="listbox" aria-label="프롬프트">{options.map(option=><button key={option.id} type="button" role="option" aria-selected={prompt.id===option.id} disabled={disabled} onClick={()=>{onChange({...prompt,id:option.id});if(menu.current){menu.current.open=false;menu.current.querySelector('summary')?.focus();}}}><span>{option.label}</span>{prompt.id===option.id&&<Check size={14}/>}</button>)}</div></details></section>;
}
