import {normalizeDisplayPrompt,type DisplayPrompt} from '../../shared/displayPrompt';
import AuthorPicker from './AuthorPicker';
const choices=[{value:'soakma',label:'소악마'}];
export default function PromptPicker({value,onChange,disabled=false}:{value?:DisplayPrompt;onChange:(value:DisplayPrompt)=>void;disabled?:boolean}){
 const prompt=normalizeDisplayPrompt(value);
 return <AuthorPicker label="프롬프트" triggerLabel="표시 프롬프트 선택" value={prompt.id==='default'?'':prompt.id} choices={choices} allowCustom={false} disabled={disabled} onChange={id=>onChange({...prompt,id:id==='soakma'?'soakma':'default'})}/>;
}
