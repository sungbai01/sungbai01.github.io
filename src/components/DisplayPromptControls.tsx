import type {DisplayPrompt} from '../../shared/displayPrompt';
export default function DisplayPromptControls({value,onChange,disabled=false}:{value:DisplayPrompt;onChange:(value:DisplayPrompt)=>void;disabled?:boolean}){
 return <div className="display-prompt-controls" role="group" aria-label="본문 표시 설정">{([{key:'hideCurly',label:'{ } 내부 숨김'},{key:'hideSquare',label:'[ ] 내부 숨김'}] as const).map(item=><label key={item.key}><span>{item.label}</span><button type="button" role="switch" className="import-switch" aria-label={item.label} aria-checked={value[item.key]} disabled={disabled} onClick={()=>onChange({...value,[item.key]:!value[item.key]})}><span/></button></label>)}</div>;
}
