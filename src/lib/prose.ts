import { imageReferenceRanges } from './assets';

export type ProseRange = { start: number; end: number };

/** Half-open original UTF-16 ranges. Asset references must be protected first.
 * An unterminated opening brace hides the remaining text rather than leaking
 * a truncated system instruction. Stray closing braces are hidden by themselves.
 */
export function systemRanges(text: string, protectedRanges: ProseRange[] = []): ProseRange[] {
  const result: ProseRange[] = [];
  let depth = 0, start = 0, protectedIndex = 0;
  for (let index = 0; index < text.length; index++) {
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && index === protectedRange.start) { index = protectedRange.end - 1; protectedIndex++; continue; }
    if (text[index] === '{') { if (!depth) start = index; depth++; }
    else if (text[index] === '}') {
      if (depth) { depth--; if (!depth) result.push({ start, end: index + 1 }); }
      else result.push({ start: index, end: index + 1 });
    }
  }
  if (depth) result.push({ start, end: text.length });
  return result;
}

/** Display-only: never use resulting lengths as original bookmark positions.
 * Resolve images before applying this to prose; unknown brace macros disappear.
 */
export function visibleProse(text: string): string {
  let result = '', cursor = 0;
  const images = imageReferenceRanges(text);
  const ranges = [...systemRanges(text, images), ...images].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const range of ranges) { if (range.end <= cursor) continue; result += text.slice(cursor, Math.max(cursor, range.start)); cursor = range.end; }
  return result + text.slice(cursor);
}

