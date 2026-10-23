import {useId} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import './prompt-picker.css';

/** Shared by book creation and editing; no named prompts are available yet. */
export default function PromptPicker({disabled=false}:{disabled?:boolean}){
 const id=useId();
 return <section className="intake-prompt" aria-labelledby={id}><h3 id={id}>프롬프트</h3><details className="intake-prompt-picker"><summary aria-disabled={disabled} onClick={event=>{if(disabled)event.preventDefault();}} aria-label="표시 프롬프트 선택">선택 안 함<ChevronDown size={15}/></summary><div role="listbox" aria-label="프롬프트"><button type="button" role="option" aria-selected="true" disabled><span>선택 안 함</span><Check size={14}/></button></div></details></section>;
}
