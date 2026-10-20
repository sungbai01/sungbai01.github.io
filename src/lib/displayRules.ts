import type { Book } from './library';
import { displayPlainText } from './library';
import { imageReferenceRanges } from './assets';
import { systemRanges } from './prose';
import { normalizeImageRules } from './imageRules';

export type DisplayRule = { pattern: string; replacement: string; flags: string; type?: 'editinput' | 'editoutput' | 'editdisplay' | 'editprocess' };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const modes = ['editinput', 'editoutput', 'editdisplay', 'editprocess'];

/** Legacy shelves retained only image templates. Recover their image rewrite
 * without fabricating the original card's discarded HTML/CBS or other rules.
 * An explicitly stored [] means rules were removed and must stay removed.
 */
export function legacyDisplayRules(imageRules: unknown): DisplayRule[] {
  return normalizeImageRules(imageRules).map(rule => ({ pattern: rule.pattern,
    replacement: rule.assetTemplates.map(name => `{{img::${name}}}`).join('\n'),
    flags: `g${rule.flags ?? ''}`, type: 'editdisplay' }));
}

/** Shape-only normalization: compilation/matching happens solely in the worker.
 * Repeated rules remain repeated, preserving intentional sequential card order.
 */
export function normalizeDisplayRules(value: unknown): DisplayRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): DisplayRule[] => {
    if (!record(entry)) return [];
    const pattern = typeof entry.pattern === 'string' ? entry.pattern : typeof entry.in === 'string' ? entry.in : undefined;
    const replacement = typeof entry.replacement === 'string' ? entry.replacement : typeof entry.out === 'string'
      ? entry.out.replace(/\$n/g, '\n').replace(/\{\{data\}\}/g, () => '$&') : undefined;
    const flags = typeof entry.pattern === 'string'
      ? (typeof entry.flags === 'string' ? entry.flags : 'g')
      : entry.ableFlag === true ? String(entry.flag || entry.flags || 'g') : 'g';
    if (pattern === undefined || replacement === undefined || !/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length ||
        (entry.type !== undefined && !modes.includes(String(entry.type)))) return [];
    return [{ pattern, replacement, flags,
      ...(entry.type === undefined ? {} : { type: entry.type as DisplayRule['type'] }) }];
  });
}

export function extractDisplayRules(value: unknown, warnings?: string[]): DisplayRule[] {
  const found: unknown[] = [], visited = new Set<object>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 20 || !node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) { node.forEach(entry => visit(entry, depth + 1)); return; }
    if (!record(node)) return;
    if (typeof node.pattern === 'string' && typeof node.replacement === 'string') found.push(node);
    else if (typeof node.in === 'string' && typeof node.out === 'string' && (!node.type || modes.includes(String(node.type)))) {
      // Risu defaults to global replacement when custom flags are disabled.
      const flags = node.ableFlag === true ? String(node.flag || node.flags || 'g') : 'g';
      found.push({ pattern: node.in, replacement: node.out.replace(/\$n/g, '\n').replace(/\{\{data\}\}/g, () => '$&'), flags,
        ...(node.type ? { type: node.type } : {}) });
    }
    for (const key of ['data', 'extensions', 'risuai', 'module', 'modules', 'regex', 'customscript', 'customScripts', 'scripts', 'displayRules']) if (key in node) visit(node[key], depth + 1);
  };
  visit(value, 0);
  const rules = normalizeDisplayRules(found);
  if (rules.length !== found.length) warnings?.push('지원하지 않는 정규식 플래그 또는 규칙 형식이 있습니다. 패턴 문법은 적용 시 격리된 작업자에서 검사합니다.');
  return rules;
}

type Point = { source: number; output: number };
type WorkerResult = { ok: boolean; content: string; anchors: number[]; map?: Point[]; error?: string };

export function originalOffset(message: Book['messages'][number], output: number): number {
  const source = message.originalContent ?? message.content;
  if (output <= 0) return 0;
  if (output >= message.content.length) return source.length;
  const map = message.originalMap;
  if (map) for (let i = 1; i < map.length; i++) {
    const left = map[i - 1]!, right = map[i]!;
    if (output <= right.output) return left.source + Math.round((output - left.output) * (right.source - left.source) / Math.max(1, right.output - left.output));
  }
  return Math.round(output * source.length / Math.max(1, message.content.length));
}
function runWorker(worker: Worker, request: unknown): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('정규식 처리가 5초를 초과해 중단했습니다. 기존 책은 변경되지 않았습니다.')); }, 5000);
    const finish = () => { clearTimeout(timer); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; };
    worker.onmessage = event => { finish(); const result = event.data as WorkerResult; result.ok ? resolve(result) : reject(new Error(result.error || '정규식 처리를 완료하지 못했습니다.')); };
    worker.onerror = () => { finish(); reject(new Error('정규식 작업자를 실행하지 못했습니다. 기존 책은 변경되지 않았습니다.')); };
    worker.onmessageerror = () => { finish(); reject(new Error('정규식 작업자 결과를 읽지 못했습니다.')); };
    try { worker.postMessage(request); } catch (cause) { finish(); reject(cause); }
  });
}

/** Sanitizes replacement output inertly, preserves image macros/tags, removes
 * unsupported CBS/system blocks without evaluating their contents or branches.
 */
function renderOutput(raw: string, book: Book, end = raw.length): string {
  raw = raw.slice(0, end);
  const names = (book.assets ?? []).map(asset => asset.name);
  const expression = (input: string): string | undefined => {
    const text = input.trim();
    if (text === '{{assetlist}}') return names.join('::');
    if (!text.startsWith('{{')) return text;
    if (!text.endsWith('}}')) return undefined;
    const body = text.slice(2, -2);
    let depth = 0, cursor = 0;
    const parts: string[] = [];
    for (let i = 0; i < body.length; i++) {
      if (body.slice(i, i + 2) === '{{') { depth++; i++; }
      else if (body.slice(i, i + 2) === '}}') { depth--; i++; }
      else if (!depth && body.slice(i, i + 2) === '::') { parts.push(body.slice(cursor, i)); cursor = i + 2; i++; }
    }
    parts.push(body.slice(cursor));
    const args = parts.slice(1).map(expression);
    if (parts[0] === 'not' && args[0] !== undefined) return args[0] === 'true' || args[0] === '1' ? 'false' : 'true';
    if (parts[0] === 'contains' && args[0] !== undefined && args[1] !== undefined) return String(parts[1]?.trim() === '{{assetlist}}' ? names.includes(args[1]) : args[0].includes(args[1]));
    return undefined;
  };
  // Balanced literal CBS tokens only; no calls into the Risu parser or eval.
  const stack: boolean[] = [];
  let conditioned = '';
  for (let i = 0; i < raw.length;) {
    if (raw.slice(i, i + 2) !== '{{') { if (stack.every(Boolean)) conditioned += raw[i]; i++; continue; }
    let depth = 1, finish = i + 2;
    while (finish < raw.length && depth) {
      if (raw.slice(finish, finish + 2) === '{{') { depth++; finish += 2; }
      else if (raw.slice(finish, finish + 2) === '}}') { depth--; finish += 2; }
      else finish++;
    }
    const token = raw.slice(i, finish);
    if (/^\{\{#if\s/.test(token)) stack.push(expression(token.slice(6, -2)) === 'true' || expression(token.slice(6, -2)) === '1');
    else if (token === '{{/if}}') stack.pop();
    else if (token === '{{else}}' && stack.length) stack[stack.length - 1] = !stack[stack.length - 1];
    else if (stack.every(Boolean) && /^\{\{(?:raw|img|image)::/i.test(token)) conditioned += token;
    i = finish;
  }
  raw = conditioned.replace(/<[^>]*>/g, tag => {
    const macros = Array.from(tag.matchAll(/\{\{(?:raw|img|image)::([^{}]+)\}\}/gi), match => `{{img::${match[1]}}}`);
    const css = Array.from(tag.matchAll(/background-image\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi), match => match[1]!.trim())
      .filter(name => names.includes(name)).map(name => `{{img::${name}}}`);
    return [...macros, ...css].join('') + (macros.length || css.length ? '' : tag);
  });
  end = raw.length;
  const references = imageReferenceRanges(raw);
  const hidden = systemRanges(raw, references);
  let value = '', cursor = 0;
  for (const range of hidden) { if (range.start >= end) break; value += raw.slice(cursor, Math.min(end, range.start)); cursor = Math.min(end, range.end); }
  value += raw.slice(cursor, end);
  // Unsupported conditional expressions select no branch; imported code is
  // never interpreted. Supported asset checks use the current shelf library.
  return displayPlainText(value, book.assets ?? [], book.imageRules ?? []);
}

/** No persistence or splitting. Build the complete result before the caller
 * commits anything. All rule types process the imported log only: editinput
 * targets users, editoutput characters, editdisplay/editprocess every role.
 * Existing anchors are retained/remapped, never cleared. Inside replaced spans
 * positions are mapped proportionally; unchanged margins retain exact offsets.
 */
export async function applyBookDisplayRules(book: Book, rules: DisplayRule[]): Promise<Book> {
  const normalized = normalizeDisplayRules(rules);
  if (normalized.length !== rules.length) throw new Error('정규식 규칙의 형식 또는 플래그가 올바르지 않습니다.');
  if (!normalized.length) return { ...book, displayRules: [], messages: book.messages.map(message => ({ ...message,
    originalContent: message.originalContent ?? message.content,
    content: message.originalContent === undefined ? message.content : displayPlainText(message.originalContent, book.assets ?? [], book.imageRules ?? []),
    originalMap: message.originalContent === undefined ? message.originalMap : [{ source: 0, output: 0 }, { source: message.originalContent.length, output: displayPlainText(message.originalContent, book.assets ?? [], book.imageRules ?? []).length }] })),
    ...(book.bookmarks ? { bookmarks: book.bookmarks.map(mark => {
      const message = book.messages[mark.message]!;
      const content = message.originalContent === undefined ? message.content : displayPlainText(message.originalContent, book.assets ?? [], book.imageRules ?? []);
      const sourceChar = originalOffset(message, mark.char);
      const char = message.originalContent === undefined ? mark.char : Math.min(content.length, displayPlainText(message.originalContent.slice(0, sourceChar), book.assets ?? [], book.imageRules ?? []).length);
      const { progress: _progress, ...anchor } = mark; return { ...anchor, char };
    }) } : {}) };
  const worker = new Worker(new URL('./displayRules.worker.ts', import.meta.url), { type: 'module' });
  try {
    await runWorker(worker, { source: '', current: '', role: '', anchors: [], rules: normalized, validateOnly: true });
    const bookmarks = book.bookmarks?.map(mark => ({ ...mark }));
    const messages: Book['messages'] = [];
    for (const [index, message] of book.messages.entries()) {
      const source = message.originalContent ?? message.content;
      const marks = (bookmarks ?? []).filter(mark => mark.message === index);
      const result = await runWorker(worker, { source, current: message.content, role: message.role.toLowerCase(), anchors: marks.map(mark => mark.char),
        ...(message.originalMap ? { sourceAnchors: marks.map(mark => originalOffset(message, mark.char)) } : {}), rules: normalized });
      const content = renderOutput(result.content, book);
      marks.forEach((mark, position) => {
        mark.char = Math.min(content.length, renderOutput(result.content, book, result.anchors[position]).length);
        if (content !== message.content) delete mark.progress;
      });
      let previousOutput = 0;
      const originalMap = (result.map ?? [{ source: 0, output: 0 }, { source: source.length, output: result.content.length }]).map(point => {
        const output = Math.max(previousOutput, Math.min(content.length, renderOutput(result.content, book, point.output).length)); previousOutput = output;
        return { source: point.source, output };
      });
      originalMap.unshift({ source: 0, output: 0 }); originalMap.push({ source: source.length, output: content.length });
      messages.push({ ...message, originalContent: source, originalMap, content });
    }
    return { ...book, displayRules: normalized, messages, ...(bookmarks ? { bookmarks } : {}) };
  } finally { worker.terminate(); }
}
