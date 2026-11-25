import { Fragment, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { ICON_NAMES, ICON_PATHS, ICON_SEARCH_LIMIT, searchIcons } from '../../core/icons';
import type { Element } from '../../core/model';
import { formatHex, parseColor } from '../../core/theme';
import { resolveTokens, tokenRefName, type TokenCollection } from '../../core/tokens';
import { fontPreview, requestFonts, searchFonts, useInstalledFonts } from '../fonts';
import { t } from '../i18n/t';
import { nextGlyphIndex } from '../palette/IconPicker';
import { IconSegmented } from '../ui/IconSegmented';
import { InputAffix } from '../ui/InputAffix';
import { Select } from '../ui/Select';
import { PanelIcon } from './panel-icons';
import { IgnoreLayoutSection, LayoutSection, SizingSection } from './LayoutControls';
import { ignoreLayoutApplies, layoutApplies, sizingApplies, type PanelOp } from './layout-model';
import {
  buildDetachInstanceOp,
  buildRenameOp,
  buildResetOverridesOp,
  componentContext,
  goToMasterTarget,
  hasOverrides,
  isMasterMissing,
  overriddenProperties,
  type ComponentContext,
  type ComponentOp,
} from './component-model';
import {
  buildApplyTokenOp,
  buildDetachTokenOp,
  summarizeTokenField,
  tokenCategoryOf,
  tokenNames,
  type TokenCommit,
  buildFitCommit,
  buildRemoveImageFill,
  IMAGE_FILL_FITS,
  summarizeImageFill,
  commitCorner,
  CORNER_SLOTS,
  cornerLabel,
  initCornerState,
  type CornerSlot,
  commitField,
  fieldReducer,
  fieldSections,
  fieldsFor,
  initFieldStateFor,
  MIXED_LABEL,
  type BatchOp,
  type FieldDef,
  type FieldState,
  type UpdateOp,
} from './model';

export interface PropertiesPanelViewProps {
  /** Currently selected elements (resolved from the document). */
  elements: readonly Element[];
  readOnly?: boolean;
  /** The document's design tokens, for the token pickers. */
  tokens?: TokenCollection;
  onUpdate(op: UpdateOp): void;
  /** Apply an image file as the fill of the given elements; resolves to an error message when rejected. */
  onImageFill?(file: File, ids: string[]): Promise<string | undefined>;
  /** Every element of the document, to resolve masters, owners and name clashes. Defaults to `elements`. */
  allElements?: readonly Element[];
  /** Run a component action (rename, detach, reset overrides). */
  onComponentOp?(op: ComponentOp): void;
  /** Select the master with this id and bring it into view. */
  onGoToMaster?(id: string): void;
  /** Dispatch a layout or sizing op (an update or one batch, i.e. one Undo_History entry). */
  onOp?(op: PanelOp): void;
}

const TYPE_NAMES: Readonly<Record<string, string>> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  line: 'Line',
  arrow: 'Arrow',
  freehand: 'Drawing',
  text: 'Text',
  sticky: 'Sticky note',
  image: 'Image',
  frame: 'Frame',
  flowNode: 'Flow node',
  edge: 'Connector',
  icon: 'Icon',
};

/** Header subtitle: a frame's name, the element type, or a count for a multi-selection. */
export function selectionSummary(elements: readonly Element[]): string {
  if (elements.length > 1) return t('{0} elements', elements.length);
  const el = elements[0];
  if (!el) return '';
  if (el.type === 'frame') return el.component ?? (el.name || t(TYPE_NAMES['frame']!));
  return t(TYPE_NAMES[el.type] ?? el.type);
}

/**
 * Compact square "detach token" button that sits beside the token picker, so the picker and the
 * action share one row at the same height. The accessible name and tooltip carry the full label.
 */
export function DetachButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick(): void }) {
  return (
    <button type="button" className="ob-icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {/* Broken link. */}
        <path d="M9 17H7a5 5 0 0 1 0-10h2" />
        <path d="M15 7h2a5 5 0 0 1 4 8" />
        <path d="M8 12h3" />
        <path d="M3 3l18 18" />
      </svg>
    </button>
  );
}

/** Token picker, missing-token mark and detach action for a color or font field (Req 11.9, 11.12, 11.17). */
function TokenControls({
  def,
  elements,
  tokens,
  readOnly,
  onUpdate,
}: {
  def: FieldDef;
  elements: readonly Element[];
  tokens: TokenCollection | undefined;
  readOnly: boolean;
  onUpdate(op: UpdateOp): void;
}) {
  const pickId = useId();
  const [error, setError] = useState<string | undefined>();
  const category = tokenCategoryOf(def);
  if (!category) return null;
  const names = tokenNames(tokens, category);
  const summary = summarizeTokenField(elements, def, tokens);
  if (names.length === 0 && !summary.hasRef) return null;

  const run = (r: TokenCommit): void => {
    if (r.ok) {
      setError(undefined);
      onUpdate(r.op);
    } else setError(r.error);
  };

  return (
    <div className="ob-prop-token" data-token-field={def.name} data-missing={summary.missing ? 'true' : undefined}>
      <label htmlFor={pickId} className="ob-prop-token-label" title={t('{0} token', def.label)}>
        {t('{0} token', def.label)}
      </label>
      <div className="ob-prop-token-controls">
        <Select
          id={pickId}
          disabled={readOnly || names.length === 0}
          value={summary.name ?? ''}
          mixed={summary.mixed}
          mixedLabel={MIXED_LABEL}
          options={names.map((n) => ({ value: n, label: n }))}
          onChange={(n) => run(buildApplyTokenOp(elements, def, n, tokens))}
        />
        <DetachButton
          label={t('Detach token: {0}', def.label)}
          disabled={readOnly || !summary.hasRef}
          onClick={() => run(buildDetachTokenOp(elements, def, tokens))}
        />
      </div>
      {summary.missing ? (
        <span className="ob-prop-token-missing" role="status">
          {t('Missing token: {0}', summary.name ?? '')}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="ob-prop-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Icon name input with a filterable picker (Req 23.7, 26.1). Results are derived from the draft on
 * every render, so the list updates synchronously with each keystroke. Typing alone never commits:
 * Enter or choosing a result does, and leaving the control restores the committed name.
 */
function IconNameControl({
  id,
  disabled,
  state,
  onEdit,
  onCommit,
  onRevert,
  ...aria
}: {
  id: string;
  disabled: boolean;
  state: FieldState;
  onEdit(text: string): void;
  onCommit(text: string): void;
  onRevert(): void;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const query = state.draft.trim();
  const results = query === '' ? ICON_NAMES.slice(0, ICON_SEARCH_LIMIT) : searchIcons(query);
  const close = (): void => setOpen(false);
  return (
    <div
      ref={wrap}
      className="ob-prop-icon"
      onBlur={(e) => {
        if (wrap.current?.contains(e.relatedTarget as Node | null)) return;
        close();
        onRevert();
      }}
    >
      <input
        {...aria}
        id={id}
        disabled={disabled}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        value={state.draft}
        placeholder={state.mixed ? MIXED_LABEL : undefined}
        maxLength={64}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setOpen(true);
          onEdit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit((e.target as HTMLInputElement).value);
            close();
          } else if (e.key === 'Escape') {
            close();
            onRevert();
          } else if (e.key === 'ArrowDown' && open) {
            // Move into the result grid; arrows then roam it (keyboard-only operation, Req 26.3).
            const first = wrap.current?.querySelector<HTMLButtonElement>('.ob-icon-picker-grid button');
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      />
      {open && !disabled ? (
        <div id={`${id}-list`} className="ob-prop-icon-results" data-testid="icon-name-results">
          <p role="status" className="ob-prop-hint">
            {results.length === 0 ? t('No icons match') : t('{0} icons', results.length)}
          </p>
          <ul role="list" className="ob-icon-picker-grid">
            {results.map((name) => (
              <li key={name} role="listitem">
                <button
                  type="button"
                  aria-label={t('Choose icon: {0}', name)}
                  aria-pressed={name === state.committed}
                  title={name}
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    const cells = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('.ob-icon-picker-grid button') ?? []);
                    const next = nextGlyphIndex(cells.indexOf(e.currentTarget), cells.length, e.key);
                    if (next !== undefined) {
                      e.preventDefault();
                      e.stopPropagation();
                      cells[next]?.focus();
                    }
                  }}
                  onClick={() => {
                    onCommit(name);
                    close();
                  }}
                >
                  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d={ICON_PATHS[name]} />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Font family: a searchable combobox over the generic CSS families and the fonts installed on this
 * machine (fetched from the host on first focus). Each option previews in its own font. Typing
 * filters; Enter or a click commits the highlighted option, or the typed name when none is
 * highlighted (a font that is not installed, or a token reference, is still accepted). Leaving the
 * field commits typed text; Escape restores the committed value.
 */
function FontFamilyControl({
  id,
  disabled,
  state,
  onEdit,
  onCommit,
  onRevert,
  ...aria
}: {
  id: string;
  disabled: boolean;
  state: FieldState;
  onEdit(text: string): void;
  onCommit(text: string): void;
  onRevert(): void;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const installed = useInstalledFonts();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  // Until the user types, list everything so the current value does not filter the list to itself.
  const results = open ? searchFonts(installed, typed ? state.draft : '') : [];
  const listId = `${id}-list`;
  const optionId = (i: number): string => `${id}-opt-${i}`;

  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.ownerDocument.getElementById(optionId(active));
    el?.scrollIntoView?.({ block: 'nearest' });
  });

  const show = (): void => {
    requestFonts();
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
    setTyped(false);
    setActive(-1);
  };
  const choose = (name: string): void => {
    close();
    onCommit(name);
  };

  return (
    <div
      ref={wrap}
      className="ob-prop-font"
      onBlur={(e) => {
        if (wrap.current?.contains(e.relatedTarget as Node | null)) return;
        const wasTyped = typed;
        close();
        if (wasTyped) onCommit(state.draft);
      }}
    >
      <div className="ob-input-affix">
        <input
          {...aria}
          id={id}
          disabled={disabled}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && active < results.length ? optionId(active) : undefined}
          value={state.draft}
          placeholder={state.mixed ? MIXED_LABEL : undefined}
          maxLength={200}
          spellCheck={false}
          style={state.draft && !state.mixed && !state.draft.startsWith('token:') ? { fontFamily: fontPreview(state.draft) } : undefined}
          onFocus={show}
          onClick={show}
          onChange={(e) => {
            show();
            setTyped(true);
            setActive(-1);
            onEdit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              e.stopPropagation();
              if (!open) return show();
              const n = results.length;
              if (n === 0) return;
              setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : a <= 0 ? n - 1 : a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const pick = open && active >= 0 ? results[active] : undefined;
              choose(pick ?? (e.target as HTMLInputElement).value);
            } else if (e.key === 'Escape') {
              close();
              onRevert();
            }
          }}
        />
        <span className="ob-input-suffix" aria-hidden="true">
          <PanelIcon name="chevron" size={14} />
        </span>
      </div>
      {open && !disabled ? (
        <div className="ob-prop-font-popup">
          <p role="status" className="ob-prop-hint">
            {installed === undefined ? t('Loading installed fonts…') : results.length === 0 ? t('No fonts match') : t('{0} fonts', results.length)}
          </p>
          <ul ref={listRef} id={listId} role="listbox" aria-label={t('Font families')} className="ob-prop-font-list">
            {results.map((name, i) => (
              <li
                key={name}
                id={optionId(i)}
                role="option"
                aria-selected={i === active || (active < 0 && name === state.committed)}
                className={i === active ? 'is-active' : undefined}
                style={{ fontFamily: fontPreview(name) }}
                title={name}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(name)}
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // Keep the `aria-controls` target in the DOM while closed.
        <ul id={listId} role="listbox" aria-label={t('Font families')} hidden />
      )}
    </div>
  );
}

/** `#rrggbb` for a literal or token color, or undefined for the theme default / unparseable values. */
function swatchColor(value: string | undefined, tokens: TokenCollection | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  const name = tokenRefName(value);
  const literal = name !== undefined ? resolveTokens(tokens).colors.get(name) : value;
  const c = parseColor(literal);
  return c ? formatHex({ ...c, a: 1 }) : undefined;
}

/**
 * Square color swatch at the start of a color input. It shows the resolved color (a checker
 * pattern for the theme default) and opens the system color picker; the choice is committed once,
 * when the picker closes, so dragging through colors adds one undo entry.
 */
function ColorSwatch({
  label,
  value,
  tokens,
  disabled,
  onPick,
}: {
  label: string;
  value: string | undefined;
  tokens: TokenCollection | undefined;
  disabled: boolean;
  onPick(hex: string): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const hex = swatchColor(value, tokens);
  const [preview, setPreview] = useState<string | undefined>();
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => setPreview(undefined), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `change` (not React's per-input onChange) fires once when the picker is dismissed.
    const done = (): void => pick.current(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  const shown = preview ?? hex;
  return (
    <span className="ob-swatch" data-empty={shown === undefined ? 'true' : undefined} style={shown ? { background: shown } : undefined}>
      <input
        ref={ref}
        type="color"
        aria-label={label}
        title={label}
        disabled={disabled}
        value={shown ?? '#000000'}
        onInput={(e) => setPreview((e.target as HTMLInputElement).value)}
        onChange={() => undefined}
      />
    </span>
  );
}

/** Ids of sections the user collapsed; kept for the session so they stay closed across selections. */
const collapsedSections = new Set<string>();

/** A titled panel section whose body can be collapsed from its header. */
function Section({ id, title, actions, children }: { id: string; title: string; actions?: ReactNode; children: ReactNode }) {
  const titleId = useId();
  const bodyId = `${titleId}-body`;
  const [open, setOpen] = useState(() => !collapsedSections.has(id));
  return (
    <section className="ob-prop-section" data-section={id} aria-labelledby={titleId}>
      <div className="ob-prop-section-header">
        <h3 className="ob-prop-section-title">
          <button
            id={titleId}
            type="button"
            className="ob-prop-section-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => {
              const next = !open;
              if (next) collapsedSections.delete(id);
              else collapsedSections.add(id);
              setOpen(next);
            }}
          >
            <span>{title}</span>
            <PanelIcon name="chevron" size={14} />
          </button>
        </h3>
        {actions ? <div className="ob-prop-section-actions">{actions}</div> : null}
      </div>
      <div id={bodyId} className="ob-prop-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function Field({
  def,
  elements,
  readOnly,
  onUpdate,
  tokens,
  hideLabel = false,
}: {
  def: FieldDef;
  elements: readonly Element[];
  readOnly: boolean;
  onUpdate(op: UpdateOp | BatchOp): void;
  tokens?: TokenCollection;
  /** Hide the label visually (it repeats the section title); it stays the accessible name. */
  hideLabel?: boolean;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const labelId = `${id}-label`;
  const [state, dispatch] = useReducer(fieldReducer, undefined, () => initFieldStateFor(elements, def));
  const fresh = useRef(true);
  const resync = (): void => dispatch({ type: 'sync', state: initFieldStateFor(elements, def) });

  // Resync whenever the underlying element data changes (selection, patches, undo).
  useEffect(() => {
    if (fresh.current) {
      fresh.current = false;
      return;
    }
    // `def` is a static FIELDS entry; its name identifies it.
    dispatch({ type: 'sync', state: initFieldStateFor(elements, def) });
  }, [elements, def.name]);

  const commit = (text: string): void => {
    const out = commitField(state, def, text, elements);
    if (out.op) {
      dispatch({ type: 'accept', text: out.state.committed });
      onUpdate(out.op);
    } else if (out.state.error) {
      dispatch({ type: 'reject', error: out.state.error });
    }
  };

  const invalid = state.error !== undefined;
  const common = {
    id,
    disabled: readOnly,
    'aria-invalid': invalid ? (true as const) : undefined,
    'aria-describedby': invalid ? errId : undefined,
  };

  const segmented = def.kind === 'enum' && def.display === 'segmented';
  const compact = def.prefix !== undefined || def.prefixIcon !== undefined;
  const isColor = def.kind === 'tokenColor' || def.kind === 'color';

  let control;
  if (def.kind === 'boolean') {
    // A checkbox with its label beside it, like "Clip content" in the reference design.
    return (
      <div className="ob-prop ob-prop-check" data-field={def.name}>
        <input
          {...common}
          type="checkbox"
          checked={!state.mixed && state.draft === 'true'}
          ref={(el) => {
            if (el) el.indeterminate = state.mixed;
          }}
          onChange={(e) => commit(e.target.checked ? 'true' : 'false')}
        />
        <label htmlFor={id} title={def.label}>
          {def.label}
        </label>
        {invalid ? (
          <span id={errId} role="alert" className="ob-prop-error">
            {state.error}
          </span>
        ) : null}
      </div>
    );
  } else if (segmented) {
    control = (
      <IconSegmented
        label={def.label}
        labelledBy={labelId}
        values={def.values!}
        value={state.mixed ? undefined : state.draft}
        mixed={state.mixed}
        iconFor={(v) => `${def.name}:${v}`}
        disabled={readOnly}
        invalid={invalid}
        describedBy={common['aria-describedby']}
        onChange={commit}
      />
    );
  } else if (def.name === 'fontFamily') {
    control = (
      <FontFamilyControl
        {...common}
        state={state}
        onEdit={(text) => dispatch({ type: 'edit', text })}
        onCommit={commit}
        onRevert={resync}
      />
    );
  } else if (def.kind === 'enum') {
    control = (
      <Select
        id={id}
        disabled={readOnly}
        aria-invalid={common['aria-invalid']}
        aria-describedby={common['aria-describedby']}
        value={state.draft}
        mixed={state.mixed}
        mixedLabel={MIXED_LABEL}
        options={def.values!.map((v) => ({ value: v, label: v }))}
        onChange={commit}
      />
    );
  } else if (def.kind === 'icon') {
    control = (
      <IconNameControl
        {...common}
        state={state}
        onEdit={(text) => dispatch({ type: 'edit', text })}
        onCommit={commit}
        onRevert={resync}
      />
    );
  } else {
    const input = (
      <input
        {...common}
        type="text"
        inputMode={def.kind === 'number' ? 'decimal' : undefined}
        value={state.draft}
        placeholder={state.mixed ? MIXED_LABEL : undefined}
        onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          else if (e.key === 'Escape') resync();
        }}
      />
    );
    control = compact ? (
      <InputAffix prefix={def.prefix} icon={def.prefixIcon} title={def.label}>
        {input}
      </InputAffix>
    ) : isColor ? (
      <InputAffix
        leading={
          <ColorSwatch
            label={t('{0} color picker', def.label)}
            value={state.mixed ? undefined : state.draft}
            tokens={tokens}
            disabled={readOnly}
            onPick={commit}
          />
        }
      >
        {input}
      </InputAffix>
    ) : (
      input
    );
  }

  return (
    <div className={`ob-prop${compact ? ' ob-prop-compact' : ''}`} data-field={def.name}>
      {segmented ? (
        <span id={labelId} className="ob-prop-label" title={def.label}>
          {def.label}
        </span>
      ) : (
        <label htmlFor={id} title={def.label} className={compact || hideLabel ? 'ob-sr-only' : undefined}>
          {def.label}
        </label>
      )}
      {control}
      {segmented && state.mixed ? <span className="ob-prop-hint">{MIXED_LABEL}</span> : null}
      {tokenCategoryOf(def) ? <TokenControls def={def} elements={elements} tokens={tokens} readOnly={readOnly} onUpdate={onUpdate} /> : null}
      {invalid ? (
        <span id={errId} role="alert" className="ob-prop-error">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

function CornerInput({ slot, elements, readOnly, onUpdate }: { slot: CornerSlot; elements: readonly Element[]; readOnly: boolean; onUpdate(op: UpdateOp): void }) {
  const id = useId();
  const errId = `${id}-err`;
  const [state, dispatch] = useReducer(fieldReducer, undefined, () => initCornerState(elements, slot));
  const fresh = useRef(true);

  useEffect(() => {
    if (fresh.current) {
      fresh.current = false;
      return;
    }
    dispatch({ type: 'sync', state: initCornerState(elements, slot) });
  }, [elements, slot]);

  const commit = (text: string): void => {
    const out = commitCorner(state, slot, text, elements);
    if (out.op) {
      dispatch({ type: 'accept', text: out.state.committed });
      onUpdate(out.op);
    } else if (out.state.error) {
      dispatch({ type: 'reject', error: out.state.error });
    }
  };

  const invalid = state.error !== undefined;
  return (
    <div className="ob-prop ob-prop-compact ob-prop-corner" data-corner={String(slot)}>
      <label htmlFor={id} className="ob-sr-only">
        {cornerLabel(slot)}
      </label>
      <InputAffix icon={slot === 'linked' ? 'cornerAll' : `corner${slot}`} title={cornerLabel(slot)}>
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
            else if (e.key === 'Escape') dispatch({ type: 'sync', state: initCornerState(elements, slot) });
          }}
        />
      </InputAffix>
      {invalid ? (
        <span id={errId} role="alert" className="ob-prop-error">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

/** CORNER_SLOTS (tuple order TL, TR, BR, BL) rearranged so a 2-column grid mirrors the box. */
const CORNER_GRID_ORDER: readonly CornerSlot[] = [CORNER_SLOTS[0]!, CORNER_SLOTS[1]!, CORNER_SLOTS[3]!, CORNER_SLOTS[2]!];

/** Four corner fields (TL, TR, BR, BL) plus one linked field that sets all corners (Req 6.11, 6.12). */
function CornersField({ def, elements, readOnly, onUpdate }: { def: FieldDef; elements: readonly Element[]; readOnly: boolean; onUpdate(op: UpdateOp): void }) {
  return (
    <fieldset className="ob-prop ob-prop-corners" data-field={def.name}>
      <legend>{def.label}</legend>
      <CornerInput slot="linked" elements={elements} readOnly={readOnly} onUpdate={onUpdate} />
      {/* 2x2 grid laid out like the corners themselves: top-left, top-right / bottom-left, bottom-right. */}
      <div className="ob-prop-grid">
        {CORNER_GRID_ORDER.map((slot) => (
          <CornerInput key={slot} slot={slot} elements={elements} readOnly={readOnly} onUpdate={onUpdate} />
        ))}
      </div>
    </fieldset>
  );
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

function firstImageFile(dt: DataTransfer | null): File | undefined {
  if (!dt) return undefined;
  const files = Array.from(dt.files ?? []);
  return files.find((f) => f.type.startsWith('image/')) ?? files[0];
}

/** Image fill: choose / drop / paste an image, pick the fit mode, or remove the fill (Req 9.6, 9.7, 9.12). */
function ImageFillField({
  def,
  elements,
  readOnly,
  onUpdate,
  onImageFill,
}: {
  def: FieldDef;
  elements: readonly Element[];
  readOnly: boolean;
  onUpdate(op: UpdateOp): void;
  onImageFill?: (file: File, ids: string[]) => Promise<string | undefined>;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>();
  const summary = summarizeImageFill(elements);
  const ids = elements.map((e) => e.id);

  const apply = async (file: File | undefined): Promise<void> => {
    if (!file || !onImageFill) return;
    setError(await onImageFill(file, ids));
  };

  const readClipboard = async (): Promise<void> => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((ty) => ty.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          return apply(new File([blob], '', { type }));
        }
      }
      setError(t('The clipboard does not contain an image.'));
    } catch {
      setError(t('The clipboard could not be read.'));
    }
  };

  const changeFit = (fit: string): void => {
    const r = buildFitCommit(elements, fit);
    if (r.ok) {
      setError(undefined);
      onUpdate(r.op);
    } else setError(r.error);
  };

  const fitValue = summary.fit ?? '';
  return (
    <fieldset
      className="ob-prop ob-prop-image-fill"
      data-field={def.name}
      aria-describedby={error ? errId : undefined}
      onDragOver={(e) => {
        if (!readOnly) e.preventDefault();
      }}
      onDrop={(e) => {
        if (readOnly) return;
        e.preventDefault();
        void apply(firstImageFile(e.dataTransfer));
      }}
      onPaste={(e) => {
        if (readOnly) return;
        const f = firstImageFile(e.clipboardData);
        if (f) {
          e.preventDefault();
          void apply(f);
        }
      }}
    >
      <legend>{def.label}</legend>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        aria-label={t('Choose fill image')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void apply(f);
        }}
      />
      <div className="ob-prop-image-fill-actions">
        <button type="button" disabled={readOnly} onClick={() => inputRef.current?.click()}>
          {t('Choose image')}
        </button>
        <button type="button" disabled={readOnly} onClick={() => void readClipboard()}>
          {t('Paste image')}
        </button>
        <button
          type="button"
          disabled={readOnly || !summary.has}
          onClick={() => {
            setError(undefined);
            onUpdate(buildRemoveImageFill(elements));
          }}
        >
          {t('Remove image fill')}
        </button>
      </div>
      <p className="ob-prop-hint">{t('Drop or paste an image here')}</p>
      <div className="ob-prop">
        <label htmlFor={id}>{t('Fit mode')}</label>
        <Select
          id={id}
          disabled={readOnly || !summary.has}
          value={fitValue}
          mixed={summary.mixed && summary.has}
          mixedLabel={MIXED_LABEL}
          options={IMAGE_FILL_FITS.map((v) => ({ value: v, label: v }))}
          onChange={changeFit}
        />
      </div>
      {error ? (
        <span id={errId} role="alert" className="ob-prop-error">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

/** Override indicator for one property, with a reset action for that property (Req 14.8, 14.9). */
function OverrideBadge({ property, onReset, readOnly }: { property: string; onReset(): void; readOnly: boolean }) {
  return (
    <span className="ob-prop-override" data-override={property}>
      <span role="status">{t('Overridden')}</span>
      <button type="button" disabled={readOnly} aria-label={t('Reset override: {0}', property)} onClick={onReset}>
        {t('Reset')}
      </button>
    </span>
  );
}

/**
 * Component controls for a single selected master, instance or Instance_Child (Req 13.5, 14.9,
 * 14.11, 14.18, 14.19, 26.9): name, Detach Instance, Reset Overrides, Go to master, the list of
 * overridden properties, and the "master missing" indication.
 */
function ComponentSection({
  ctx,
  elementId,
  allElements,
  readOnly,
  onComponentOp,
  onGoToMaster,
}: {
  ctx: ComponentContext;
  elementId: string;
  allElements: readonly Element[];
  readOnly: boolean;
  onComponentOp?: (op: ComponentOp) => void;
  onGoToMaster?: (id: string) => void;
}) {
  const nameId = useId();
  const errId = `${nameId}-err`;
  const committed = ctx.kind === 'master' ? ctx.master.component ?? '' : '';
  const [draft, setDraft] = useState(committed);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    setDraft(committed);
    setError(undefined);
  }, [committed, elementId]);

  const commitName = (): void => {
    if (ctx.kind !== 'master' || !onComponentOp) return;
    if (draft === committed) return setError(undefined);
    const r = buildRenameOp(ctx.master, draft, allElements);
    if (r.ok) {
      setError(undefined);
      onComponentOp(r.op);
    } else {
      setError(r.error);
      setDraft(committed);
    }
  };

  const target = goToMasterTarget(ctx);
  const overridden = [...overriddenProperties(ctx)];
  const reset = ctx.kind === 'master' ? undefined : buildResetOverridesOp(ctx, elementId);
  return (
    <section className="ob-prop-component" aria-label={t('Component')} data-component-role={ctx.kind}>
      <h3 className="ob-prop-component-title">{t('Component')}</h3>
      {ctx.kind === 'master' ? (
        <div className="ob-prop" data-field="component">
          <label htmlFor={nameId}>{t('Component name')}</label>
          <input
            id={nameId}
            type="text"
            disabled={readOnly}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              else if (e.key === 'Escape') {
                setDraft(committed);
                setError(undefined);
              }
            }}
          />
          {error ? (
            <span id={errId} role="alert" className="ob-prop-error">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
      {isMasterMissing(ctx) ? (
        <p className="ob-prop-master-missing" role="status">
          {t('Master missing: this instance has no component master')}
        </p>
      ) : null}
      {overridden.length > 0 ? (
        <p className="ob-prop-hint" data-testid="override-list">
          {t('Overrides: {0}', overridden.join(', '))}
        </p>
      ) : null}
      <div className="ob-prop-component-actions">
        {ctx.kind === 'instance' ? (
          <button type="button" disabled={readOnly || !onComponentOp} onClick={() => onComponentOp?.(buildDetachInstanceOp(ctx.instance))}>
            {t('Detach Instance')}
          </button>
        ) : null}
        {reset ? (
          <button type="button" disabled={readOnly || !onComponentOp || !hasOverrides(ctx)} onClick={() => onComponentOp?.(reset)}>
            {t('Reset Overrides')}
          </button>
        ) : null}
        {ctx.kind !== 'instance-child' ? (
          <button type="button" disabled={target === undefined || !onGoToMaster} onClick={() => target !== undefined && onGoToMaster?.(target)}>
            {t('Go to master')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function PropertiesPanelView({
  elements,
  readOnly = false,
  onUpdate,
  onImageFill,
  tokens,
  allElements,
  onComponentOp,
  onGoToMaster,
  onOp,
}: PropertiesPanelViewProps) {
  const fields = fieldsFor(elements);
  // Layout and sizing ops may be a batch; without `onOp`, plain updates fall back to `onUpdate`.
  const sendOp = (op: PanelOp): void => {
    if (onOp) onOp(op);
    else if (op.tool === 'openboard.element.update') onUpdate(op as UpdateOp);
  };
  const componentCtx = componentContext(elements, allElements ?? elements);
  const overridden = overriddenProperties(componentCtx);
  const resetProperty = (property: string): void => {
    const op = componentCtx && elements[0] ? buildResetOverridesOp(componentCtx, elements[0].id, property) : undefined;
    if (op) onComponentOp?.(op);
  };
  const badge = (name: string) =>
    overridden.has(name) ? <OverrideBadge property={name} readOnly={readOnly || !onComponentOp} onReset={() => resetProperty(name)} /> : null;
  // Re-mount fields when the selected id set changes so state never leaks between selections.
  const key = elements.map((e) => e.id).join('|');
  const all = allElements ?? elements;
  const showSizing = sizingApplies(elements);
  const showIgnore = ignoreLayoutApplies(elements, all);
  const sections = fieldSections(fields, new Set(showSizing || showIgnore ? ['dimensions'] : []));

  const renderRow = (row: FieldDef[], sectionTitle: string) => (
    <div key={row.map((f) => f.name).join('|')} className="ob-prop-row" data-cols={row.length}>
      {row.map((f) =>
        f.kind === 'corners' ? (
          <CornersField key={f.name} def={f} elements={elements} readOnly={readOnly} onUpdate={onUpdate} />
        ) : f.kind === 'imageFill' ? (
          <div key={f.name} className="ob-prop-cell">
            <ImageFillField def={f} elements={elements} readOnly={readOnly} onUpdate={onUpdate} onImageFill={onImageFill} />
            {badge(f.name)}
          </div>
        ) : (
          <div key={f.name} className="ob-prop-cell">
            <Field def={f} elements={elements} readOnly={readOnly} onUpdate={sendOp} tokens={tokens} hideLabel={f.label === sectionTitle} />
            {badge(f.name)}
          </div>
        ),
      )}
    </div>
  );

  return (
    <aside className="ob-properties" aria-label="Properties">
      <h2 className="ob-properties-title">
        Properties
        {elements.length > 0 ? <span className="ob-properties-subtitle">{selectionSummary(elements)}</span> : null}
      </h2>
      {componentCtx && elements[0] ? (
        <ComponentSection
          key={key}
          ctx={componentCtx}
          elementId={elements[0].id}
          allElements={allElements ?? elements}
          readOnly={readOnly}
          onComponentOp={onComponentOp}
          onGoToMaster={onGoToMaster}
        />
      ) : null}
      {fields.length === 0 ? (
        <p className="ob-properties-empty">Select an element to edit its properties.</p>
      ) : (
        <form key={key} onSubmit={(e) => e.preventDefault()}>
          {sections.map((sec) => (
            <Fragment key={sec.id}>
              <Section id={sec.id} title={sec.title}>
                {sec.rows.map((row) => renderRow(row, sec.title))}
                {sec.id === 'dimensions' && showSizing ? <SizingSection elements={elements} readOnly={readOnly} onOp={sendOp} /> : null}
                {sec.id === 'dimensions' && showIgnore ? <IgnoreLayoutSection elements={elements} readOnly={readOnly} onOp={sendOp} /> : null}
              </Section>
              {/* Auto Layout follows Dimensions, as in the reference design. */}
              {sec.id === 'dimensions' && layoutApplies(elements) ? (
                <Section id="layout" title={t('Auto Layout')}>
                  <LayoutSection frames={elements} readOnly={readOnly} onOp={sendOp} tokens={tokens} />
                </Section>
              ) : null}
            </Fragment>
          ))}
        </form>
      )}
    </aside>
  );
}
