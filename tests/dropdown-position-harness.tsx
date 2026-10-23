import React from 'react';
import {createRoot} from 'react-dom/client';
import PromptPicker from '../src/components/PromptPicker';
export function mountDropdown(){const dialog=document.createElement('dialog');dialog.style.cssText='position:fixed;left:30px;top:calc(100dvh - 240px);bottom:auto;right:auto;margin:0;width:300px;height:210px;padding:16px;overflow:auto';document.body.append(dialog);const host=document.createElement('div');host.style.cssText='margin-top:110px';dialog.append(host);createRoot(host).render(<PromptPicker onChange={()=>{}}/>);dialog.showModal();}

export async function mountLongDropdown(){const {default:Dropdown}=await import('../src/components/Dropdown');const dialog=document.createElement('dialog');dialog.style.cssText='position:fixed;inset:20px;margin:0;width:300px;height:400px;padding:16px';document.body.append(dialog);const host=document.createElement('div');dialog.append(host);createRoot(host).render(<Dropdown label="긴 목록" value="19999" options={Array.from({length:20000},(_,i)=>({value:String(i),label:`항목 ${i}`}))} onChange={value=>{(window as any).selectedDropdown=value;}}/>);dialog.showModal();}
