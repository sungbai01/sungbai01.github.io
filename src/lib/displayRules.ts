import type { Book } from './library';
import { imageReferenceRanges } from './assets';
import { imageOutputTemplates, normalizeImageRules } from './imageRules';

/** Compatibility name: these are exclusively image-token rewrite rules. */
export type DisplayRule = { pattern: string; replacement: string; flags: string; type?: 'editinput' | 'editoutput' | 'editdisplay' | 'editprocess' };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const modes = ['editinput', 'editoutput', 'editdisplay', 'editprocess'];

export function legacyDisplayRules(imageRules: unknown): DisplayRule[] {
  return normalizeImageRules(imageRules).map(rule => ({ pattern: rule.pattern,
    replacement: rule.assetTemplates.map(name => `{{img::${name}}}`).join('\n'),
    flags: `g${rule.flags ?? ''}`, type: 'editdisplay' }));
}

/** Never compile imported regex on the UI thread. Old general replacements
 * normalize to image identifiers only, or are dropped entirely. */
export function normalizeDisplayRules(value: unknown): DisplayRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): DisplayRule[] => {
    if (!record(entry)) return [];
    const canonical = typeof entry.pattern === 'string';
    const pattern = canonical ? entry.pattern as string : typeof entry.in === 'string' ? entry.in : undefined;
    const output = typeof entry.replacement === 'string' ? entry.replacement : typeof entry.out === 'string' ? entry.out : undefined;
    if (!pattern || !/img/i.test(pattern) || output === undefined) return [];
    const templates = imageOutputTemplates(output);
    if (!templates.length) return [];
    const flags = canonical ? (typeof entry.flags === 'string' ? entry.flags : 'g')
      : entry.ableFlag === true ? String(entry.flag || entry.flags || 'g') : 'g';
    if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length ||
        (entry.type !== undefined && !modes.includes(String(entry.type)))) return [];
    return [{ pattern, replacement: templates.map(name => `{{img::${name}}}`).join('\n'), flags,
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
    if ((typeof node.pattern === 'string' && typeof node.replacement === 'string') ||
        (typeof node.in === 'string' && typeof node.out === 'string')) found.push(node);
    for (const key of ['data', 'extensions', 'risuai', 'module', 'modules', 'regex', 'customscript', 'customScripts', 'scripts', 'displayRules']) if (key in node) visit(node[key], depth + 1);
  };
  visit(value, 0);
  for (const entry of found) {
    const item = entry as Record<string, unknown>;
    const output = String(item.replacement ?? item.out ?? '');
    if (!imageOutputTemplates(output).length) continue;
    const flags = typeof item.pattern === 'string' ? (typeof item.flags === 'string' ? item.flags : 'g')
      : item.ableFlag === true ? String(item.flag || item.flags || 'g') : 'g';
    if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length)
      warnings?.push('이미지 정규식의 플래그가 올바르지 않아 해당 규칙을 제외했습니다.');
  }
  return normalizeDisplayRules(found);
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
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('이미지 정규식 처리가 5초를 초과해 중단했습니다. 기존 책은 변경되지 않았습니다.')); }, 5000);
    const finish = () => { clearTimeout(timer); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; };
    worker.onmessage = event => { finish(); const result = event.data as WorkerResult; result.ok ? resolve(result) : reject(new Error(result.error || '이미지 정규식 처리를 완료하지 못했습니다.')); };
    worker.onerror = () => { finish(); reject(new Error('이미지 정규식 작업자를 실행하지 못했습니다.')); };
    worker.onmessageerror = () => { finish(); reject(new Error('이미지 정규식 작업자 결과를 읽지 못했습니다.')); };
    try { worker.postMessage(request); } catch (cause) { finish(); reject(cause); }
  });
}
function outputOffset(points: Point[], source: number): number {
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1]!, right = points[i]!;
    if (source <= right.source) return left.output + Math.round((source - left.source) * (right.output - left.output) / Math.max(1, right.source - left.source));
  }
  return points[points.length - 1]?.output ?? 0;
}

/** Only syntactic image tokens are submitted to the isolated worker, bounded
 * to 2048 UTF-16 units each. General prose/HTML/CBS is never a replacement
 * target. Results must contain canonical image macros only. Nothing persists
 * until the caller commits the complete book; timeout/errors reject atomically. */
export async function applyBookDisplayRules(book: Book, rules: DisplayRule[]): Promise<Book> {
  const normalized = normalizeDisplayRules(rules);
  if (!normalized.length) return { ...book, displayRules: [] };
  const worker = normalized.length ? new Worker(new URL('./displayRules.worker.ts', import.meta.url), { type: 'module' }) : undefined;
  try {
    if (worker) await runWorker(worker, { source: '', current: '', role: '', anchors: [], rules: normalized, validateOnly: true });
    const bookmarks = book.bookmarks?.map(mark => ({ ...mark }));
    const messages: Book['messages'] = [];
    for (const [index, message] of book.messages.entries()) {
      // Image-only updates operate on the cleaned current text. Original
      // archives are retained for preservation, never replayed into the book.
      const source = message.content;
      let raw = '', cursor = 0;
      const points: Point[] = [{ source: 0, output: 0 }];
      for (const range of imageReferenceRanges(source)) {
        raw += source.slice(cursor, range.start);
        points.push({ source: range.start, output: raw.length });
        const token = source.slice(range.start, range.end);
        let replacement = token;
        let localMap: Point[] | undefined;
        if (worker && token.length <= 2048) {
          const result = await runWorker(worker, { source: token, current: token, role: message.role.toLowerCase(), anchors: [], rules: normalized });
          // Captures cannot introduce tags, code, nested macros or free prose.
          if (/^(?:\s*\{\{img::[^{}<>\r\n\u0000]+\}\}\s*)+$/.test(result.content)) {
            replacement = result.content; localMap = result.map;
          }
        }
        if (localMap) for (const point of localMap) points.push({ source: range.start + point.source, output: raw.length + point.output });
        raw += replacement; cursor = range.end;
        points.push({ source: range.end, output: raw.length });
      }
      raw += source.slice(cursor);
      points.push({ source: source.length, output: raw.length });
      const content = raw;
      const baseline = message.originalContent ?? source;
      const priorMap = message.originalMap ?? [{ source: 0, output: 0 }, { source: baseline.length, output: source.length }];
      const originalMap = priorMap.map(point => ({ source: point.source, output: outputOffset(points, point.output) }));
      // Include new replacement boundaries in the archived-source mapping.
      for (const point of points) originalMap.push({ source: originalOffset(message, point.source), output: point.output });
      originalMap.sort((left, right) => left.source - right.source || left.output - right.output);
      let previous = 0;
      for (const point of originalMap) { point.output = Math.max(previous, point.output); previous = point.output; }
      for (const mark of bookmarks ?? []) if (mark.message === index) {
        mark.char = Math.min(content.length, outputOffset(points, mark.char));
        if (content !== message.content) delete mark.progress;
      }
      messages.push({ ...message, originalContent: baseline, originalMap, content });
    }
    return { ...book, displayRules: normalized, messages, ...(bookmarks ? { bookmarks } : {}) };
  } finally { worker?.terminate(); }
}
