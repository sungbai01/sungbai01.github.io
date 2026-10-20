import type { BookAsset } from './library';

/** Format references (read 2026-10-20): Risuai/src/ts/characterCards.ts
 * blob 99fad382849378dcf130706ab36438726d4c4685 and src/ts/pngChunk.ts.
 * V3 data.assets: {type,name,uri,ext}; V2 extensions.risuai has emotions
 * [name,base64] and additionalAssets [name,base64,ext]. PNG metadata is base64
 * JSON in chara/ccv3 and base64 bytes in chara-ext-asset_:N, via __asset:N.
 * We also read standard iTXt chunks. No card macros/scripts or archives run.
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
  return value.flatMap(entry => {
    if (!object(entry) || typeof entry.name !== 'string' || !entry.name.trim()) return [];
    const src = safeAssetSource(entry.src);
    if (!src) return [];
    let assetId = typeof entry.id === 'string' && entry.id.trim() ? entry.id : id();
    if (ids.has(assetId)) assetId = id();
    ids.add(assetId);
    return [{ id: assetId, name: entry.name.trim(), src }];
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
    if (seen.has(key)) continue;
    seen.add(key);
    assets.push({ id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : id(), name, src });
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

/** No fetches, archive extraction, HTML parsing or code execution. PNG card
 * portraits are stripped of text chunks to avoid storing duplicate card data.
 * JSON accepts card data.assets, V2 Risu extensions, BookAsset[] or {assets:[]}.
 */
export async function importAssetFile(file: File): Promise<AssetImportResult> {
  if (/\.(?:risup|risupreset)$/i.test(file.name)) throw new Error('RISUP은 RisuAI 프리셋 파일입니다. 이미지나 PNG·JSON 캐릭터 카드를 선택해 주세요.');
  if (/\.(?:risum|charx|zip|risupack)$/i.test(file.name)) throw new Error('이 가져오기는 RISUM 모듈, CHARX·ZIP 아카이브, RISUPACK을 지원하지 않습니다. 이미지 파일 또는 이미지가 포함된 PNG·JSON 카드를 사용해 주세요.');
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
  if (!mime) throw new Error('PNG, JPG, WebP, GIF, AVIF 이미지나 PNG/JSON 캐릭터 카드를 선택해 주세요.');
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
      if (!result.assets.some(asset => asset.src === portrait)) {
        const data = object(value) && object(value.data) ? value.data : value;
        const name = object(data) && typeof data.name === 'string' ? data.name.trim() || basename : basename;
        result.assets.push({ id: id(), name, src: portrait });
      }
      result.warnings.push(...warnings);
      return result;
    }
    return { assets: [{ id: id(), name: file.name, src: portrait }], warnings: [] };
  }
  return { assets: [{ id: id(), name: file.name, src: imageData(bytes)! }], warnings: [] };
}
