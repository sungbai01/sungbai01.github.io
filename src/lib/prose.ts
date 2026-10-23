import {normalizeDisplayPrompt,type DisplayPrompt} from '../../shared/displayPrompt';
import { imageReferenceRanges } from './assets';

export type ProseRange = { start: number; end: number };

/** Common display rules apply independently of prompt selection. */
export function hiddenUserInput(message:{role:string}):boolean{return message.role==='user';}
export function dollarOnlyRanges(text:string):ProseRange[]{
 return Array.from(text.matchAll(/^[^\S\r\n]*\$[^\S\r\n]*(?:\r\n?|\n|$)/gm),match=>({start:match.index!,end:match.index!+match[0].length}));
}

/** Quotes delimit an attribute only immediately after '='. Apostrophes in
 * unquoted prose (Hyuna's apartment) must not consume the closing bracket. */
export function angleRanges(text: string, protectedRanges: ProseRange[] = []): ProseRange[] {
  const ranges: ProseRange[] = [];
  let protectedIndex = 0;
  for (let start = 0; start < text.length; start++) {
    while (protectedRanges[protectedIndex] && protectedRanges[protectedIndex]!.end <= start) protectedIndex++;
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && start === protectedRange.start) { start = protectedRange.end - 1; continue; }
    if (text[start] !== '<') continue;
    let quote = '', previous = '';
    for (let end = start + 1; end < text.length; end++) {
      const char = text[end]!;
      if (quote) {
        let escapes = 0;
        for (let cursor = end - 1; cursor >= start && text[cursor] === '\\'; cursor--) escapes++;
        if (char === quote && escapes % 2 === 0) quote = '';
      } else if ((char === '"' || char === "'") && previous === '=') quote = char;
      else if (char === '>') { ranges.push({ start, end: end + 1 }); start = end; break; }
      if (!/\s/.test(char)) previous = char;
    }
  }
  return ranges;
}

/** Half-open original UTF-16 ranges. Asset references must be protected first.
 * An unterminated opening brace hides the remaining text rather than leaking
 * a truncated system instruction. Stray closing braces are hidden by themselves.
 */
export function systemRanges(text: string, protectedRanges: ProseRange[] = [],preserveUser=true): ProseRange[] {
  const result: ProseRange[] = [];
  let depth = 0, start = 0, protectedIndex = 0;
  for (let index = 0; index < text.length; index++) {
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && index === protectedRange.start) { index = protectedRange.end - 1; protectedIndex++; continue; }
    if (preserveUser && !depth && text.slice(index, index + 8).toLowerCase() === '{{user}}') { index += 7; continue; }
    if (text[index] === '{') { if (!depth) start = index; depth++; }
    else if (text[index] === '}') {
      if (depth) { depth--; if (!depth) result.push({ start, end: index + 1 }); }
      else result.push({ start: index, end: index + 1 });
    }
  }
  if (depth) result.push({ start, end: text.length });
  return result;
}

/** Nested square blocks use original offsets and skip complete image markers. */
export function squareRanges(text:string,protectedRanges:ProseRange[]=[]):ProseRange[]{
 const result:ProseRange[]=[];let depth=0,start=0,protectedIndex=0;
 for(let index=0;index<text.length;index++){
  while(protectedRanges[protectedIndex]&&protectedRanges[protectedIndex].end<=index)protectedIndex++;
  const reference=protectedRanges[protectedIndex];
  if(reference&&reference.start===index){index=reference.end-1;continue;}
  if(text[index]==='['){if(!depth)start=index;depth++;}
  else if(text[index]===']'){if(depth&&!--depth)result.push({start,end:index+1});}
 }
 if(depth)result.push({start,end:text.length});
 return result;
}
/** Display rules never modify stored text or source positions. Asset ranges
 * remain protected even inside hidden blocks and while assets are unresolved. */
export function displayHiddenRanges(text:string,prompt?:DisplayPrompt,images=imageReferenceRanges(text)):ProseRange[]{
 const settings=normalizeDisplayPrompt(prompt);
 return [...dollarOnlyRanges(text),...(settings.hideCurly?systemRanges(text,images,false):[]),...(settings.hideSquare?squareRanges(text,images):[])].sort((a,b)=>a.start-b.start||b.end-a.end);
}
export function visibleSlice(text:string,start:number,end:number,prompt?:DisplayPrompt):string{
 const images=imageReferenceRanges(text),ranges=[...displayHiddenRanges(text,prompt,images),...images].sort((a,b)=>a.start-b.start||b.end-a.end);
 let result='',cursor=start;
 for(const range of ranges){if(range.end<=cursor||range.start>=end)continue;result+=text.slice(cursor,Math.max(cursor,range.start));cursor=Math.min(end,range.end);}
 return result+text.slice(cursor,end);
}
/** For full-source previews/search only. Page fragments are already partitioned. */
export function visibleProse(text:string,prompt?:DisplayPrompt):string{return visibleSlice(text,0,text.length,prompt);}
