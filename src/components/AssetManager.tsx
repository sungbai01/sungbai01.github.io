import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { BookAsset } from '../lib/library';
import { importAssetFile, normalizeAssets, numberAssetNames, safeAssetSource, uniqueAssetName } from '../lib/assets';
import {normalizeImageRules,type ImageRule} from '../lib/imageRules';
import {normalizeDisplayRules,type DisplayRule} from '../lib/displayRules';
import './shelf-assets.css';

export interface AssetManagerProps {
  assets: BookAsset[];
  imageRules?:ImageRule[];
  displayRules?:DisplayRule[];
  bookmarkAssetId?:string;
  shareCardAssetId?:string;
  /** App persists this entire library onto every book belonging to this shelf. */
  onSave: (assets: BookAsset[],imageRules:ImageRule[],displayRules:DisplayRule[],bookmarkAssetId?:string,shareCardAssetId?:string) => Promise<void>;
  onClose: () => void;
}

export default function AssetManager({ assets,imageRules=[],displayRules=[],bookmarkAssetId,shareCardAssetId, onSave, onClose }: AssetManagerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const titleId = useId();
  const [draft, setDraft] = useState<BookAsset[]>(() => normalizeAssets(assets));
  const [rules,setRules]=useState<ImageRule[]>(()=>normalizeImageRules(imageRules));
  const [displayDraft,setDisplayDraft]=useState<DisplayRule[]>(()=>normalizeDisplayRules(displayRules));
  const [bookmarkImageId,setBookmarkImageId]=useState(bookmarkAssetId);
  const [cardImageId,setCardImageId]=useState(shareCardAssetId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewFailures, setPreviewFailures] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function addFiles(files: File[]) {
    if (!files.length || locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    const incoming: BookAsset[] = [];
    const incomingRules:ImageRule[]=[];const incomingDisplayRules:DisplayRule[]=[];
    const problems: string[] = [];
    const warnings: string[] = [];
    try {
      for (const file of files) {
        try {
          const result = await importAssetFile(file);
          incoming.push(...result.assets);incomingRules.push(...(result.imageRules??[]));incomingDisplayRules.push(...(result.displayRules??[]));
          warnings.push(...result.warnings.map(warning => `${file.name}: ${warning}`));
        } catch (cause) { problems.push(`${file.name}: ${cause instanceof Error ? cause.message : '파일을 읽지 못했습니다.'}`); }
      }
      setRules(previous=>normalizeImageRules([...previous,...incomingRules]));
      setDisplayDraft(previous=>normalizeDisplayRules([...previous,...incomingDisplayRules]));
      setDraft(previous => {
        const next = previous.map(asset => ({ ...asset }));
        const ids = new Set(next.map(asset => asset.id));
        const portrait = incoming.find(asset => asset.type === 'icon' && asset.name === 'main') ?? incoming.find(asset => asset.type === 'icon');
        let portraitId: string | undefined;
        for (const asset of incoming) {
          const assetId = ids.has(asset.id) ? crypto.randomUUID() : asset.id;
          ids.add(assetId); next.push({ ...asset, id: assetId });
          if (asset === portrait) portraitId = assetId;
        }
        // Number before reordering, so existing image names never get displaced.
        const numbered = numberAssetNames(next);
        const portraitIndex = portraitId ? numbered.findIndex(asset => asset.id === portraitId) : -1;
        if (portraitIndex > 0) numbered.unshift(...numbered.splice(portraitIndex, 1));
        return numbered;
      });
      setError(problems.join('\n'));
      setNotice(warnings.length ? warnings.slice(0, 8).join('\n') + (warnings.length > 8 ? `\n외 ${warnings.length - 8}개 항목` : '') : '');
    } finally { locked.current = false; setBusy(false); }
  }

  async function save() {
    if (locked.current) return;
    const numbered = numberAssetNames(draft);
    for (const asset of numbered) {
      const name = asset.name.trim();
      if (!name || /[{}\r\n]/.test(name)) { setError('이름을 입력해 주세요. 중괄호와 줄바꿈은 사용할 수 없습니다.'); return; }
      if (!safeAssetSource(asset.src)) { setError(`“${name}” 이미지 주소가 올바르지 않습니다.`); return; }
    }
    if (draft.length > 2000) { setError('책장마다 2,000개 이하의 이미지를 저장해 주세요.'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      setDraft(numbered);
      await onSave(normalizeAssets(numbered),normalizeImageRules(rules),normalizeDisplayRules(displayDraft),numbered.some(asset=>asset.id===bookmarkImageId)?bookmarkImageId:undefined,numbered.some(asset=>asset.id===cardImageId)?cardImageId:undefined);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { locked.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="shelf-assets-dialog" aria-labelledby={titleId}
    aria-busy={busy} onCancel={event => { event.preventDefault(); if (event.target === event.currentTarget && !locked.current) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !locked.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    } }}>
    <header className="shelf-assets-heading"><h2 id={titleId}>에셋 이미지 관리</h2><div className="shelf-assets-heading-actions"><button type="button" className="shelf-assets-icon" aria-label="기본값으로 되돌리기" disabled={busy} title="기본값으로 되돌리기 — 이 책장의 이미지와 초상 비우기" onClick={()=>{setDraft([]);setRules([]);setDisplayDraft([]);setBookmarkImageId(undefined);setCardImageId(undefined);setError('');setNotice('');setPreviewFailures(new Set());}}><RotateCcw size={18}/></button><button type="button" className="shelf-assets-icon" aria-label="닫기" disabled={busy} onClick={onClose}><X size={20}/></button></div></header>
    <p className="shelf-assets-description">표지 · 책갈피 · 공유 카드</p>
    <div className="shelf-assets-toolbar"><button type="button" className="shelf-assets-add" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={19}/> 에셋 업로드</button></div>
    <input ref={input} type="file" onCancel={event=>event.stopPropagation()} className="shelf-assets-input" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.json,.charx,.risum,.zip,image/png,image/jpeg,image/webp,image/gif,image/avif,application/json,application/zip,application/charx"
      aria-label="이미지 또는 캐릭터 카드 파일" disabled={busy} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files); }}/>
    <p className="shelf-assets-hint">이미지, PNG·JSON·CHARX 카드, 카드 ZIP</p>
    <div className="shelf-assets-list" aria-label="책장 이미지 목록">
      {!draft.length && <p className="shelf-assets-empty">아직 이미지가 없어요.</p>}
      {draft.map((asset, index) => <div className="shelf-assets-row" key={asset.id}>
        <div className="shelf-assets-preview">{previewFailures.has(asset.id) ? <span>미리보기 없음</span> : <img src={asset.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setPreviewFailures(previous => new Set(previous).add(asset.id))}/>}</div>
        <label className="shelf-assets-name"><span>이미지 이름</span><input aria-label={`${index + 1}번째 이미지 이름`} value={asset.name} disabled={busy} onChange={event => {
          const name = event.target.value; setDraft(previous => previous.map(entry => entry.id === asset.id ? { ...entry, name } : entry));
        }} onBlur={()=>setDraft(previous=>previous.map(entry=>entry.id===asset.id?{...entry,name:uniqueAssetName(entry.name,previous.filter(other=>other.id!==entry.id).map(other=>other.name.trim()))}:entry))}/><small>{`{{img::${asset.name}}}`}</small>
        <span className="shelf-assets-portrait"><input type="radio" name={`${titleId}-portrait`} aria-label={`${asset.name || '이미지'} 표지 초상으로 사용`} checked={draft.find(entry => entry.type === 'icon')?.id === asset.id} disabled={busy} onChange={() => setDraft(previous => previous.map(entry => ({ ...entry, type: entry.id === asset.id ? 'icon' : 'asset' })))}/> 표지 초상</span><span className="shelf-assets-portrait"><input type="checkbox" aria-label={`${asset.name || '이미지'} 책갈피로 사용`} checked={bookmarkImageId===asset.id} disabled={busy} onChange={()=>setBookmarkImageId(previous=>previous===asset.id?undefined:asset.id)}/> 책갈피</span><span className="shelf-assets-portrait"><input type="checkbox" aria-label={`${asset.name || '이미지'} 공유 카드로 사용`} checked={cardImageId===asset.id} disabled={busy} onChange={()=>setCardImageId(previous=>previous===asset.id?undefined:asset.id)}/> 공유 카드</span></label>
        <button type="button" className="shelf-assets-icon shelf-assets-remove" aria-label={`${asset.name || '이미지'} 삭제`} disabled={busy} onClick={() => {setDraft(previous => previous.filter(entry => entry.id !== asset.id));if(bookmarkImageId===asset.id)setBookmarkImageId(undefined);if(cardImageId===asset.id)setCardImageId(undefined);}}><Trash2 size={18}/></button>
      </div>)}
    </div>
    {notice && <p role="status" className="shelf-assets-notice">{notice}</p>}
    {error && <p role="alert" className="shelf-assets-error">{error}</p>}
    <footer className="shelf-assets-actions"><span>{draft.length.toLocaleString()}개 이미지{rules.length>0&&` · 이미지 규칙 ${rules.length}개`}{displayDraft.length>0&&` · 이미지 치환 ${displayDraft.length}개`}</span><button type="button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="shelf-assets-save" disabled={busy} onClick={() => void save()}>{busy && <LoaderCircle size={16}/>} 저장</button></footer>
  </dialog>;
}
