export type Theme='paper'|'warm'|'dark';
export const THEME_EVENT='galpi:theme-change';
const KEY='galpi.reader.appearance.v1';
export function readTheme():Theme{
 try{const value=JSON.parse(localStorage.getItem(KEY)||'{}');return value.theme==='warm'||value.theme==='dark'?value.theme:'paper';}catch{return 'paper';}
}
export function saveTheme(theme:Theme):void{
 let previous:Record<string,unknown>={};
 try{const value=JSON.parse(localStorage.getItem(KEY)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))previous=value;}catch{/* Restore a valid preferences object. */}
 try{localStorage.setItem(KEY,JSON.stringify({...previous,theme}));}catch{/* Keep theme changes available for this session when storage is blocked. */}
 window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT,{detail:theme}));
}
