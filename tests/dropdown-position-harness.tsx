import React from 'react';
import {createRoot} from 'react-dom/client';
import PromptPicker from '../src/components/PromptPicker';
import Dropdown from '../src/components/Dropdown';
import {Ellipsis} from 'lucide-react';
export function mountBookMenu(){const host=document.createElement('div');host.style.cssText='position:fixed;left:150px;top:100px';host.className='book-item';document.body.append(host);createRoot(host).render(<div className="book-menu-wrap"><Dropdown label="책 관리 확인" mode="menu" triggerContent={<Ellipsis size={19}/>} minMenuWidth={158} options={[{value:'edit',label:'책 편집'},{value:'delete',label:'삭제',danger:true}]} onChange={()=>{}}/></div>);}
export function mountDropdown(){const dialog=document.createElement('dialog');dialog.style.cssText='position:fixed;left:30px;top:calc(100dvh - 240px);bottom:auto;right:auto;margin:0;width:300px;height:210px;padding:16px;overflow:auto';document.body.append(dialog);const host=document.createElement('div');host.style.cssText='margin-top:110px';dialog.append(host);createRoot(host).render(<PromptPicker onChange={()=>{}}/>);dialog.showModal();}

export async function mountLongDropdown(){const {default:Dropdown}=await import('../src/components/Dropdown');const dialog=document.createElement('dialog');dialog.style.cssText='position:fixed;inset:20px;margin:0;width:300px;height:400px;padding:16px';document.body.append(dialog);const host=document.createElement('div');dialog.append(host);createRoot(host).render(<Dropdown label="긴 목록" value="19999" options={Array.from({length:20000},(_,i)=>({value:String(i),label:`항목 ${i}`}))} onChange={value=>{(window as any).selectedDropdown=value;}}/>);dialog.showModal();}
