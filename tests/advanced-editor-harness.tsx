import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AdvancedBookEditor from '../src/components/AdvancedBookEditor';
export function mountAdvanced(){
 const book={id:'advanced-harness',title:'편집 테스트',author:'모델',description:'',color:'#123456',createdAt:'2026-10-01',updatedAt:'2026-10-01',messages:[{role:'assistant',name:'화자',content:'보존할 본문',chapterStart:true,chapterTitle:'첫 장'},{role:'assistant',name:'다른 화자',content:'둘째 본문'}]};
 function Harness(){const [open,setOpen]=useState(true);return open?<AdvancedBookEditor book={book} onClose={()=>{setOpen(false);(window as any).editorClosed=true;}} onSave={async next=>{if((window as any).failEditorSave)throw Error('저장 실패 테스트');(window as any).savedEditorBook=next;}}/>:null;}
 const host=document.createElement('div');document.body.append(host);createRoot(host).render(<Harness/>);
}
