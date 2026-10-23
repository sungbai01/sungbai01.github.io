export type DisplayPrompt={id:'default'|'soakma';hideCurly:boolean;hideSquare:boolean};
export const DEFAULT_DISPLAY_PROMPT:Readonly<DisplayPrompt>=Object.freeze({id:'default',hideCurly:true,hideSquare:true});
export function validDisplayPrompt(value:unknown):value is DisplayPrompt{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const entry=value as Record<string,unknown>;
 return Object.keys(entry).every(key=>['id','hideCurly','hideSquare'].includes(key))&&(entry.id==='default'||entry.id==='soakma')&&typeof entry.hideCurly==='boolean'&&typeof entry.hideSquare==='boolean';
}
export function normalizeDisplayPrompt(value:unknown):DisplayPrompt{return validDisplayPrompt(value)?{id:value.id,hideCurly:value.hideCurly,hideSquare:value.hideSquare}:{...DEFAULT_DISPLAY_PROMPT};}
export type ImageReference={message:number;start:number;end:number;name:string};
