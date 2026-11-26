/** Accessible export modal (Req 12.1 to 12.6, 12.8, 12.9, 12.12, 12.13). Logic lives in model.ts. */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Select } from '../ui/Select';
import { Icon } from '../icons';
import { EXPORT_FORMATS, EXPORT_SCALES, hasComponentMasters, type ExportFormat, type ExportScale } from '../../core/export/scope';
import type { BoardDocument, ElementId } from '../../core/model/types';
import { hasModeTokens } from '../../core/tokens/validate';
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
  doc: Pick<BoardDocument, 'elements'> & Partial<Pick<BoardDocument, 'tokens'>>;
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

const FOCUSABLE = 'select, input, button';

/** A titled group, laid out like a properties panel section. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="ob-prop-section" aria-labelledby={id}>
      <div className="ob-prop-section-header">
        <h3 id={id} className="ob-prop-section-title">
          {title}
        </h3>
      </div>
      <div className="ob-prop-section-body">{children}</div>
    </section>
  );
}

/** Checkbox then label on one line (properties panel style). */
function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange(v: boolean): void; children: ReactNode }) {
  return (
    <div className="ob-prop ob-prop-check">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{children}</label>
    </div>
  );
}

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
    // Start on the first field, not the header's close button.
    ref.current?.querySelector<HTMLElement>(`.ob-modal-body :is(${FOCUSABLE})`)?.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute('disabled'));
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

  const confirm = (): void => {
    // Commit a pending padding edit first; invalid text keeps the previous value (Req 12.6).
    const r = applyPaddingInput(effective, state.paddingText);
    setState(r.state);
    setPaddingError(r.error);
    if (r.error) return;
    const o = buildOptions({ ...effective, padding: r.state.padding }, selection);
    if (!previewExport(doc, o).ok) return;
    onExport(toToolInput(o));
    onClose();
  };

  return (
    <div className="ob-modal-backdrop">
      <div ref={ref} className="ob-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="ob-modal-header">
          <h2 id={titleId}>Export board</h2>
          <button type="button" className="ob-modal-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="ob-modal-body">
          <Section title="Area">
            <div className="ob-prop">
              <label htmlFor={`${titleId}-scope`}>Scope</label>
              <Select id={`${titleId}-scope`} value={state.scopeKind} options={SCOPE_OPTIONS} onChange={(v) => set({ scopeKind: v as ScopeKind })} />
            </div>

            {state.scopeKind === 'frame' && (
              <div className="ob-prop">
                <label htmlFor={`${titleId}-frame`}>Frame</label>
                <Select
                  id={`${titleId}-frame`}
                  value={frameId ?? ''}
                  options={frames.map((f) => ({
                    value: f.id,
                    label: 'name' in f && typeof f.name === 'string' && f.name ? f.name : f.id,
                  }))}
                  onChange={(v) => set({ frameId: v })}
                />
              </div>
            )}

            <div className="ob-prop">
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
          </Section>

          <Section title="Output">
            <div className="ob-prop-row" data-cols={supportsScale(state.format) ? '2' : undefined}>
              <div className="ob-prop">
                <label htmlFor={`${titleId}-format`}>Format</label>
                <Select
                  id={`${titleId}-format`}
                  value={state.format}
                  options={EXPORT_FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
                  onChange={(v) => setState((s) => setFormat(s, v as ExportFormat))}
                />
              </div>
              {supportsScale(state.format) && (
                <div className="ob-prop">
                  <label htmlFor={`${titleId}-scale`}>Scale</label>
                  <Select
                    id={`${titleId}-scale`}
                    value={String(state.scale)}
                    options={EXPORT_SCALES.map((n) => ({ value: String(n), label: `${n}x` }))}
                    onChange={(v) => set({ scale: Number(v) as ExportScale })}
                  />
                </div>
              )}
            </div>

            <div className="ob-prop">
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

            {hasModeTokens(doc.tokens) && (
              <div className="ob-prop">
                <label htmlFor={`${titleId}-token-mode`}>Token mode</label>
                <Select
                  id={`${titleId}-token-mode`}
                  value={state.tokenMode}
                  options={[
                    { value: 'active', label: 'Active mode' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                  onChange={(v) => set({ tokenMode: v as DialogState['tokenMode'] })}
                />
              </div>
            )}

            <Check id={`${titleId}-match`} checked={state.matchTheme} onChange={(v) => set({ matchTheme: v })}>
              Match theme colors
            </Check>
            {hasComponentMasters(doc) && (
              <Check id={`${titleId}-masters`} checked={state.excludeMasters} onChange={(v) => set({ excludeMasters: v })}>
                Exclude component masters
              </Check>
            )}
            {state.format === 'png' && (
              <Check id={`${titleId}-embed`} checked={state.embedBoard} onChange={(v) => set({ embedBoard: v })}>
                Embed board in PNG
              </Check>
            )}
          </Section>
        </div>

        <div className="ob-modal-footer">
          <p role={preview.ok ? 'status' : 'alert'} className={preview.ok ? 'ob-modal-status' : 'ob-modal-status ob-prop-error'} data-testid="export-preview">
            {describePreview(preview)}
          </p>
          <div className="ob-modal-actions">
            <button type="button" className="ob-button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" onClick={confirm} disabled={!preview.ok}>
              <Icon name="export" size={14} />
              <span>Export…</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
