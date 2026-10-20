import type { BookAsset } from './library';
import { Inflate } from 'fflate';
import { jade, bronze, iris, gold } from '@radix-ui/colors';

/** Format references (read 2026-10-20): Risuai/src/ts/characterCards.ts
 * blob 99fad382849378dcf130706ab36438726d4c4685 and src/ts/pngChunk.ts.
 * V3 data.assets: {type,name,uri,ext}; V2 extensions.risuai has emotions
 * [name,base64] and additionalAssets [name,base64,ext]. PNG metadata is base64
 * JSON in chara/ccv3 and base64 bytes in chara-ext-asset_:N, via __asset:N.
 * CHARX follows src/ts/process/processzip.ts: ZIP containing card.json and
 * embeded:// paths. Its writeJpeg appends ZIP after JPEG (ZIP offsets exclude
 * that prefix). Archives are read only in memory; card scripts never run.
 */
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_ASSETS = 2000;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const id = () => crypto.randomUUID();

/** Raster data URLs and explicit HTTP(S) URLs only; never blob/script/file/SVG.
 * This validates a reference, and does not fetch or decode remote images.
 */
export function safeAssetSource(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_BYTES * 1.4) return undefined;
  const src = value.trim();
  if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z\d+/=\s]+$/i.test(src)) return src;
  try {
    const url = new URL(src);
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return src;
  } catch { /* Relative paths and card-local paths require the missing files. */ }
  return undefined;
}

/** Canonical shelf assets; invalid records are dropped, IDs stay stable.
 * Names are deliberately not case-folded: two distinct names must not silently
 * resolve to the same image. The dialog refuses duplicate names on save.
 */
export function normalizeAssets(value: unknown): BookAsset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((entry): BookAsset[] => {
    if (!object(entry) || typeof entry.name !== 'string' || !entry.name.trim()) return [];
    const src = safeAssetSource(entry.src);
    if (!src) return [];
    let assetId = typeof entry.id === 'string' && entry.id.trim() ? entry.id : id();
    if (ids.has(assetId)) assetId = id();
    ids.add(assetId);
    return [{ id: assetId, name: entry.name.trim(), src,
      ...(entry.type === 'icon' || entry.type === 'asset' ? { type: entry.type } : {}) }];
  });
}

export type AssetSegment =
  | { type: 'text'; text: string; start: number; end: number }
  | { type: 'asset'; asset: BookAsset; start: number; end: number };

/** Half-open UTF-16 offsets into the ORIGINAL content, matching String.slice.
 * No HTML, URLs or code are evaluated. Only a known asset name resolves; an
 * unresolved token remains verbatim text. Empty content returns no segments.
 */
export function extractAssetSegments(content: string, assets: BookAsset[]): AssetSegment[] {
  const byName = new Map<string, BookAsset>();
  for (const asset of assets) if (!byName.has(asset.name) && safeAssetSource(asset.src)) byName.set(asset.name, asset);
  const result: AssetSegment[] = [];
  // Markdown supports ordinary/angle-bracket destinations and optional titles;
  // URL destinations are not fetched or resolved by alt text.
  const token = /\{\{(?:img|image|raw)::([^{}\r\n]+)\}\}|!\[(?:\\.|[^\]\\])*\]\(\s*(<[^>\r\n]+>|\{\{(?:img|image|raw)::[^{}\r\n]+\}\}|(?:\\.|[^\s()])+)(?:\s+["'][^\r\n]*?["'])?\s*\)/gi;
  let cursor = 0;
  for (const match of content.matchAll(token)) {
    const start = match.index!;
    // Escaped Markdown/tokens are prose; retain their exact source offsets.
    let slashes = 0;
    for (let i = start - 1; i >= 0 && content[i] === '\\'; i--) slashes++;
    if (slashes % 2) continue;
    let name = (match[1] ?? match[2] ?? '').trim();
    if (name.startsWith('<') && name.endsWith('>')) name = name.slice(1, -1);
    name = name.replace(/^\{\{(?:img|image|raw)::([^{}]+)\}\}$/i, '$1').replace(/\\([\\()[\] ])/g, '$1').trim();
    const asset = byName.get(name);
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
  if (clean.length > MAX_BYTES * 1.4 || !/^[a-z\d+/]*={0,2}$/i.test(clean)) throw new Error('이미지의 base64 데이터가 올바르지 않습니다.');
  try {
    const decoded = atob(clean);
    if (decoded.length > MAX_BYTES) throw new Error('이미지가 너무 큽니다.');
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

export interface AssetImportResult { assets: BookAsset[]; warnings: string[] }

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
  return { assets: normalizeAssets(assets), warnings };
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
      if (length > MAX_METADATA_BYTES) throw new Error('PNG 카드 정보가 너무 큽니다.');
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
  let totalText = 0;
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
        totalText += payload.length;
        if (totalText > MAX_BYTES || ((key === 'chara' || key === 'ccv3') && payload.length > MAX_METADATA_BYTES)) throw new Error('PNG 카드 정보가 너무 큽니다.');
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
  let totalSize = 0;
  let prefix = bytes.length;
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
    if (!name || /[\\:\u0000-\u001f]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..') || names.has(name)) throw new Error('CHARX에 중복되거나 안전하지 않은 파일명이 있습니다.');
    names.add(name);
    if (compressed === 0xffffffff || size === 0xffffffff || localOffset < 0 || localOffset + 30 > directoryStart ||
        view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('CHARX 파일 위치가 올바르지 않습니다.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressed > directoryStart || decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name ||
        view.getUint16(localOffset + 8, true) !== method || view.getUint16(localOffset + 6, true) !== flags) throw new Error('CHARX 파일 헤더가 일치하지 않습니다.');
    totalSize += size;
    if (size > MAX_BYTES || totalSize > MAX_BYTES) throw new Error('CHARX의 압축 해제 크기는 합계 50MB 이하여야 합니다.');
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

function zipFile(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const compressed = bytes.subarray(entry.offset, entry.offset + entry.compressed);
  let data: Uint8Array;
  if (entry.method === 0) {
    if (entry.size !== entry.compressed) throw new Error('CHARX 파일 크기가 일치하지 않습니다.');
    data = compressed;
  } else {
    // Bound output by both declared size and aggregate preflight limits. Small
    // input pushes avoid inflating an entire malicious payload before checking.
    data = new Uint8Array(entry.size);
    let written = 0;
    const stream = new Inflate(chunk => {
      if (written + chunk.length > entry.size) throw new Error('CHARX 파일의 압축 해제 크기가 한도를 넘었습니다.');
      data.set(chunk, written); written += chunk.length;
    });
    for (let offset = 0; offset < compressed.length; offset += 4096) {
      stream.push(compressed.subarray(offset, offset + 4096), offset + 4096 >= compressed.length);
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
  const cardEntry = directory.entries.find(entry => entry.name === 'card.json');
  if (!cardEntry) throw new Error('CHARX ZIP의 최상위 card.json을 찾을 수 없습니다.');
  if (cardEntry.size > MAX_METADATA_BYTES) throw new Error('CHARX 카드 JSON이 너무 큽니다.');
  let card: unknown;
  try { card = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(zipFile(bytes, cardEntry)).replace(/^\uFEFF/, '')); }
  catch { throw new Error('CHARX의 card.json을 읽지 못했습니다.'); }
  if (!object(card) || card.spec !== 'chara_card_v3' || !object(card.data) || !Array.isArray(card.data.assets)) throw new Error('유효한 v3 CHARX 캐릭터 카드가 아닙니다.');
  const referenced = new Set<string>();
  for (const asset of card.data.assets) if (object(asset) && typeof asset.uri === 'string' && asset.uri.startsWith('embeded://')) referenced.add(asset.uri.slice(10));
  const embedded = new Map<string, string>();
  // Decompress only explicitly referenced images. module.risum, scripts,
  // fonts, HTML and unreferenced archive entries are never evaluated or loaded.
  for (const entry of directory.entries) {
    if (!referenced.has(entry.name) || entry.name === 'module.risum' || /\.(?:json|js|ts|lua|html?|css|woff2?|ttf|otf)$/i.test(entry.name)) continue;
    const source = imageData(zipFile(bytes, entry));
    if (source) embedded.set(entry.name, source);
  }
  const portrait = directory.prefix ? imageData(bytes.subarray(0, directory.prefix)) : undefined;
  const result = assetsFromJson(card, embedded, portrait);
  if (portrait && !result.assets.some(asset => asset.type === 'icon')) {
    result.assets.unshift({ id: id(), name: typeof card.data.name === 'string' ? card.data.name : '캐릭터', src: portrait, type: 'icon' });
  }
  if (!result.assets.length) throw new Error('CHARX 카드에 가져올 수 있는 이미지가 없습니다.' + (result.warnings[0] ? ` ${result.warnings[0]}` : ''));
  return result;
}

/** Downsample locally to 32px, select a dominant non-transparent color bucket,
 * then choose the closest existing dark Radix book color for readable light
 * cover text. Returns Jade on decode/CORS/canvas failure; never mutates src.
 */
export async function portraitPalette(src: string): Promise<string> {
  const palette = [jade.jade12, bronze.bronze11, iris.iris12, gold.gold11];
  const fallback = palette[0]!;
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
    const ratio = Math.min(32 / image.naturalWidth, 32 / image.naturalHeight, 1);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return fallback;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Map<number, { weight: number; r: number; g: number; b: number }>();
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3]! / 255;
      if (alpha < .5) continue;
      const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
      if (lightness < .06 || lightness > .94) continue;
      const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
      bucket.weight += alpha; bucket.r += r * alpha; bucket.g += g * alpha; bucket.b += b * alpha;
      buckets.set(key, bucket);
    }
    let dominant: { weight: number; r: number; g: number; b: number } | undefined;
    for (const bucket of buckets.values()) if (!dominant || bucket.weight > dominant.weight) dominant = bucket;
    if (!dominant) return fallback;
    const hue = (r: number, g: number, b: number): [number, number] => {
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      if (!delta) return [0, 0];
      const h = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      return [h / 6, delta / Math.max(1, max)];
    };
    const [targetHue, saturation] = hue(dominant.r / dominant.weight, dominant.g / dominant.weight, dominant.b / dominant.weight);
    if (saturation < .08) return bronze.bronze11;
    let best = fallback, bestDistance = Infinity;
    for (const color of palette) {
      const [h, s] = hue(parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16));
      const circularDistance = Math.min(Math.abs(h - targetHue), 1 - Math.abs(h - targetHue));
      const distance = circularDistance ** 2 + .025 * (s - saturation) ** 2;
      if (distance < bestDistance) { best = color; bestDistance = distance; }
    }
    return best;
  } catch { return fallback; }
  finally { image.onload = null; image.onerror = null; }
}

/** No fetches, HTML parsing or code execution. PNG card
 * portraits are stripped of text chunks to avoid storing duplicate card data.
 * JSON accepts card data.assets, V2 Risu extensions, BookAsset[] or {assets:[]}.
 */
export async function importAssetFile(file: File): Promise<AssetImportResult> {
  if (/\.(?:risup|risupreset)$/i.test(file.name)) throw new Error('RISUP은 RisuAI 프리셋 파일입니다. 이미지나 PNG·JSON 캐릭터 카드를 선택해 주세요.');
  if (/\.(?:risum|risupack)$/i.test(file.name)) throw new Error('RISUM 모듈과 RISUPACK은 지원하지 않습니다. 이미지 또는 PNG·JSON·CHARX 카드를 사용해 주세요.');
  if (file.size > MAX_BYTES) throw new Error('50MB 이하의 이미지 또는 카드 파일을 선택해 주세요.');
  if (!file.size) throw new Error('파일이 비어 있습니다.');
  const basename = file.name.replace(/\.[^.]+$/, '') || '이미지';
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    let value: unknown;
    try { value = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
    catch { throw new Error('에셋 JSON을 읽지 못했습니다.'); }
    const result = assetsFromJson(value);
    if (!result.assets.length) throw new Error('가져올 이미지가 없습니다. 이미지가 포함된 카드 또는 에셋 JSON을 선택해 주세요.' + (result.warnings.length ? ` ${result.warnings[0]}` : ''));
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
