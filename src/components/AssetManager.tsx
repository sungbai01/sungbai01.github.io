import AssetPicker,{AssetThumbnail} from './AssetPicker';
import { useEffect, useId, useRef, useState } from 'react';
import { Bookmark, BookImage, Check, ImagePlus, Images, LoaderCircle, RotateCcw, Ticket, Trash2, X } from 'lucide-react';
import Toast from './Toast';
import {useToast} from '../lib/useToast';
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
  useEffect(()=>{const element=input.current;if(!element)return;const cancel=(event:Event)=>event.stopPropagation();element.addEventListener('cancel',cancel);return()=>element.removeEventListener('cancel',cancel);},[]);
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
  const [selectedId,setSelectedId]=useState(assets[0]?.id);
  const [filter,setFilter]=useState<'all'|'cover'|'bookmark'|'card'>('all');
  const [closing,setClosing]=useState(false);
  const closeTimer=useRef<ReturnType<typeof setTimeout>>(undefined);
  const {toast,notify,dismiss}=useToast();
  useEffect(()=>{if(error||notice)notify([error,notice].filter(Boolean).join('\n'),error?'error':'info',0);},[error,notice,notify]);
  const beginClose=()=>{if(closing)return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}setClosing(true);closeTimer.current=setTimeout(onClose,160);};
  const close=()=>{if(!locked.current)beginClose();};
  const filteredAssets=draft.filter(asset=>filter==='all'||filter==='cover'&&asset.type==='icon'||filter==='bookmark'&&asset.id===bookmarkImageId||filter==='card'&&asset.id===cardImageId);
  const selected=filteredAssets.find(asset=>asset.id===selectedId)??filteredAssets[0];
  const coverId=draft.find(asset=>asset.type==='icon')?.id;

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLInputElement>('.asset-picker-search input')?.focus({preventScroll:true});
    return () => {clearTimeout(closeTimer.current);element.close();};
  }, []);

  async function addFiles(files: File[]) {
    if (!files.length || locked.current || closing) return;
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
    if (locked.current || closing) return;
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
      beginClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { locked.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="shelf-assets-dialog" aria-labelledby={titleId} data-closing={closing||undefined} inert={closing||undefined}
    aria-busy={busy} onCancel={event => { event.preventDefault(); if (event.target === event.currentTarget) close(); }}
    onClick={event => { if (event.target === event.currentTarget && !locked.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    } }}>
    <header className="shelf-assets-heading"><div className="shelf-assets-title"><span className="shelf-assets-title-icon"><Images size={21}/></span><div><h2 id={titleId}>에셋 이미지 관리</h2><p>{draft.length.toLocaleString()}개 이미지 <span>· 로컬 보관</span></p></div></div><div className="shelf-assets-heading-actions"><button type="button" className="shelf-assets-icon" aria-label="기본값으로 되돌리기" disabled={busy} title="기본값으로 되돌리기 — 이 책장의 이미지와 초상 비우기" onClick={()=>{setDraft([]);setRules([]);setDisplayDraft([]);setBookmarkImageId(undefined);setCardImageId(undefined);setError('');setNotice('');}}><RotateCcw size={17}/></button><button type="button" className="shelf-assets-icon shelf-assets-close" aria-label="닫기" disabled={busy} onClick={close}><X size={20}/></button></div></header>
    <div className="shelf-assets-toolbar"><div className="shelf-assets-filters" role="group" aria-label="에셋 용도 필터">{([{id:'all',label:'전체',icon:Images},{id:'cover',label:'표지',icon:BookImage},{id:'bookmark',label:'책갈피',icon:Bookmark},{id:'card',label:'공유 카드',icon:Ticket}] as const).map(({id,label,icon:Icon})=><button key={id} type="button" aria-pressed={filter===id} disabled={busy} onClick={()=>setFilter(id)}><Icon size={14}/><span>{label}</span></button>)}</div><button type="button" className="shelf-assets-add" aria-label="에셋 업로드" disabled={busy} title="PNG · JPEG · WEBP · GIF · AVIF · JSON · CHARX · RISUM · ZIP" onClick={() => input.current?.click()}><ImagePlus size={17}/><span>업로드</span></button></div>
    <input ref={input} type="file" className="shelf-assets-input" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.json,.charx,.risum,.zip,image/png,image/jpeg,image/webp,image/gif,image/avif,application/json,application/zip,application/charx"
      aria-label="이미지 또는 캐릭터 카드 파일" disabled={busy} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files); }}/>
    <div className="shelf-assets-workspace">
      <section className="shelf-assets-browser" aria-label="에셋 탐색"><AssetPicker assets={filteredAssets} label="책장 이미지 목록" selectedIds={selected?[selected.id]:[]} disabled={busy} selectionLabel="관리" onSelect={asset=>setSelectedId(asset.id)} emptyText={draft.length?'이 용도로 지정한 이미지가 없어요.':'이미지를 업로드해 시작하세요.'} renderDetails={asset=><div className="shelf-assets-badges">{asset.id===coverId&&<span title="표지"><BookImage size={12}/></span>}{asset.id===bookmarkImageId&&<span title="책갈피"><Bookmark size={12}/></span>}{asset.id===cardImageId&&<span title="공유 카드"><Ticket size={12}/></span>}</div>}/></section>
      <aside className="shelf-assets-inspector" aria-label="선택 이미지 설정">{selected?<>
        <div className="shelf-assets-selected-preview"><AssetThumbnail source={selected.src}/></div>
        <label className="shelf-assets-name"><span>이미지 이름</span><input aria-label={`${draft.findIndex(asset=>asset.id===selected.id)+1}번째 이미지 이름`} value={selected.name} disabled={busy} onChange={event=>{const name=event.target.value;setDraft(previous=>previous.map(asset=>asset.id===selected.id?{...asset,name}:asset));}} onBlur={()=>setDraft(previous=>previous.map(asset=>asset.id===selected.id?{...asset,name:uniqueAssetName(asset.name,previous.filter(other=>other.id!==asset.id).map(other=>other.name.trim()))}:asset))}/></label>
        <fieldset className="shelf-assets-roles"><legend>이미지 사용처</legend>
          <label><input type="radio" name={`${titleId}-portrait`} aria-label={`${selected.name || '이미지'} 표지 초상으로 사용`} checked={selected.id===coverId} disabled={busy} onChange={()=>setDraft(previous=>previous.map(asset=>({...asset,type:asset.id===selected.id?'icon':'asset'})))}/><BookImage size={16}/><span>표지</span><Check size={14}/></label>
          <label><input type="checkbox" aria-label={`${selected.name || '이미지'} 책갈피로 사용`} checked={bookmarkImageId===selected.id} disabled={busy} onChange={()=>setBookmarkImageId(previous=>previous===selected.id?undefined:selected.id)}/><Bookmark size={16}/><span>책갈피</span><Check size={14}/></label>
          <label><input type="checkbox" aria-label={`${selected.name || '이미지'} 공유 카드로 사용`} checked={cardImageId===selected.id} disabled={busy} onChange={()=>setCardImageId(previous=>previous===selected.id?undefined:selected.id)}/><Ticket size={16}/><span>공유 카드</span><Check size={14}/></label>
        </fieldset>
        <button type="button" className="shelf-assets-delete" aria-label={`${selected.name || '이미지'} 삭제`} disabled={busy} onClick={()=>{setDraft(previous=>previous.filter(asset=>asset.id!==selected.id));if(bookmarkImageId===selected.id)setBookmarkImageId(undefined);if(cardImageId===selected.id)setCardImageId(undefined);}}><Trash2 size={15}/><span>이미지 삭제</span></button>
      </>:<div className="shelf-assets-inspector-empty"><Images size={30}/><span>이미지를 선택하세요</span></div>}</aside>
    </div>
    <footer className="shelf-assets-actions"><span title="PNG · JPEG · WEBP · GIF · AVIF · JSON · CHARX · RISUM · ZIP">PNG · JPEG · CHARX · RISUM <span>외</span></span><button type="button" disabled={busy} onClick={close}>취소</button><button type="button" className="shelf-assets-save" disabled={busy} onClick={() => void save()}>{busy && <LoaderCircle size={16} className="animate-spin"/>} 저장</button></footer>
    {toast.message&&<Toast key={toast.id} message={toast.message} tone={toast.tone} duration={toast.duration} onDismiss={dismiss}/>}
  </dialog>;
}
