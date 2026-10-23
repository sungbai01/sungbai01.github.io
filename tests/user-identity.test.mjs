import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replaceBookUserName} from '../src/lib/userIdentity.ts';
const book=(content,name='박성배')=>({id:'names',title:'제목',author:'',description:'',color:'#123456',createdAt:'',updatedAt:'',messages:[{role:'user',name,content,originalContent:content}]});
test('blank field preserves names content metadata and user role exactly',()=>{const source=book('박성배 성배야');assert.equal(replaceBookUserName(source,['박성배'],'   '),source);});
test('Korean full name and given name vocative use chosen full name',()=>{const next=replaceBookUserName(book('박성배, 성배야! 성배는 왔다.'),['박성배'],'김철수');assert.equal(next.messages[0].content,'김철수, 김철수야! 김철수는 왔다.');assert.equal(next.messages[0].name,'김철수');assert.equal(next.messages[0].role,'user');assert.equal(next.messages[0].originalContent,next.messages[0].content);assert.equal(next.userName,'김철수');});
test('foreign Hangul names retain their whole name and adjust particles',()=>{const source=book('알레한드로, 알레한드로야. 알레한드로는 알레한드로가 알레한드로를 알레한드로와 알레한드로로.', '알레한드로');assert.equal(replaceBookUserName(source,['알레한드로'],'김민준').messages[0].content,'김민준, 김민준아. 김민준은 김민준이 김민준을 김민준과 김민준으로.');});
test('particles also adjust from consonant to vowel endings',()=>{assert.equal(replaceBookUserName(book('박성준은 성준이 성준을 성준과 성준아.', '박성준'),['박성준'],'김철수').messages[0].content,'김철수는 김철수가 김철수를 김철수와 김철수야.');});
test('rieul uses 로 and compound surnames produce a given-name alias',()=>{assert.equal(replaceBookUserName(book('남궁성배는 성배로 갔다.', '남궁성배'),['남궁성배'],'김하늘').messages[0].content,'김하늘은 김하늘로 갔다.');});
test('unrelated longer words are not mistaken for a given name',()=>{assert.equal(replaceBookUserName(book('성배당 박성배 성배은행 성배는요.'),['박성배'],'김철수').messages[0].content,'성배당 김철수 성배은행 김철수는요.');});
test('bookmarks account for replacement and particle length without saving aliases',()=>{const source=book('성배야! 끝');source.bookmarks=[{message:0,char:5,progress:.5}];const next=replaceBookUserName(source,['박성배'],'김민준');assert.equal(next.messages[0].content,'김민준아! 끝');assert.equal(next.bookmarks[0].char,6);assert.equal('aliases' in next,false);});

test('secondary particles and names after quotation marks keep natural forms',()=>{assert.equal(replaceBookUserName(book('성배에게는 "성배가" 성배는요.'),['박성배'],'김민준').messages[0].content,'김민준에게는 "김민준이" 김민준은요.');});
