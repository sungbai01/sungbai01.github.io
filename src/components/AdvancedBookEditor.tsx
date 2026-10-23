import {normalizeDisplayPrompt} from '../../shared/displayPrompt';
import DisplayPromptControls from './DisplayPromptControls';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Book } from '../lib/library';
import { applyAdvancedEdits, type AdvancedMessageDraft } from '../lib/advancedEditing';
import { startsChapter } from '../lib/pagination';
import { useToast } from '../lib/useToast';
import Toast from './Toast';
import './advanced-book-editor.css';

export type AdvancedBookEditorProps = { book: Book; onSave: (book: Book) => Promise<void>; onClose: () => void };

/** A bounded menu: opening a 20,000-message book never mounts 20,000 rows. */
function EditorPicker({ label, options, value, onChange }: { label: string; options: { value: number; label: string }[]; value?: number; onChange: (value: number) => void }) {
  const [page, setPage] = useState(0);
  const menu = useRef<HTMLDetailsElement>(null);
  const size = 60, selected = options.findIndex(option => option.value === value);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && menu.current) menu.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <div className="advanced-editor-picker"><span>{label}</span><details ref={menu} onToggle={event => { if (event.currentTarget.open) setPage(Math.floor(Math.max(0, selected) / size)); }} onKeyDown={event => {
    if (event.key === 'Escape' && menu.current?.open) { event.preventDefault(); event.stopPropagation(); menu.current.open = false; menu.current.querySelector('summary')?.focus(); }
  }}><summary aria-label={`${label} 이동`}>{options[selected]?.label ?? '없음'}<ChevronDown size={14}/></summary>
    <div className="advanced-editor-options" aria-label={`${label} 목록`}>
      {options.slice(page * size, (page + 1) * size).map(option => <button key={option.value} type="button" aria-current={option.value === value ? 'true' : undefined} onClick={() => { onChange(option.value); menu.current!.open = false; menu.current!.querySelector('summary')?.focus(); }}>{option.label}</button>)}
      {options.length > size && <div className="advanced-editor-menu-pages"><button type="button" disabled={page === 0} onClick={() => setPage(index => index - 1)}>이전 목록</button><span>{page + 1} / {Math.ceil(options.length / size)}</span><button type="button" disabled={(page + 1) * size >= options.length} onClick={() => setPage(index => index + 1)}>다음 목록</button></div>}
    </div>
  </details></div>;
}

/** Mount once per book (use key={book.id} when switching books). */
export default function AdvancedBookEditor({ book, onSave, onClose }: AdvancedBookEditorProps) {
  const [source] = useState(() => book.messages.length ? book : { ...book, messages: [{ role: 'assistant', name: book.author || '서술', content: '' }] });
  const [prompt,setPrompt]=useState(()=>normalizeDisplayPrompt(book.displayPrompt));
  const [drafts, setDrafts] = useState(new Map<number, AdvancedMessageDraft>());
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), continueButton = useRef<HTMLButtonElement>(null);
  const busy = useRef(false), exiting = useRef(false), alive = useRef(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const previousFocus = useRef<HTMLElement | null>(null), backdropDown = useRef(false);
  const closeCallback = useRef(onClose); closeCallback.current = onClose;
  const titleId = useId(), confirmId = useId();
  const { toast, notify, dismiss } = useToast();
  const chapters = useMemo(() => source.messages.flatMap((message, index) => startsChapter(source, index) ? [{ index, title: message.chapterTitle }] : []), [source]);
  const dirty = drafts.size > 0||JSON.stringify(prompt)!==JSON.stringify(normalizeDisplayPrompt(source.displayPrompt));
  const message = source.messages[selected], draft = drafts.get(selected);
  const chapter = [...chapters].reverse().find(entry => entry.index <= selected);
  const locked = saving || closing || confirmClose;

  useEffect(() => {
    alive.current = true;
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { alive.current = false; clearTimeout(closeTimer.current); element.close(); opener?.focus(); };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(() => { if (confirmClose) continueButton.current?.focus(); }, [confirmClose]);

  function finishClose() {
    if (exiting.current) return;
    exiting.current = true;
    setConfirmClose(false); setClosing(true);
    closeTimer.current = setTimeout(() => closeCallback.current(), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
  }
  function requestClose() {
    if (busy.current || exiting.current || confirmClose) return;
    if (dirty) { previousFocus.current = document.activeElement as HTMLElement; setConfirmClose(true); }
    else finishClose();
  }
  function keepEditing() { setConfirmClose(false); requestAnimationFrame(() => { if (alive.current) previousFocus.current?.focus(); }); }
  function patch(index: number, update: AdvancedMessageDraft) {
    setDrafts(previous => {
      const next = new Map(previous), value = { ...previous.get(index), ...update }, original = source.messages[index];
      if ((value.content ?? original.content) === original.content && (value.chapterTitle ?? original.chapterTitle ?? '') === (original.chapterTitle ?? '')) next.delete(index);
      else next.set(index, value);
      return next;
    });
  }
  async function save() {
    if (busy.current || exiting.current || !dirty) return;
    busy.current = true; setSaving(true); dismiss();
    // Let the disabled state paint before scanning a long pasted manuscript.
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      const edited=applyAdvancedEdits(source,drafts);
      await onSave({...edited,displayPrompt:prompt,updatedAt:new Date().toISOString()});
      if (alive.current) finishClose();
    } catch (cause) {
      if (alive.current) notify(cause instanceof Error ? cause.message : '저장하지 못했어요. 다시 시도해 주세요.', 'error');
    } finally { busy.current = false; if (alive.current) setSaving(false); }
  }

  return <dialog ref={dialog} className="advanced-book-editor" data-closing={closing || undefined} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (confirmClose) keepEditing(); else requestClose(); }}
    onPointerDown={event => { backdropDown.current = event.target === event.currentTarget; }}
    onClick={event => { if (event.target === event.currentTarget && backdropDown.current) requestClose(); backdropDown.current = false; }}>
    <div className="advanced-editor-shell">
      <header><div><h2 id={titleId}>고급 수정</h2><p>{source.title}</p></div><button type="button" className="advanced-editor-close" aria-label="닫기" title="닫기" disabled={locked} onClick={requestClose}><X size={20}/></button></header>
      <fieldset disabled={locked} inert={locked || undefined}>
        <DisplayPromptControls value={prompt} onChange={setPrompt} disabled={locked}/><nav aria-label="본문 이동">
          <EditorPicker label="챕터" value={chapter?.index} onChange={setSelected} options={chapters.map((entry, number) => ({ value: entry.index, label: `${number + 1}. ${drafts.get(entry.index)?.chapterTitle ?? entry.title ?? '제목 없음'}` }))}/>
          <EditorPicker label="메시지" value={selected} onChange={setSelected} options={source.messages.map((entry, index) => ({ value: index, label: `${index + 1}. ${entry.name || entry.role}` }))}/>
          <button type="button" title="이전 메시지" aria-label="이전 메시지" disabled={selected <= 0} onClick={() => setSelected(value => value - 1)}><ChevronLeft size={18}/></button>
          <button type="button" title="다음 메시지" aria-label="다음 메시지" disabled={selected >= source.messages.length - 1} onClick={() => setSelected(value => value + 1)}><ChevronRight size={18}/></button>
        </nav>
        {chapter && <label className="advanced-editor-chapter">챕터 이름<input aria-label="챕터 이름" value={drafts.get(chapter.index)?.chapterTitle ?? chapter.title ?? ''} placeholder="제목 없음" onChange={event => patch(chapter.index, { chapterTitle: event.target.value })}/></label>}
        <label className="advanced-editor-body">본문<textarea key={selected} aria-label="본문" autoFocus spellCheck={false} disabled={!message} value={draft?.content ?? message?.content ?? ''} placeholder="긴 글을 작성하거나 붙여넣으세요." onChange={event => patch(selected, { content: event.target.value })}/></label>
      </fieldset>
      <footer><span role="status">{saving ? '저장 중…' : dirty ? '저장하지 않은 변경사항' : '변경사항 없음'}</span><button type="button" disabled={locked} onClick={requestClose}>취소</button><button type="button" className="advanced-editor-save" disabled={locked || !dirty} onClick={() => void save()}>{saving ? '저장 중…' : '저장'}</button></footer>
      {confirmClose && <div className="advanced-editor-confirm-layer"><section className="advanced-editor-confirm" role="alertdialog" aria-modal="true" aria-labelledby={confirmId} onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const buttons = event.currentTarget.querySelectorAll('button');
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault(); buttons[0].focus(); }
      }}><h3 id={confirmId}>변경사항을 버릴까요?</h3><p>저장하지 않은 글이 사라져요.</p><div><button ref={continueButton} type="button" onClick={keepEditing}>계속 편집</button><button className="advanced-editor-discard" type="button" onClick={finishClose}>버리고 닫기</button></div></section></div>}
      <Toast key={toast.id} message={toast.message} tone={toast.tone} duration={toast.duration} onDismiss={dismiss}/>
    </div>
  </dialog>;
}
