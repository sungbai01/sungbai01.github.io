import {LogOut} from 'lucide-react';
export default function AccountSummary({connected,disabled,onLogout}:{connected:boolean;disabled?:boolean;onLogout:()=>void}){
 return <div className="account-summary"><div><strong>{connected?'Google 계정':'게스트'}</strong><span>{connected?'텍스트 · 클라우드 보관':'이 브라우저에 보관'}</span></div>{connected&&<button type="button" className="icon-btn" aria-label="로그아웃" title="로그아웃" disabled={disabled} onClick={onLogout}><LogOut size={16}/></button>}</div>;
}
