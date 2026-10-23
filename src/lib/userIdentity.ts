import type {Book} from './library';
export const DEFAULT_USER_NAME='';
const surnames=new Set('김 이 박 최 정 강 조 윤 장 임 한 오 서 신 권 황 안 송 전 홍 유 고 문 양 손 배 백 허 남 심 노 하 곽 성 차 주 우 구 민 진 지 엄 채 원 천 방 공 현 함 변 염 여 추 도 소 석 선 설 마 길 연 위 표 명 기 반 왕 금 옥 육 인 맹 제 모 탁 국 어 은 편 용 예 봉 경 사 부 황보 남궁 독고 제갈 선우 사공 서문 동방'.split(' '));
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function givenName(name:string){
 if(!/^[가-힣]{3,4}$/.test(name))return;
 const surname=surnames.has(name.slice(0,2))?2:surnames.has(name[0])?1:0;
 const given=surname?name.slice(surname):'';return given.length>=2?given:undefined;
}
function ending(name:string):number|undefined{
 const code=name.trim().at(-1)?.charCodeAt(0);return code!==undefined&&code>=0xac00&&code<=0xd7a3?(code-0xac00)%28:undefined;
}
function particle(suffix:string,name:string){
 const final=ending(name);if(final===undefined)return suffix;
 const pairs=[['은','는'],['이','가'],['을','를'],['과','와'],['이랑','랑'],['이나','나'],['이든','든'],['아','야'],['이야','야'],['이다','다'],['이여','여']];
 if(suffix==='으로'||suffix==='로')return final&&final!==8?'으로':'로';
 for(const [consonant,vowel] of pairs)if(suffix===consonant||suffix===vowel)return final?consonant:vowel;
 return suffix;
}
/** Explicit import-time rename only. A blank field returns the original book.
 * Roles remain user/assistant; source aliases are never attached to the result. */
export function replaceBookUserName(book:Book,aliases:string[],chosen:string):Book{
 const userName=chosen.trim().slice(0,80);if(!userName)return book;
 const originals=[...aliases,book.userName??'{{user}}',...book.messages.filter(message=>['user','human'].includes(message.role.toLowerCase())).map(message=>message.name)];
 const names=[...new Set(originals.flatMap(name=>{const full=name.trim(),given=givenName(full);return given?[full,given]:[full];}).filter(name=>name&&name!==userName))].sort((a,b)=>b.length-a.length);
 // Match full names and their given-name aliases, avoiding unrelated longer
 // words. A particle may have common secondary particles attached to it.
 const suffix='(?:께서는|에게서|한테서|으로|이랑|이나|이든|이야|이다|이여|에게|한테|께|에서|까지|부터|처럼|보다|하고|님|씨|은|는|이|가|을|를|과|와|랑|나|든|아|야|여|다|로|의|도|만|에)?';
 const boundary='(?=(?:(?:도|만|요|의|은|는|이|가|을|를|부터|까지|라도|마저|조차)){0,2}(?:$|[^\\p{L}\\p{N}_]))';
 const expression=names.length?new RegExp('(?<![\\p{L}\\p{N}_])('+names.map(escape).join('|')+')('+suffix+')'+boundary,'gu'):undefined;
 function transform(text:string){
  if(!expression)return {text,map:(offset:number)=>offset};
  const changes:{start:number;end:number;replacement:string}[]=[];
  const result=text.replace(expression,(matched:string,_name:string,suffix:string,offset:number)=>{const replacement=userName+particle(suffix,userName);changes.push({start:offset,end:offset+matched.length,replacement});return replacement;});
  return {text:result,map:(offset:number)=>{let shift=0;for(const change of changes){if(offset<=change.start)break;if(offset<change.end)return change.start+shift+Math.min(offset-change.start,change.replacement.length);shift+=change.replacement.length-(change.end-change.start);}return offset+shift;}};
 }
 const replace=(text:string)=>transform(text).text,optional=(text:string|undefined)=>text===undefined?undefined:replace(text);
 const positions=book.messages.map(message=>transform(message.content));
 const messages=book.messages.map((message,index)=>({...message,name:['user','human'].includes(message.role.toLowerCase())?userName:replace(message.name),content:positions[index].text,
  originalContent:optional(message.originalContent),originalMap:message.originalMap?.map(point=>({source:transform(message.originalContent??message.content).map(point.source),output:positions[index].map(point.output)})),chapter:optional(message.chapter),chapterTitle:optional(message.chapterTitle)}));
 return {...book,userName,messages,title:replace(book.title),author:replace(book.author),description:replace(book.description),seriesTitle:optional(book.seriesTitle),aiModel:optional(book.aiModel),
  assets:book.assets?.map(asset=>({...asset,name:replace(asset.name)})),imageRules:book.imageRules?.map(rule=>({...rule,pattern:replace(rule.pattern),assetTemplates:rule.assetTemplates.map(replace)})),displayRules:book.displayRules?.map(rule=>({...rule,pattern:replace(rule.pattern),replacement:replace(rule.replacement)})),
  bookmarks:book.bookmarks?.map(mark=>({...mark,label:optional(mark.label),char:positions[mark.message]?.map(mark.char)??mark.char,...(positions.some((entry,index)=>entry.text.length!==book.messages[index].content.length)?{progress:undefined}:{})})),
 };
}
