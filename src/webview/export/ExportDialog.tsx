/** Accessible export modal (Req 12.1 to 12.6, 12.8, 12.9, 12.12, 12.13). Logic lives in model.ts. */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Select } from '../ui/Select';
import { EXPORT_FORMATS, EXPORT_SCALES, type ExportFormat, type ExportScale } from '../../core/export/scope';
import type { BoardDocument, ElementId } from '../../core/model/types';
import {
  applyPaddingInput,
  buildOptions,
  describePreview,
  initialDialogState,
  PADDING_MAX,
  previewExport,
  setFormat,
  supportsScale,
  supportsTransparency,
  toToolInput,
  type DialogState,
  type ScopeKind,
} from './model';

export interface ExportDialogProps {
  doc: Pick<BoardDocument, 'elements'>;
  selection: readonly ElementId[];
  onClose(): void;
  /** Called with the `openboard.export` tool input when the user confirms. */
  onExport(input: Record<string, unknown>): void;
}

const SCOPE_OPTIONS = [
  { value: 'board', label: 'Entire board' },
  { value: 'selection', label: 'Current selection' },
  { value: 'frame', label: 'A single frame' },
  { value: 'allFrames', label: 'All frames (one file each)' },
];

const FORMAT_LABEL: Record<ExportFormat, string> = { png: 'PNG', svg: 'SVG', jpeg: 'JPEG', webp: 'WebP', pdf: 'PDF' };

export function ExportDialog({ doc, selection, onClose, onExport }: ExportDialogProps) {
  const [state, setState] = useState<DialogState>(initialDialogState);
  const [paddingError, setPaddingError] = useState<string | undefined>();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const frames = useMemo(() => doc.elements.filter((e) => e.type === 'frame'), [doc.elements]);
  const frameId = state.frameId ?? frames[0]?.id;
  const effective: DialogState = { ...state, frameId };
  const options = buildOptions(effective, selection);
  const preview = previewExport(doc, options);
  const set = (patch: Partial<DialogState>): void => setState((s) => ({ ...s, ...patch }));

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('select, input, button')?.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>('select, input, button')].filter((x) => !x.hasAttribute('disabled'));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ob-modal-backdrop">
      <div ref={ref} className="ob-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId}>Export board</h2>

        <div className="ob-field">
          <label htmlFor={`${titleId}-format`}>Format</label>
          <Select
            id={`${titleId}-format`}
            value={state.format}
            options={EXPORT_FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
            onChange={(v) => setState((s) => setFormat(s, v as ExportFormat))}
          />
        </div>

        <div className="ob-field">
          <label htmlFor={`${titleId}-scope`}>Scope</label>
          <Select
            id={`${titleId}-scope`}
            value={state.scopeKind}
            options={SCOPE_OPTIONS}
            onChange={(v) => set({ scopeKind: v as ScopeKind })}
          />
        </div>

        {state.scopeKind === 'frame' && (
          <div className="ob-field">
            <label htmlFor={`${titleId}-frame`}>Frame</label>
            <Select
              id={`${titleId}-frame`}
              value={frameId ?? ''}
              options={frames.map((f) => ({
                value: f.id,
                label: 'title' in f && typeof f.title === 'string' && f.title ? f.title : f.id,
              }))}
              onChange={(v) => set({ frameId: v })}
            />
          </div>
        )}

        {supportsScale(state.format) && (
          <div className="ob-field">
            <label htmlFor={`${titleId}-scale`}>Scale</label>
            <Select
              id={`${titleId}-scale`}
              value={String(state.scale)}
              options={EXPORT_SCALES.map((n) => ({ value: String(n), label: `${n}x` }))}
              onChange={(v) => set({ scale: Number(v) as ExportScale })}
            />
          </div>
        )}

        <div className="ob-field">
          <label htmlFor={`${titleId}-padding`}>Padding (0 to {PADDING_MAX})</label>
          <input
            id={`${titleId}-padding`}
            type="text"
            inputMode="numeric"
            value={state.paddingText}
            aria-invalid={paddingError ? true : undefined}
            aria-describedby={paddingError ? `${titleId}-pad` : undefined}
            onChange={(e) => set({ paddingText: e.target.value })}
            onBlur={(e) => {
              const r = applyPaddingInput(state, e.target.value);
              setState(r.state);
              setPaddingError(r.error);
            }}
          />
          {paddingError && (
            <p id={`${titleId}-pad`} role="alert" className="ob-prop-error">
              {paddingError}
            </p>
          )}
        </div>

        <div className="ob-field">
          <label htmlFor={`${titleId}-background`}>Background</label>
          <Select
            id={`${titleId}-background`}
            value={state.background}
            options={[
              ...(supportsTransparency(state.format) ? [{ value: 'transparent', label: 'Transparent' }] : []),
              { value: 'white', label: 'White' },
              { value: 'theme', label: 'Theme' },
            ]}
            onChange={(v) => set({ background: v as DialogState['background'] })}
          />
        </div>

        <label>
          <input type="checkbox" checked={state.matchTheme} onChange={(e) => set({ matchTheme: e.target.checked })} /> Match theme colors
        </label>

        {state.format === 'png' && (
          <label>
            <input type="checkbox" checked={state.embedBoard} onChange={(e) => set({ embedBoard: e.target.checked })} /> Embed board in PNG
          </label>
        )}

        <p role={preview.ok ? 'status' : 'alert'} data-testid="export-preview">
          {describePreview(preview)}
        </p>

        <div className="ob-modal-actions">
          <button
            type="button"
            onClick={() => {
              // Commit a pending padding edit first; invalid text keeps the previous value (Req 12.6).
              const r = applyPaddingInput(effective, state.paddingText);
              setState(r.state);
              setPaddingError(r.error);
              if (r.error) return;
              const o = buildOptions({ ...effective, padding: r.state.padding }, selection);
              if (!previewExport(doc, o).ok) return;
              onExport(toToolInput(o));
              onClose();
            }}
            disabled={!preview.ok}
          >
            Export…
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
