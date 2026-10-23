import {importAssetFileInProcess} from './assets';
self.onmessage=async(event:MessageEvent<File>)=>{
 try{self.postMessage({ok:true,value:await importAssetFileInProcess(event.data)});}
 catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'에셋을 읽지 못했어요.'});}
};
