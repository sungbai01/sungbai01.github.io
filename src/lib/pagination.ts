import type { Book, BookAsset } from './library';
import { extractAssetSegments } from './assets';

export type Anchor = { message: number; char: number };
export type Fragment = Anchor & { end: number; name: string; text: string };
export type PaperPage = { fragments: Fragment[]; intro: boolean; asset?: BookAsset; kind?: 'paper' | 'asset' | 'padding' | 'endpaper' | 'back-cover' | 'end' };

/** Removes complete emoji sequences, leaving ordinary digits and punctuation.
 * This changes offsets: use at import confirmation, before pagination, or for
 * display only. Never use its output to infer positions in the original text.
 */
export function cleanText(text: string): string {
  return text.replace(/[#*0-9]\uFE0F?\u20E3|[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?|\p{Emoji_Modifier}/gu, '');
}

export function speakerName(message: Book['messages'][number]): string {
  const roles: Record<string, string> = { user: '독자', assistant: '이야기', system: '안내', developer: '설정', tool: '도구', narrator: '서술자' };
  return message.name || roles[message.role] || '서술자';
}

/** Render the same small Markdown subset as Reader, via text nodes only. */
function measureText(target: HTMLElement, text: string): void {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|“[^”]+”|「[^」]+」)/g);
  target.replaceChildren();
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      const node = document.createElement('strong'); node.textContent = part.slice(2, -2); target.append(node);
    } else if (/^[*_]/.test(part) && part.length > 2) {
      const node = document.createElement('em'); node.textContent = part.slice(1, -1); target.append(node);
    } else if (/^[“「]/.test(part)) {
      const node = document.createElement('span'); node.className = 'reader-dialogue'; node.textContent = part; target.append(node);
    } else target.append(document.createTextNode(part));
  }
}

/** Pure source partitioning plus DOM measurement; never saves or splits books.
 * Fragment text is always the exact original slice, including raw asset tokens.
 * Physical-left leaves have zero-based even indexes, including padding pages.
 * Emoji retained at import remain visible/measured; this function never strips.
 */
export function paginate(book: Book, measure: HTMLDivElement): PaperPage[] {
  const pages: PaperPage[] = [{ fragments: [], intro: false }];
  let current = pages[0]!;
  measure.replaceChildren();
  const nextPage = () => { current = { fragments: [], intro: false }; pages.push(current); measure.replaceChildren(); };
  book.messages.forEach((message, messageIndex) => {
    const content = message.content || '', name = speakerName(message);
    const segments = extractAssetSegments(content, book.assets ?? []);
    if (!content.length) { current.fragments.push({ message: messageIndex, char: 0, end: 0, name, text: '' }); return; }
    for (const segment of segments) {
      if (segment.type === 'asset') {
        if (current.fragments.length) nextPage();
        if ((pages.length - 1) % 2 === 1) { current.kind = 'padding'; nextPage(); }
        current.kind = 'asset'; current.asset = segment.asset;
        current.fragments.push({ message: messageIndex, char: segment.start, end: segment.end, name, text: content.slice(segment.start, segment.end) });
        nextPage(); continue;
      }
      let offset = segment.start;
      while (offset < segment.end) {
        const section = document.createElement('section'); section.className = 'reader-fragment';
        if (offset === 0) { const label = document.createElement('div'); label.className = 'reader-message-name'; label.textContent = name; section.append(label); }
        const paragraph = document.createElement('p'); paragraph.className = 'reader-prose'; section.append(paragraph); measure.append(section);
        const fits = (end: number) => { measureText(paragraph, content.slice(offset, end)); return measure.scrollHeight <= measure.clientHeight; };
        let low = offset, high = Math.min(segment.end, offset + 256), upperFits = fits(high);
        while (upperFits && high < segment.end) { low = high; high = Math.min(segment.end, offset + (high - offset) * 2); upperFits = fits(high); }
        let end = high;
        if (!upperFits) {
          while (low < high) { const mid = Math.ceil((low + high) / 2); if (fits(mid)) low = mid; else high = mid - 1; }
          end = low;
          if (end > offset && /[\uD800-\uDBFF]/.test(content.charAt(end - 1))) end--;
          if (end === offset) {
            section.remove();
            if (current.fragments.length) { nextPage(); continue; }
            end = offset + (content.codePointAt(offset)! > 0xffff ? 2 : 1); measure.append(section);
          } else {
            const tail = content.slice(offset, end), boundary = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf(' '), tail.lastIndexOf('\t'));
            if (boundary > tail.length * .72) end = offset + boundary + 1;
          }
          measureText(paragraph, content.slice(offset, end));
        }
        current.fragments.push({ message: messageIndex, char: offset, end, name, text: content.slice(offset, end) });
        offset = end;
        if (offset < segment.end) nextPage();
      }
    }
  });
  if (pages.length > 1 && !current.fragments.length && current.kind !== 'asset') pages.pop();
  return pages;
}
