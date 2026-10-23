import {Component,type ReactNode} from 'react';
import BookOpening from './BookOpening';
const RETRY_KEY='galpi.reader.module-retry.v1';
export default class ReaderBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:Error){
  // A suspended tab can still reference chunks removed by a newer deployment.
  // Reload once to obtain the current entry point, retaining the book URL.
  if(!/dynamically imported module|module script|importing a module|loading chunk|preload.*css|failed to fetch/i.test(error.message))return;
  try{const last=Number(sessionStorage.getItem(RETRY_KEY)||0);if(Date.now()-last<60000)return;sessionStorage.setItem(RETRY_KEY,String(Date.now()));location.reload();}catch{/* Manual retry remains available. */}
 }
 render(){return this.state.failed?<BookOpening error="책 화면을 불러오지 못했어요. 다시 시도해 주세요." onBack={()=>{location.hash='/';location.reload();}} onRetry={()=>location.reload()}/>:this.props.children;}
}
