import type { BookAsset } from './library';
import { extractImageRules, imageRuleCandidates, normalizeImageRules, type ImageRule } from './imageRules';
import { readModuleData,readModuleBundle } from './rpack';
import { extractDisplayRules, type DisplayRule } from './displayRules';
import { Inflate } from 'fflate';
import { jade } from '@radix-ui/colors';

/** Format references (read 2026-10-20): Risuai/src/ts/characterCards.ts
 * blob 99fad382849378dcf130706ab36438726d4c4685 and src/ts/pngChunk.ts.
 * V3 data.assets: {type,name,uri,ext}; V2 extensions.risuai has emotions
 * [name,base64] and additionalAssets [name,base64,ext]. PNG metadata is base64
 * JSON in chara/ccv3 and base64 bytes in chara-ext-asset_:N, via __asset:N.
 * CHARX follows src/ts/process/processzip.ts: ZIP containing card.json and
 * embeded:// paths. Its writeJpeg appends ZIP after JPEG (ZIP offsets exclude
 * that prefix). Archives are read only in memory; card scripts never run.
 */
const MAX_ASSETS = 2000;
// Decompressed CHARX budgets, independent of the uploaded file's size.
const MAX_CHARX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_CHARX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_CHARX_CARD_BYTES = 2 * 1024 * 1024;
const MAX_CHARX_MODULE_BYTES = 8 * 1024 * 1024;

function charxEntryLimit(name: string): number {
  return name === 'card.json' ? MAX_CHARX_CARD_BYTES :
    name === 'module.risum' ? MAX_CHARX_MODULE_BYTES : MAX_CHARX_ENTRY_BYTES;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const id = () => crypto.randomUUID();

/** Raster data URLs and explicit HTTP(S) URLs only; never blob/script/file/SVG.
 * This validates a reference, and does not fetch or decode remote images.
 */
export function safeAssetSource(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const src = value.trim();
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z\d+/=\s]+$/i.test(src)) return src;
  try {
    const url = new URL(src);
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return src;
  } catch { /* Relative paths and card-local paths require the missing files. */ }
  return undefined;
}

export function uniqueAssetName(preferred: string, existing: Iterable<string>): string {
  const name = preferred.trim();
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  let number = 2;
  while (taken.has(`${name} (${number})`)) number++;
  return `${name} (${number})`;
}

/** Preserve first names and explicitly numbered names; only rename collisions. */
export function numberAssetNames(assets: BookAsset[]): BookAsset[] {
  const reserved = new Set(assets.map(asset => asset.name.trim()));
  const used = new Set<string>();
  return assets.map(asset => {
    const original = asset.name.trim();
    const name = used.has(original) ? uniqueAssetName(original, [...reserved, ...used]) : original;
    used.add(name);
    return name === asset.name ? asset : { ...asset, name };
  });
}

/** Canonical shelf assets; invalid records are dropped, IDs stay stable.
 * Matching remains case-sensitive, as it is in Risu image references.
 */
export function normalizeAssets(value: unknown): BookAsset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return numberAssetNames(value.flatMap((entry): BookAsset[] => {
    if (!object(entry) || typeof entry.name !== 'string' || !entry.name.trim()) return [];
    const src = safeAssetSource(entry.src);
    if (!src) return [];
    let assetId = typeof entry.id === 'string' && entry.id.trim() ? entry.id : id();
    if (ids.has(assetId)) assetId = id();
    ids.add(assetId);
    return [{ id: assetId, name: entry.name.trim(), src,
      ...(entry.type === 'icon' || entry.type === 'asset' ? { type: entry.type } : {}) }];
  }));
}

export type AssetSegment =
  | { type: 'text'; text: string; start: number; end: number }
  | { type: 'asset'; asset: BookAsset; start: number; end: number };

// Shared by resolution, import protection and display hiding. Keep whole tags,
// including quoted delimiters; broad bracket forms are intentional Risu input.
function imagePattern(): RegExp {
  return /<img(?:[^<>"']|"[^"]*"|'[^']*')*(?:>|$)|\{\{(?:img|image|raw)::([^{}\r\n]+)\}\}|!\[(?:\\.|[^\]\\])*\]\(\s*(<[^>\r\n]+>|\{\{(?:img|image|raw)::[^{}\r\n]+\}\}|(?:\\.|[^\s()])+)(?:\s+["'][^\r\n]*?["'])?\s*\)|\[img(?:[^\]"'\r\n]|"[^"]*"|'[^']*')*(?:\]|$)/gi;
}

/** Syntactic references, even without a registered image. Preserve these bytes
 * during import so a later shelf-library addition can resolve them. */
export function imageReferenceRanges(content: string): { start: number; end: number }[] {
  return Array.from(content.matchAll(imagePattern()), match => ({ start: match.index!, end: match.index! + match[0].length }));
}

/** Attribute strings only: no image/document insertion and no asset requests. */
export function imageReferenceNames(tag: string): string[] {
  // Some exports retain JSON-escaped attribute quotes literally, e.g.
  // <img=\"overwhelmed\">. Decode only quote delimiters for name lookup;
  // the reference stored in the message and its source offsets stay intact.
  tag = tag.replace(/\\+(?=["'])/g, '');
  const decode = (value: string) => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    const known = named[entity.toLowerCase()]; if (known) return known;
    const number = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(/([^\s=<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const key = match[1]!.toLowerCase();
    if (!attrs.has(key)) attrs.set(key, decode(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  const src = attrs.get('src')?.trim() || '';
  const token = src.match(/^\{\{(?:img|image|raw)::([^{}]+)\}\}$|^\[img(?:::|\s+)([^\]\r\n]+)\]$/i);
  const bracket = tag.match(/^\[img([\s\S]*?)(?:\]|$)$/i)?.[1];
  const bare = bracket?.replace(/^\s*(?:::|:|=)?\s*/, '').replace(/^["']|["']$/g, '').trim();
  const shorthand = tag.match(/^<img\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))\s*\/?\s*>$/i);
  const candidates = [token?.[1] ?? token?.[2], attrs.get('src'), attrs.get('data-asset-name'), attrs.get('name'), attrs.get('alt'), attrs.get('title'), shorthand?.[1] ?? shorthand?.[2] ?? shorthand?.[3], attrs.get('img'), bare];
  if (src && !/^(?:data|javascript):/i.test(src)) {
    let path = src.split(/[?#]/)[0] || '';
    try { path = decodeURIComponent(path); } catch { /* Preserve undecodable paths. */ }
    candidates.push(path, path.split(/[\\/]/).pop());
  }
  return [...new Set(candidates.filter((name): name is string => typeof name === 'string' && !!name.trim()).map(name => name.trim()))];
}

/** Half-open UTF-16 offsets into the ORIGINAL content, matching String.slice.
 * No HTML, URLs or code are evaluated. Only a known asset name resolves; an
 * unresolved token remains verbatim text. Empty content returns no segments.
 */
export function extractAssetSegments(content: string, assets: BookAsset[], imageRules: ImageRule[] = [],references:{start:number;end:number;name:string}[]=[]): AssetSegment[] {
  const byName = new Map<string, BookAsset>();
  const referenceNames=new Map<string,string[]>();
  for(const reference of references){const key=`${reference.start}:${reference.end}`;const list=referenceNames.get(key)??[];list.push(reference.name);referenceNames.set(key,list);}
  for (const asset of assets) if (!byName.has(asset.name) && safeAssetSource(asset.src)) byName.set(asset.name, asset);
  const aliases = new Map<string, BookAsset | null>();
  const addAlias = (name: string, asset: BookAsset) => {
    const previous = aliases.get(name);
    if (previous === undefined) aliases.set(name, asset);
    else if (previous?.id !== asset.id) aliases.set(name, null);
  };
  for (const asset of byName.values()) {
    const namePath = asset.name.replace(/\\/g, '/');
    addAlias(namePath, asset);
    addAlias(namePath.split('/').pop()!, asset);
    addAlias(asset.src, asset);
    if (/^https?:\/\//i.test(asset.src)) {
      const url = new URL(asset.src); addAlias(url.pathname, asset);
      try { addAlias(decodeURIComponent(url.pathname), asset); } catch { /* Keep encoded alias. */ }
    }
  }
  const result: AssetSegment[] = [];
  // Markdown supports ordinary/angle-bracket destinations and optional titles;
  // URL destinations are not fetched or resolved by alt text.
  const token = imagePattern();
  let cursor = 0;
  for (const match of content.matchAll(token)) {
    const start = match.index!;
    // Escaped Markdown/tokens are prose; retain their exact source offsets.
    let slashes = 0;
    for (let i = start - 1; i >= 0 && content[i] === '\\'; i--) slashes++;
    if (slashes % 2) continue;
    let name = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (name.startsWith('<') && name.endsWith('>')) name = name.slice(1, -1);
    name = name.replace(/^\{\{(?:img|image|raw)::([^{}]+)\}\}$/i, '$1').replace(/\\([\\()[\] ])/g, '$1').trim();
    const candidates = [...(referenceNames.get(`${start}:${start+match[0].length}`)??[]), ...imageRuleCandidates(match[0], imageRules), ...(/^(?:<img|\[img)/i.test(match[0]) ? imageReferenceNames(match[0]) : [name])];
    let asset: BookAsset | undefined;
    for (const candidate of candidates) {
      asset = byName.get(candidate) ?? aliases.get(candidate) ?? undefined;
      if (asset) break;
    }
    if (!asset) continue;
    if (start > cursor) result.push({ type: 'text', text: content.slice(cursor, start), start: cursor, end: start });
    const end = start + match[0].length;
    result.push({ type: 'asset', asset, start, end });
    cursor = end;
  }
  if (cursor < content.length) result.push({ type: 'text', text: content.slice(cursor), start: cursor, end: content.length });
  return result;
}

function bytesFromBase64(value: string): Uint8Array {
  const clean = value.replace(/\s/g, '');
  if (!/^[a-z\d+/]*={0,2}$/i.test(clean)) throw new Error('이미지의 base64 데이터가 올바르지 않습니다.');
  try {
    const decoded = atob(clean);
    return Uint8Array.from(decoded, char => char.charCodeAt(0));
  } catch { throw new Error('이미지의 base64 데이터를 읽지 못했습니다.'); }
}

function base64FromBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 16384) parts.push(String.fromCharCode(...bytes.subarray(start, start + 16384)));
  return btoa(parts.join(''));
}

function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 32))) return 'image/avif';
  return undefined;
}

function imageData(bytes: Uint8Array): string | undefined {
  const mime = imageMime(bytes);
  return mime ? `data:${mime};base64,${base64FromBytes(bytes)}` : undefined;
}

function sourceFromCard(uri: string, embedded: Map<string, string>, portrait?: string): string | undefined {
  if (uri === 'ccdefault:') return portrait;
  if (uri.startsWith('__asset:')) return embedded.get(uri.slice(8));
  if (uri.startsWith('embeded://')) return embedded.get(uri.slice(10));
  if (/^https?:\/\//i.test(uri)) return safeAssetSource(uri);
  // Official JSON exports use application/octet-stream; inspect magic bytes
  // instead of trusting either the declared MIME or the card's ext/type.
  const data = uri.match(/^data:[^,]*;base64,([\s\S]*)$/i);
  if (data) return imageData(bytesFromBase64(data[1]!));
  // V2 emotions/additionalAssets store bare base64.
  if (/^[a-z\d+/=\s]+$/i.test(uri)) return imageData(bytesFromBase64(uri));
  return undefined;
}

export interface AssetImportResult { assets: BookAsset[]; warnings: string[]; imageRules?: ImageRule[]; displayRules?: DisplayRule[] }

function assetsFromJson(value: unknown, embedded = new Map<string, string>(), portrait?: string): AssetImportResult {
  const assets: BookAsset[] = [];
  const warnings: string[] = [];
  const root = object(value) ? value : undefined;
  const data = root && object(root.data) ? root.data : root;
  const entries: unknown[] = Array.isArray(value) ? [...value] : [];
  if (data && Array.isArray(data.assets)) entries.push(...data.assets);
  if (root && data !== root && Array.isArray(root.assets)) entries.push(...root.assets);
  const ext = data && object(data.extensions) && object(data.extensions.risuai) ? data.extensions.risuai : undefined;
  for (const list of [ext?.emotions, ext?.additionalAssets, data?.emotionImages, data?.additionalAssets]) {
    if (Array.isArray(list)) for (const row of list) {
      if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') entries.push({ name: row[0], uri: row[1] });
    }
  }
  if (data && Array.isArray(data.ccAssets)) entries.push(...data.ccAssets);
  if (root && typeof root.name === 'string' && ('src' in root || 'uri' in root)) entries.push(root);
  if (entries.length > MAX_ASSETS) throw new Error(`한 번에 ${MAX_ASSETS}개 이하의 에셋을 추가해 주세요.`);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!object(entry)) { warnings.push('형식이 올바르지 않은 에셋을 건너뛰었습니다.'); continue; }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) { warnings.push('이름이 없는 에셋을 건너뛰었습니다.'); continue; }
    const uri = typeof entry.src === 'string' ? entry.src : typeof entry.uri === 'string' ? entry.uri : '';
    let src: string | undefined;
    try { src = sourceFromCard(uri, embedded, portrait); }
    catch { warnings.push(`${name}: 이미지 데이터를 읽지 못했습니다.`); continue; }
    if (!src) { warnings.push(`${name}: 이미지가 아니거나 이 파일에 없는 에셋입니다.`); continue; }
    const key = `${name}\u0000${src}`;
    if (seen.has(key)) {
      if (entry.type === 'icon') { const existing = assets.find(asset => asset.name === name && asset.src === src); if (existing) existing.type = 'icon'; }
      continue;
    }
    seen.add(key);
    assets.push({ id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : id(), name, src, type: entry.type === 'icon' ? 'icon' : 'asset' });
  }
  const imageRules = extractImageRules(value);
  const displayRules = extractDisplayRules(value, warnings);
  return { assets: normalizeAssets(assets), warnings, ...(imageRules.length ? { imageRules } : {}), ...(displayRules.length ? { displayRules } : {}) };
}

async function inflateText(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축된 PNG 카드 정보를 지원하지 않습니다. JSON 카드를 사용해 주세요.');
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function readPng(bytes: Uint8Array): Promise<{ metadata: Map<string, string>; portrait: string }> {
  const metadata = new Map<string, string>();
  const imageParts: Uint8Array[] = [bytes.slice(0, 8)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let ended = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new Error('PNG 청크가 손상되었습니다.');
    const size = view.getUint32(offset);
    const end = offset + 12 + size;
    if (end > bytes.length) throw new Error('PNG 청크 길이가 올바르지 않습니다.');
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (kind === 'tEXt' || kind === 'iTXt') {
      const chunk = bytes.subarray(offset + 8, offset + 8 + size);
      const separator = chunk.indexOf(0);
      if (separator < 1 || separator > 79) throw new Error('PNG 텍스트 키가 올바르지 않습니다.');
      const key = String.fromCharCode(...chunk.subarray(0, separator));
      if (key === 'chara' || key === 'ccv3' || key.startsWith('chara-ext-asset_')) {
        let payload = chunk.subarray(separator + 1);
        if (kind === 'iTXt') {
          const compressed = payload[0];
          if ((compressed !== 0 && compressed !== 1) || payload[1] !== 0) throw new Error('지원하지 않는 PNG 텍스트 압축입니다.');
          const languageEnd = payload.indexOf(0, 2);
          const translatedEnd = languageEnd >= 0 ? payload.indexOf(0, languageEnd + 1) : -1;
          if (translatedEnd < 0) throw new Error('PNG iTXt 정보가 손상되었습니다.');
          payload = payload.subarray(translatedEnd + 1);
          if (compressed) payload = await inflateText(payload);
        }
        metadata.set(key, decoder.decode(payload));
      }
    } else imageParts.push(bytes.slice(offset, end));
    offset = end;
    if (kind === 'IEND') { ended = true; break; }
  }
  if (!ended) throw new Error('PNG의 끝을 찾을 수 없습니다.');
  const image = new Uint8Array(imageParts.reduce((sum, part) => sum + part.length, 0));
  let index = 0;
  for (const part of imageParts) { image.set(part, index); index += part.length; }
  return { metadata, portrait: imageData(image)! };
}

interface ZipEntry { name: string; size: number; compressed: number; method: number; crc: number; offset: number }

/** Central-directory offsets can be relative to ZIP or the entire JPEG+ZIP.
 * Only stored/deflated single-volume ZIP32 is supported. No paths are written
 * to disk; reject ambiguous names, symlinks and traversal anyway.
 */
function zipDirectory(bytes: Uint8Array): { entries: ZipEntry[]; prefix: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) return undefined;
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const recordedOffset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count ||
      count === 65535 || directorySize === 0xffffffff || recordedOffset === 0xffffffff) throw new Error('분할 ZIP 또는 ZIP64 CHARX 카드는 지원하지 않습니다.');
  if (!count || count > MAX_ASSETS * 2 + 100) throw new Error('CHARX의 파일 수가 올바르지 않거나 너무 많습니다.');
  const directoryStart = end - directorySize;
  const bias = directoryStart - recordedOffset;
  if (directoryStart < 0 || bias < 0) throw new Error('CHARX ZIP 디렉터리 위치가 올바르지 않습니다.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = directoryStart;
  let prefix = bytes.length;
  let totalSize = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('CHARX ZIP 디렉터리가 손상되었습니다.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const attributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true) + bias;
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 0x41 || (method !== 0 && method !== 8) || view.getUint16(offset + 34, true) ||
        ((attributes >>> 16) & 0xf000) === 0xa000) throw new Error('암호화·심볼릭 링크 또는 지원하지 않는 압축 형식의 CHARX입니다.');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    // Validate every declaration before any entry is allocated or inflated,
    // including unused files and module.risum (whose parse errors are optional).
    totalSize += size;
    if (size > charxEntryLimit(name) || totalSize > MAX_CHARX_TOTAL_BYTES) throw new Error('CHARX 압축 해제 크기가 안전 한도를 넘었습니다.');
    if (!name || /[\\:\u0000-\u001f]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..') || names.has(name)) throw new Error('CHARX에 중복되거나 안전하지 않은 파일명이 있습니다.');
    names.add(name);
    if (compressed === 0xffffffff || size === 0xffffffff || localOffset < 0 || localOffset + 30 > directoryStart ||
        view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('CHARX 파일 위치가 올바르지 않습니다.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressed > directoryStart || decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name ||
        view.getUint16(localOffset + 8, true) !== method || view.getUint16(localOffset + 6, true) !== flags) throw new Error('CHARX 파일 헤더가 일치하지 않습니다.');
    prefix = Math.min(prefix, localOffset);
    if (!name.endsWith('/')) entries.push({ name, size, compressed, method, crc: view.getUint32(offset + 16, true), offset: dataOffset });
    offset = next;
  }
  if (offset !== end) throw new Error('CHARX 디렉터리 길이가 일치하지 않습니다.');
  if (prefix && (imageMime(bytes) !== 'image/jpeg' || bytes[prefix - 2] !== 255 || bytes[prefix - 1] !== 217)) throw new Error('CHARX 앞부분은 유효한 JPEG 접두부여야 합니다.');
  return { entries, prefix };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

async function zipFile(bytes: Uint8Array, entry: ZipEntry, budget: { remaining: number }): Promise<Uint8Array> {
  const limit = Math.min(charxEntryLimit(entry.name), budget.remaining);
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > limit) throw new Error('CHARX 압축 해제 크기가 안전 한도를 넘었습니다.');
  const compressed = bytes.subarray(entry.offset, entry.offset + entry.compressed);
  let data: Uint8Array;
  if (entry.method === 0) {
    if (entry.size !== entry.compressed) throw new Error('CHARX 파일 크기가 일치하지 않습니다.');
    data = compressed;
    budget.remaining -= data.length;
  } else {
    // The declaration is now bounded before allocation. Small input pushes
    // also bound the inflater's transient output before our callback can check it.
    data = new Uint8Array(entry.size);
    let written = 0;
    const stream = new Inflate(chunk => {
      if (written + chunk.length > entry.size || written + chunk.length > limit || chunk.length > budget.remaining) throw new Error('CHARX 파일의 압축 해제 크기가 한도를 넘었습니다.');
      budget.remaining -= chunk.length;
      data.set(chunk, written); written += chunk.length;
    });
    for (let offset = 0; offset < compressed.length; offset += 1024) {
      if (offset && offset % (64 * 1024) === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      stream.push(compressed.subarray(offset, offset + 1024), offset + 1024 >= compressed.length);
    }
    if (!compressed.length) stream.push(compressed, true);
    if (written !== entry.size) throw new Error('CHARX 파일의 압축 데이터가 손상되었습니다.');
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw new Error(`CHARX 파일 검증에 실패했습니다: ${entry.name}`);
  return data;
}

async function readCharx(bytes: Uint8Array, directory: { entries: ZipEntry[]; prefix: number }): Promise<AssetImportResult> {
  const budget = { remaining: MAX_CHARX_TOTAL_BYTES };
  // Give the importing UI a chance to paint before decompression starts.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const cardEntry = directory.entries.find(entry => entry.name === 'card.json');
  if (!cardEntry) throw new Error('CHARX ZIP의 최상위 card.json을 찾을 수 없습니다.');
  let card: unknown;
  try { card = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await zipFile(bytes, cardEntry, budget)).replace(/^\uFEFF/, '')); }
  catch { throw new Error('CHARX의 card.json을 읽지 못했습니다.'); }
  if (!object(card) || card.spec !== 'chara_card_v3' || !object(card.data) || !Array.isArray(card.data.assets)) throw new Error('유효한 v3 CHARX 캐릭터 카드가 아닙니다.');
  const referenced = new Set<string>();
  for (const asset of card.data.assets) if (object(asset) && typeof asset.uri === 'string' && asset.uri.startsWith('embeded://')) referenced.add(asset.uri.slice(10));
  const embedded = new Map<string, string>();
  // Decompress referenced images here; module.risum is read separately as JSON
  // metadata only. Scripts, fonts and HTML are never evaluated or loaded.
  for (const entry of directory.entries) {
    if (!referenced.has(entry.name) || entry.name === 'module.risum' || /\.(?:json|js|ts|lua|html?|css|woff2?|ttf|otf)$/i.test(entry.name)) continue;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const source = imageData(await zipFile(bytes, entry, budget));
    if (source) embedded.set(entry.name, source);
  }
  const portrait = directory.prefix ? imageData(bytes.subarray(0, directory.prefix)) : undefined;
  const result = assetsFromJson(card, embedded, portrait);
  const moduleEntry = directory.entries.find(entry => entry.name === 'module.risum');
  if (moduleEntry) {
    try {
      const module = readModuleData(await zipFile(bytes, moduleEntry, budget));
      const moduleRules = extractImageRules(module);
      const displayRules = [...(result.displayRules ?? []), ...extractDisplayRules(module, result.warnings)];
      if (displayRules.length) result.displayRules = displayRules;
      const imageRules = normalizeImageRules([...(result.imageRules ?? []), ...moduleRules]);
      if (imageRules.length) result.imageRules = imageRules;
    } catch { result.warnings.push('module.risum의 이미지 규칙을 읽지 못했습니다. 카드 이미지는 가져왔습니다.'); }
  }
  if (result.displayRules?.length && !result.assets.some(asset => asset.type !== 'icon')) {
    result.warnings.push('이 카드에는 초상 외 장면 이미지가 없습니다. 이미지 규칙이 가리키는 이름의 에셋을 책장에 추가해야 표시됩니다.');
  }
  if (portrait && !result.assets.some(asset => asset.type === 'icon')) {
    result.assets.unshift({ id: id(), name: typeof card.data.name === 'string' ? card.data.name : '캐릭터', src: portrait, type: 'icon' });
  }
  if (!result.assets.length && !result.imageRules?.length && !result.displayRules?.length) throw new Error('CHARX 카드에 가져올 수 있는 이미지 또는 규칙이 없습니다.' + (result.warnings[0] ? ` ${result.warnings[0]}` : ''));
  return result;
}

/** Sample the image's border, not its center. Transparent margins are skipped
 * along each scanline until the real visible contour is reached. Alpha-weighted
 * edge samples yield a trimmed mean, mildly muted in linear RGB and tone-mapped
 * to luminance .035–.13 (white-text contrast >= 5.8:1). Returns a continuous
 * opaque #rrggbb shade, with Jade only on decode/CORS/canvas failure.
 */
export async function portraitPalette(src: string): Promise<string> {
  const fallback: string = jade.jade12;
  if (!safeAssetSource(src) || typeof document === 'undefined' || typeof Image === 'undefined') return fallback;
  const image = new Image();
  image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { image.onload = null; image.onerror = null; image.src = ''; reject(new Error('이미지 시간 초과')); }, 8000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('이미지 읽기 실패')); };
      image.src = src;
    });
    if (!image.naturalWidth || !image.naturalHeight) return fallback;
    const canvas = document.createElement('canvas');
    const ratio = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight, 1);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return fallback;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    type Sample = { rgb: number[]; weight: number };
    const samples: Sample[] = [];
    const linear = (channel: number) => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    };
    const scanEdge = (start: number, step: number, length: number) => {
      let opacity = 0;
      for (let position = 0; position < length && opacity < 2; position++) {
        const offset = (start + step * position) * 4;
        const alpha = pixels[offset + 3]! / 255;
        if (!alpha) continue;
        // At most two opaque pixels of optical depth from each visible edge;
        // antialiased/translucent pixels contribute their actual alpha weight.
        const weight = Math.min(alpha, 2 - opacity);
        samples.push({ rgb: [linear(pixels[offset]!), linear(pixels[offset + 1]!), linear(pixels[offset + 2]!)], weight });
        opacity += weight;
      }
    };
    const width = canvas.width, height = canvas.height;
    for (let y = 0; y < height; y++) {
      scanEdge(y * width, 1, width);
      scanEdge(y * width + width - 1, -1, width);
    }
    for (let x = 0; x < width; x++) {
      scanEdge(x, width, height);
      scanEdge((height - 1) * width + x, -width, height);
    }
    const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
    if (!totalWeight) return fallback;
    const median = [0, 1, 2].map(channel => {
      const ordered = [...samples].sort((a, b) => a.rgb[channel]! - b.rgb[channel]!);
      let weight = 0;
      for (const sample of ordered) { weight += sample.weight; if (weight >= totalWeight / 2) return sample.rgb[channel]!; }
      return ordered[ordered.length - 1]!.rgb[channel]!;
    });
    const distance = (sample: Sample) => sample.rgb.reduce((sum, value, channel) => sum + (value - median[channel]!) ** 2, 0);
    samples.sort((a, b) => distance(a) - distance(b));
    // Trim the most distant 15% of edge weight to reduce isolated bright
    // highlights, stray pixels and border lettering without quantizing hue.
    let remaining = totalWeight * .85;
    const mean = [0, 0, 0];
    let kept = 0;
    for (const sample of samples) {
      const weight = Math.min(remaining, sample.weight);
      for (let channel = 0; channel < 3; channel++) mean[channel] += sample.rgb[channel]! * weight;
      kept += weight; remaining -= weight;
      if (remaining <= 0) break;
    }
    const rgb = mean.map(value => value / kept);
    const luminance = rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    const muted = rgb.map(value => value * .82 + luminance * .18);
    const mapped = muted.map(value => luminance > .13 ? value * .13 / luminance : value + Math.max(0, .035 - luminance));
    const hex = mapped.map(value => {
      const clipped = Math.max(0, Math.min(1, value));
      const srgb = clipped <= .0031308 ? clipped * 12.92 : 1.055 * clipped ** (1 / 2.4) - .055;
      return Math.round(srgb * 255).toString(16).padStart(2, '0');
    });
    return `#${hex.join('')}`;
  } catch { return fallback; }
  finally { image.onload = null; image.onerror = null; }
}

/** No fetches, HTML parsing or code execution. PNG card
 * portraits are stripped of text chunks to avoid storing duplicate card data.
 * JSON accepts card data.assets, V2 Risu extensions, BookAsset[] or {assets:[]}.
 */
export async function importAssetFileInProcess(file: File): Promise<AssetImportResult> {
  if (/\.(?:risup|risupreset)$/i.test(file.name)) throw new Error('RISUP은 RisuAI 프리셋 파일입니다. 이미지나 PNG·JSON 캐릭터 카드를 선택해 주세요.');
  if (/\.risupack$/i.test(file.name)) throw new Error('RISUPACK은 지원하지 않습니다. 이미지 또는 PNG·JSON·CHARX 카드를 사용해 주세요.');
  if (/\.risum$/i.test(file.name)) {
    const {module,assets:payloads}=readModuleBundle(new Uint8Array(await file.arrayBuffer()));
    const warnings:string[]=[];
    const imageRules=extractImageRules(module),displayRules=extractDisplayRules(module,warnings);
    const metadata=Array.isArray(module.assets)?module.assets:[];
    const assets:BookAsset[]=payloads.flatMap((bytes,index)=>{
      const src=imageData(bytes);if(!src){warnings.push(`에셋 ${index+1}의 이미지 형식을 읽지 못했습니다.`);return [];}
      const row=metadata[index],name=Array.isArray(row)&&typeof row[0]==='string'&&row[0].trim()?row[0].trim():`에셋 ${index+1}`;
      return [{id:id(),name,src,type:'asset' as const}];
    });
    if(!assets.length&&!imageRules.length&&!displayRules.length)throw new Error('모듈에서 이미지 에셋이나 이미지 규칙을 찾지 못했습니다.');
    return {assets:normalizeAssets(assets),warnings,imageRules,displayRules};
  }
  if (!file.size) throw new Error('파일이 비어 있습니다.');
  const basename = file.name.replace(/\.[^.]+$/, '') || '이미지';
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    let value: unknown;
    try { value = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
    catch { throw new Error('에셋 JSON을 읽지 못했습니다.'); }
    const result = assetsFromJson(value);
    if (!result.assets.length && !result.imageRules?.length && !result.displayRules?.length) throw new Error('가져올 이미지 또는 규칙이 없습니다.' + (result.warnings.length ? ` ${result.warnings[0]}` : ''));
    return result;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = imageMime(bytes);
  // Check the directory, not a guessed PK offset: JPEG data can contain PK
  // bytes, and official JPEG+CHARX offsets are relative to the appended ZIP.
  const zip = /\.(?:charx|zip)$/i.test(file.name) || mime === 'image/jpeg' ||
    (bytes[0] === 80 && bytes[1] === 75) ? zipDirectory(bytes) : undefined;
  if (zip) return readCharx(bytes, zip);
  if (/\.(?:charx|zip)$/i.test(file.name)) throw new Error('유효한 CHARX ZIP 카드를 찾을 수 없습니다.');
  if (!mime) throw new Error('PNG, JPG, WebP, GIF, AVIF 이미지나 PNG·JSON·CHARX 카드를 선택해 주세요.');
  if (mime === 'image/png') {
    const { metadata, portrait } = await readPng(bytes);
    const encoded = metadata.get('ccv3') ?? metadata.get('chara');
    if (encoded !== undefined) {
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytesFromBase64(encoded))); }
      catch { throw new Error('PNG 캐릭터 카드의 JSON 정보가 손상되었습니다.'); }
      const embedded = new Map<string, string>();
      const warnings: string[] = [];
      for (const [key, payload] of metadata) if (key.startsWith('chara-ext-asset_')) {
        const assetIndex = key.replace(/^chara-ext-asset_:?/, '');
        try { const src = imageData(bytesFromBase64(payload)); if (src) embedded.set(assetIndex, src); }
        catch { warnings.push(`에셋 ${assetIndex}의 이미지 데이터를 읽지 못했습니다.`); }
      }
      const result = assetsFromJson(value, embedded, portrait);
      if (!result.assets.some(asset => asset.type === 'icon')) {
        const data = object(value) && object(value.data) ? value.data : value;
        const name = object(data) && typeof data.name === 'string' ? data.name.trim() || basename : basename;
        result.assets.unshift({ id: id(), name, src: portrait, type: 'icon' });
      }
      result.warnings.push(...warnings);
      return result;
    }
    return { assets: [{ id: id(), name: file.name, src: portrait, type: 'asset' }], warnings: [] };
  }
  return { assets: [{ id: id(), name: file.name, src: imageData(bytes)!, type: 'asset' }], warnings: [] };
}

/** Parse untrusted archives off the UI thread; terminate slow imports outright. */
export async function importAssetFile(file:File):Promise<AssetImportResult>{
 // Non-browser callers (including bounded parser regression tests) use the same
 // validation without constructing a browser worker.
 if(typeof Worker==='undefined')return importAssetFileInProcess(file);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./assetImport.worker.ts',import.meta.url),{type:'module'});
  const finish=()=>{clearTimeout(timer);worker.terminate();};
  const timer=setTimeout(()=>{finish();reject(new Error('에셋을 읽는 시간이 너무 길어 중단했어요. 파일을 확인해 주세요.'));},30000);
  worker.onmessage=event=>{finish();const result=event.data as {ok:boolean;value?:AssetImportResult;error?:string};if(result.ok&&result.value)resolve(result.value);else reject(new Error(result.error||'에셋을 읽지 못했어요.'));};
  worker.onerror=()=>{finish();reject(new Error('에셋 작업자를 실행하지 못했어요.'));};
  worker.onmessageerror=()=>{finish();reject(new Error('에셋 처리 결과를 읽지 못했어요.'));};
  try{worker.postMessage(file);}catch(error){finish();reject(error);}
 });
}
