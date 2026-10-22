import {useSyncExternalStore} from 'react';

const tasks=new Set<symbol>();
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(listener=>listener());
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const snapshot=()=>tasks.size>0;

/** Only network I/O and page measurement qualify for skeleton placeholders. */
export function beginSkeletonTask(reason:'network'|'pagination'){
 const token=Symbol(reason);tasks.add(token);notify();
 return()=>{if(tasks.delete(token))notify();};
}
export function useSkeletonLoading(){return useSyncExternalStore(subscribe,snapshot,()=>false);}
