import { useEffect, useId, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import type { SizingMode } from '../../core/layout/types';
import type { Element, FrameElement } from '../../core/model';
import type { TokenCollection } from '../../core/tokens/types';
import { makeTokenRef, tokenRefName } from '../../core/tokens/validate';
import { t } from '../i18n/t';
import { IconSegmented } from '../ui/IconSegmented';
import { InputAffix } from '../ui/InputAffix';
import { Select } from '../ui/Select';
import {
  buildDisableLayoutOp,
  numberTokenNames,
  buildEnableLayoutOp,
  buildLayoutFieldCommit,
  buildSizingCommit,
  buildIgnoreLayoutOp,
  enumValues,
  ignoreLayoutLabel,
  ignoreLayoutState,
  isEnumPath,
  LAYOUT_PATHS,
  layoutFieldValue,
  layoutLabel,
  SIZING_AXES,
  SIZING_MODE_LIST,
  sizingAxisLabel,
  sizingAxisValue,
  sizingModeLabel,
  summarizeLayoutState,
  type LayoutPath,
  type PanelCommit,
  type PanelOp,
  type SizingAxis,
} from './layout-model';
import { fieldReducer, MIXED_LABEL, type FieldState } from './model';

interface CommonProps {
  readOnly: boolean;
  onOp(op: PanelOp): void;
}

/** Prefix icon of each numeric layout field. */
const LAYOUT_PREFIX_ICONS: Partial<Record<LayoutPath, string>> = {
  gap: 'gap',
  'padding.top': 'padTop',
  'padding.right': 'padRight',
  'padding.bottom': 'padBottom',
  'padding.left': 'padLeft',
};

const initState = (frames: readonly FrameElement[], p: LayoutPath): FieldState => {
  const v = layoutFieldValue(frames, p);
  return { draft: v.text, committed: v.text, mixed: v.mixed };
};

/** One layout field: a Select for enums, a text input for gap and padding. */
function LayoutField({
  path,
  frames,
  readOnly,
  onOp,
  tokens,
}: CommonProps & { path: LayoutPath; frames: readonly FrameElement[]; tokens?: TokenCollection }) {
  const pickId = useId();
  const id = useId();
  const errId = `${id}-err`;
  const [state, dispatch] = useReducer(fieldReducer, undefined, () => initState(frames, path));
  const fresh = useRef(true);

  // Resync whenever the underlying element data changes (selection, patches, undo).
  useEffect(() => {
    if (fresh.current) {
      fresh.current = false;
      return;
    }
    dispatch({ type: 'sync', state: initState(frames, path) });
  }, [frames, path]);

  const commit = (text: string): void => {
    if (!state.mixed && text === state.committed && state.error === undefined) return;
    if (state.mixed && text === '') return;
    const r: PanelCommit = buildLayoutFieldCommit(frames, path, text, tokens);
    if (r.ok) {
      dispatch({ type: 'accept', text: text.trim() });
      onOp(r.op);
    } else dispatch({ type: 'reject', error: r.error });
  };

  const invalid = state.error !== undefined;
  const label = layoutLabel(path);
  const numberNames = numberTokenNames(tokens);
  const labelId = `${id}-label`;
  // Direction and alignment are short enums: a row of icon buttons. Gap and padding are compact
  // inputs with an icon prefix; the full label stays the accessible name.
  return (
    <div className={`ob-prop${isEnumPath(path) ? '' : ' ob-prop-compact'}`} data-layout-field={path}>
      {isEnumPath(path) ? (
        <>
          <span id={labelId} className="ob-prop-label" title={label}>
            {label}
          </span>
          <IconSegmented
            label={label}
            labelledBy={labelId}
            values={enumValues(path)}
            value={state.mixed ? undefined : state.draft}
            mixed={state.mixed}
            iconFor={(v) => `${path}:${v}`}
            disabled={readOnly}
            invalid={invalid}
            describedBy={invalid ? errId : undefined}
            onChange={commit}
          />
        </>
      ) : (
        <>
          <label htmlFor={id} className="ob-sr-only">
            {label}
          </label>
          <InputAffix icon={LAYOUT_PREFIX_ICONS[path]} title={label}>
            <input
              id={id}
              type="text"
              inputMode="decimal"
              disabled={readOnly}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errId : undefined}
              value={state.draft}
              placeholder={state.mixed ? MIXED_LABEL : undefined}
              onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
                else if (e.key === 'Escape') dispatch({ type: 'sync', state: initState(frames, path) });
              }}
            />
          </InputAffix>
        </>
      )}
      {!isEnumPath(path) && numberNames.length > 0 ? (
        // Number Token picker (Req 11.15): picking writes `token:<name>`; typing a number detaches.
        <div className="ob-prop-token" data-layout-token-field={path}>
          <label htmlFor={pickId} className="ob-prop-token-label" title={t('{0} token', label)}>
            {t('{0} token', label)}
          </label>
          <Select
            id={pickId}
            disabled={readOnly}
            value={tokenRefName(state.draft) ?? ''}
            mixed={state.mixed}
            mixedLabel={MIXED_LABEL}
            options={numberNames.map((n) => ({ value: n, label: n }))}
            onChange={(n) => commit(makeTokenRef(n))}
          />
        </div>
      ) : null}
      {invalid ? (
        <span id={errId} role="alert" className="ob-prop-error">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

/** Auto_Layout composite control with enable and disable actions (Req 19.8, 19.9, 26.1, 26.7). */
export function LayoutSection({
  frames,
  readOnly,
  onOp,
  tokens,
}: CommonProps & { frames: readonly FrameElement[]; tokens?: TokenCollection }) {
  const { on, off } = summarizeLayoutState(frames);
  return (
    <fieldset className="ob-prop ob-prop-layout" data-field="layout">
      <legend className="ob-sr-only">{t('Auto Layout')}</legend>
      <div className="ob-prop-layout-actions">
        <button type="button" disabled={readOnly || off === 0} onClick={() => { const op = buildEnableLayoutOp(frames); if (op) onOp(op); }}>
          {t('Enable Auto Layout')}
        </button>
        <button type="button" disabled={readOnly || on === 0} onClick={() => { const op = buildDisableLayoutOp(frames); if (op) onOp(op); }}>
          {t('Disable Auto Layout')}
        </button>
      </div>
      {on > 0 ? (
        <div className="ob-prop-grid">
          {LAYOUT_PATHS.map((p) => (
            <LayoutField key={p} path={p} frames={frames} readOnly={readOnly} onOp={onOp} tokens={tokens} />
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

/** Width or height sizing as a three-segment radio group with roving focus (Req 20.1, 20.11, 26.3). */
function SizingAxisControl({ axis, elements, readOnly, onOp }: CommonProps & { axis: SizingAxis; elements: readonly Element[] }) {
  const labelId = useId();
  const errId = `${labelId}-err`;
  const [error, setError] = useState<string | undefined>();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const value = sizingAxisValue(elements, axis);

  useEffect(() => setError(undefined), [elements]);

  const choose = (mode: SizingMode): void => {
    if (mode === value) return;
    const r = buildSizingCommit(elements, axis, mode);
    if (r.ok) {
      setError(undefined);
      onOp(r.op);
    } else setError(r.error);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const last = SIZING_MODE_LIST.length - 1;
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation(); // keep arrow keys away from the canvas nudge shortcuts
    refs.current[next]?.focus();
    choose(SIZING_MODE_LIST[next]!);
  };

  const tabbable = Math.max(0, value === undefined ? 0 : SIZING_MODE_LIST.indexOf(value));
  return (
    <div className="ob-prop ob-prop-sizing" data-sizing-axis={axis}>
      <span id={labelId} className="ob-prop-sizing-label" title={sizingAxisLabel(axis)}>
        {sizingAxisLabel(axis)}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className="ob-segmented"
        data-mixed={value === undefined ? 'true' : undefined}
      >
        {SIZING_MODE_LIST.map((mode, i) => (
          <button
            key={mode}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === mode}
            tabIndex={i === tabbable ? 0 : -1}
            disabled={readOnly}
            aria-label={`${sizingAxisLabel(axis)}: ${sizingModeLabel(mode)}`}
            data-sizing-mode={mode}
            onClick={() => choose(mode)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {sizingModeLabel(mode)}
          </button>
        ))}
      </div>
      {value === undefined ? <span className="ob-prop-hint">{MIXED_LABEL}</span> : null}
      {error ? (
        <span id={errId} role="alert" className="ob-prop-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Checkbox that excludes the selected children of a Layout_Frame from its arrangement (Req 19.14, 26.1). */
export function IgnoreLayoutSection({ elements, readOnly, onOp }: CommonProps & { elements: readonly Element[] }) {
  const id = useId();
  const state = ignoreLayoutState(elements);
  return (
    <div className="ob-prop" data-field="ignoreLayout">
      <label htmlFor={id}>{ignoreLayoutLabel()}</label>
      <input
        id={id}
        type="checkbox"
        disabled={readOnly}
        checked={state === 'on'}
        ref={(el) => {
          if (el) el.indeterminate = state === 'mixed';
        }}
        onChange={(e) => {
          const op = buildIgnoreLayoutOp(elements, e.target.checked);
          if (op) onOp(op);
        }}
      />
    </div>
  );
}

/** Sizing control: width and height segments of fixed, hug and fill (Req 20.1, 20.11). */
export function SizingSection({ elements, readOnly, onOp }: CommonProps & { elements: readonly Element[] }) {
  return (
    <fieldset className="ob-prop ob-prop-sizing-group" data-field="sizing">
      <legend className="ob-sr-only">{t('Sizing')}</legend>
      {SIZING_AXES.map((axis) => (
        <SizingAxisControl key={axis} axis={axis} elements={elements} readOnly={readOnly} onOp={onOp} />
      ))}
    </fieldset>
  );
}
