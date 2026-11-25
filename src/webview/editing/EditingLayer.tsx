/**
 * Thin React glue for inline text editing, image import (paste / drop / picker), image controls and
 * Mermaid paste. All decisions live in editSession.ts and media.ts (pure, unit-tested).
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Asset, BoardDocument, ImageElement, Point, Viewport } from '../../core/model/types';
import { boardToScreen } from '../../core/viewport';
import { htmlToRuns, runsToHtml } from '../../core/text';
import { MAX_ALT_TEXT_LENGTH } from '../../core/image';
import { dispatchOp } from '../ops';
import { store } from '../store';
import { onCancelCreation, setActiveTool, useUiState } from '../uiState';
import { offsetOf, positionAt } from './caret';
import { beginEdit, editTargetForDoubleClick, endEdit, isTextBearing, styleForShortcut, toggleStyle, type EditSession, type TextBearing } from './editSession';
import { editingStore, useEditing } from './editingStore';
import {
  altTextOp,
  classifyPasteText,
  clampCrop,
  cropOp,
  planImageImports,
  planReplaceSource,
  rejectionMessages,
  type DecodeFn,
  type ImageRejection,
  type RawImageFile,
} from './media';
import './editing.css';

const PENDING_FAILSAFE_MS = 2000;

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Natural dimensions through the browser decoder; SVG goes through <img>. */
export const decodeImage: DecodeFn = async (bytes, mime) => {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (mime !== 'image/svg+xml' && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return size;
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      img.onerror = () => resolve(undefined);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

async function readFiles(files: readonly File[]): Promise<{ raws: RawImageFile[]; unreadable: ImageRejection[] }> {
  const raws: RawImageFile[] = [];
  const unreadable: ImageRejection[] = [];
  for (const f of files) {
    try {
      raws.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), size: f.size });
    } catch {
      unreadable.push({ name: f.name, message: 'The image could not be read.' });
    }
  }
  return { raws, unreadable };
}

function report(rejected: readonly ImageRejection[]): void {
  for (const m of rejectionMessages(rejected)) store.addNotice('error', m);
}

async function importFiles(files: readonly File[], at: Point): Promise<void> {
  const { raws, unreadable } = await readFiles(files);
  const plan = await planImageImports(raws, decodeImage, at);
  for (const op of plan.ops) dispatchOp(op.tool, op.input);
  report([...unreadable, ...plan.rejected]);
}

function imageFilesOf(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f && (f.type.startsWith('image/') || f.type === '')) out.push(f);
    }
  }
  if (out.length === 0) for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith('image/')) out.push(f);
  return out;
}

export interface EditingLayerProps {
  doc: BoardDocument;
  vp: Viewport;
  readOnly: boolean;
  selection: readonly string[];
  containerRef: RefObject<HTMLDivElement | null>;
  toBoard(clientX: number, clientY: number): Point;
}

export function EditingLayer({ doc, vp, readOnly, selection, containerRef, toBoard }: EditingLayerProps) {
  const { activeTool } = useUiState();
  const { session, pendingNew } = useEditing();
  const docRef = useRef(doc);
  docRef.current = doc;
  const pickerRef = useRef<HTMLInputElement>(null);

  const viewCenter = (): Point => {
    const r = containerRef.current?.getBoundingClientRect();
    return r ? toBoard(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
  };
  const centerRef = useRef(viewCenter);
  centerRef.current = viewCenter;

  // Open edit mode for a freshly created text element once it reaches the replica.
  useEffect(() => {
    if (!pendingNew) return;
    const el = doc.elements.find((e) => e.id === pendingNew);
    if (isTextBearing(el)) {
      editingStore.start(beginEdit(el, true));
      return;
    }
    const t = setTimeout(editingStore.clearPending, PENDING_FAILSAFE_MS);
    return () => clearTimeout(t);
  }, [pendingNew, doc]);

  // Esc / tool change cancels creation: leave edit mode (an empty new text is removed on exit).
  useEffect(() => onCancelCreation(editingStore.clearPending), []);

  // Double-click a text-bearing element: enter edit mode synchronously (well within 100 ms).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onDbl = (e: MouseEvent): void => {
      if (readOnly || isEditable(e.target)) return;
      const node = (e.target as Element | null)?.closest('[data-element-id]');
      const id = node?.getAttribute('data-element-id');
      const target = editTargetForDoubleClick(docRef.current.elements.find((x) => x.id === id), readOnly);
      if (target) {
        e.preventDefault();
        editingStore.start(beginEdit(target));
      }
    };
    el.addEventListener('dblclick', onDbl);
    return () => el.removeEventListener('dblclick', onDbl);
  }, [containerRef, readOnly]);

  // Paste: images, then Mermaid flowcharts.
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e: ClipboardEvent): void => {
      if (isEditable(e.target)) return;
      const files = imageFilesOf(e.clipboardData);
      const at = centerRef.current();
      if (files.length > 0) {
        e.preventDefault();
        void importFiles(files, at);
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const c = classifyPasteText(text, at);
      if (c.kind === 'mermaid') {
        e.preventDefault();
        dispatchOp(c.op.tool, c.op.input);
      } else if (c.kind === 'mermaid-error') {
        e.preventDefault();
        store.addNotice('error', c.message);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [readOnly]);

  // Drop images at the drop position.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || readOnly) return;
    const over = (e: DragEvent): void => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent): void => {
      const files = imageFilesOf(e.dataTransfer);
      const all = Array.from(e.dataTransfer?.files ?? []);
      if (all.length === 0) return;
      e.preventDefault();
      void importFiles(files.length > 0 ? files : all, toBoard(e.clientX, e.clientY));
    };
    el.addEventListener('dragover', over);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragover', over);
      el.removeEventListener('drop', drop);
    };
  }, [containerRef, readOnly, toBoard]);

  // Image tool opens the file picker.
  useEffect(() => {
    if (activeTool !== 'image' || readOnly) return;
    pickerRef.current?.click();
    setActiveTool('select');
  }, [activeTool, readOnly]);

  const editEl = session ? doc.elements.find((e) => e.id === session.elementId) : undefined;
  useEffect(() => {
    if (session && !editEl) editingStore.stop();
  }, [session, editEl]);

  const single = selection.length === 1 ? doc.elements.find((e) => e.id === selection[0]) : undefined;

  return (
    <>
      <input
        ref={pickerRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        aria-label="Choose images"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) void importFiles(files, centerRef.current());
        }}
      />
      {session && isTextBearing(editEl) && <TextEditor key={session.elementId} el={editEl} session={session} vp={vp} />}
      {!readOnly && !session && single && single.type === 'image' && (
        <ImageControls key={single.id} el={single} assets={doc.assets} vp={vp} />
      )}
    </>
  );
}

function placeCaretAtEnd(div: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(div);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

function TextEditor({ el, session, vp }: { el: TextBearing; session: EditSession; vp: Viewport }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const elRef = useRef(el);
  elRef.current = el;

  useLayoutEffect(() => {
    const div = ref.current;
    if (!div) return;
    div.innerHTML = runsToHtml(el.runs); // escaped, whitelist-only markup
    div.focus();
    placeCaretAtEnd(div);
  }, []);

  const exit = (): void => {
    if (done.current) return;
    done.current = true;
    const div = ref.current;
    const runs = div ? htmlToRuns(div.innerHTML) : [];
    const outcome = endEdit(session, elRef.current, runs);
    if (outcome.kind !== 'none') dispatchOp(outcome.op.tool, outcome.op.input);
    editingStore.stop();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      exit();
      return;
    }
    const key = styleForShortcut(e);
    if (!key) return;
    e.preventDefault();
    const div = ref.current;
    const sel = window.getSelection();
    if (!div || !sel || sel.rangeCount === 0 || !div.contains(sel.anchorNode)) return;
    const a = offsetOf(div, sel.anchorNode as Node, sel.anchorOffset);
    const b = offsetOf(div, sel.focusNode as Node, sel.focusOffset);
    const next = toggleStyle(htmlToRuns(div.innerHTML), Math.min(a, b), Math.max(a, b), key);
    div.innerHTML = runsToHtml(next);
    const from = positionAt(div, Math.min(a, b));
    const to = positionAt(div, Math.max(a, b));
    const r = document.createRange();
    r.setStart(from.node, from.offset);
    r.setEnd(to.node, to.offset);
    sel.removeAllRanges();
    sel.addRange(r);
  };

  const p = boardToScreen(vp, { x: el.x, y: el.y });
  return (
    <div
      ref={ref}
      className="ob-editing ob-text-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Edit text"
      spellCheck={false}
      style={{
        left: p.x,
        top: p.y,
        width: el.width * vp.zoom,
        minHeight: el.height * vp.zoom,
        fontSize: el.fontSize * vp.zoom,
        fontFamily: el.fontFamily,
        textAlign: el.align,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
      onKeyDown={onKeyDown}
      onBlur={exit}
      onPointerDown={(e) => e.stopPropagation()}
      onPaste={(e) => {
        e.preventDefault();
        e.stopPropagation();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
    />
  );
}

function ImageControls({ el, assets, vp }: { el: ImageElement; assets: readonly Asset[]; vp: Viewport }) {
  const asset = assets.find((a) => a.id === el.assetId);
  const [alt, setAlt] = useState(el.alt ?? '');
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState(() => ({ x: el.crop?.x ?? 0, y: el.crop?.y ?? 0, w: el.crop?.w ?? asset?.width ?? 0, h: el.crop?.h ?? asset?.height ?? 0 }));
  const replaceRef = useRef<HTMLInputElement>(null);
  const p = boardToScreen(vp, { x: el.x, y: el.y + el.height });

  const commitAlt = (): void => {
    if (alt === (el.alt ?? '')) return;
    const op = altTextOp(el.id, alt);
    if (op) dispatchOp(op.tool, op.input);
  };

  const applyCrop = (): void => {
    if (!asset) return;
    const c = clampCrop(crop, asset);
    if (!c) return store.addNotice('error', 'The crop area is empty.');
    const op = cropOp(el.id, c);
    dispatchOp(op.tool, op.input);
    setCropOpen(false);
  };

  const replace = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const { raws, unreadable } = await readFiles([file]);
    const raw = raws[0];
    if (!raw) return report(unreadable);
    const r = await planReplaceSource(el, raw, decodeImage);
    if (r.op) dispatchOp(r.op.tool, r.op.input);
    else if (r.rejected) report([r.rejected]); // original image is kept
  };

  const num = (key: 'x' | 'y' | 'w' | 'h', label: string) => (
    <label>
      {label}
      <input type="number" value={crop[key]} min={0} onChange={(e) => setCrop({ ...crop, [key]: Number(e.target.value) })} />
    </label>
  );

  return (
    <div className="ob-editing ob-image-controls" style={{ left: p.x, top: p.y + 8 }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setCropOpen((v) => !v)} aria-expanded={cropOpen}>
        Crop
      </button>
      <button type="button" onClick={() => replaceRef.current?.click()}>
        Replace image
      </button>
      <input
        ref={replaceRef}
        type="file"
        hidden
        aria-label="Replacement image"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void replace(f);
        }}
      />
      <label>
        Alt text
        <input
          type="text"
          value={alt}
          maxLength={MAX_ALT_TEXT_LENGTH}
          onChange={(e) => setAlt(e.target.value)}
          onBlur={commitAlt}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitAlt();
          }}
        />
      </label>
      {cropOpen && (
        <fieldset>
          <legend>Crop (image pixels)</legend>
          {num('x', 'X')}
          {num('y', 'Y')}
          {num('w', 'Width')}
          {num('h', 'Height')}
          <button type="button" onClick={applyCrop}>
            Apply
          </button>
        </fieldset>
      )}
    </div>
  );
}
