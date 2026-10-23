import {useCallback,useState} from 'react';
import type {ToastTone} from '../components/Toast';
export function useToast(){
 const [toast,setToast]=useState({id:0,message:'',tone:'info' as ToastTone,duration:3600});
 const notify=useCallback((message:string,tone:ToastTone='info',duration=3600)=>setToast(previous=>({id:previous.id+1,message,tone,duration})),[]);
 const dismiss=useCallback(()=>setToast(previous=>({...previous,message:''})),[]);
 return {toast,notify,dismiss};
}
