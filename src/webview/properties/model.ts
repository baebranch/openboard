/**
 * Pure logic for the Properties_Panel (Req 6.6-6.9, 8.5, 9.7, 9.8): field definitions,
 * parse/validate/commit state machine and update-op construction. No React here.
 */
import { EDGE_LABEL_MAX, MOCKUP_FIELD_SPECS, type Element, type ElementType } from '../../core/model';
import { PROPERTY_DESCRIPTORS } from '../../core/properties/descriptors';
import { summarizeProperty } from '../../core/properties/mixed';
import { validateProperty } from '../../core/properties/validate';
import {
  DETACH_FALLBACK,
  makeTokenRef,
  resolveTokens,
  tokenRefName,
  type TokenCategory,
  type TokenCollection,
} from '../../core/tokens';

import { t } from '../i18n/t';

/** `tokenColor` and `tokenFont` are color / font fields that can also hold a Token_Reference (Req 11.12). */
export type FieldKind = 'number' | 'enum' | 'color' | 'text' | 'corners' | 'imageFill' | 'boolean' | 'tokenColor' | 'tokenFont' | 'icon';

export interface FieldDef {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly values?: readonly string[];
  readonly maxLength?: number;
  readonly appliesTo?: readonly ElementType[];
  /** Min length for text fields. */
  readonly minLength?: number;
  /**
   * Value shown when the element does not store the property (optional fields such as `textWrap`
   * or `fontWeight`), so a control never looks empty while the renderer uses a default.
   */
  readonly defaultValue?: string;
  /** Short prefix drawn inside a compact input (`X`, `W`, ...); the full label stays the accessible name. */
  readonly prefix?: string;
  /** Icon drawn inside a compact input instead of a text prefix. */
  readonly prefixIcon?: string;
  /** Render an enum as a row of icon buttons instead of a dropdown. */
  readonly display?: 'segmented';
}

const TEXT_TYPES: readonly ElementType[] = ['text', 'sticky', 'flowNode'];
const ARROWS = ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar'] as const;

const FONT_WEIGHT_VALUES: readonly string[] = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];

const TEXT_WRAP_VALUES: readonly string[] = ['none', 'wrap'];

/** Extra (non-descriptor) properties handled by this module. */
const EXTRA_VALIDATORS: Readonly<Record<string, (v: unknown) => string | undefined>> = {
  fontWeight: (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0
      ? undefined
      : t('Font weight must be an integer from 100 to 900 in steps of 100'),
  textWrap: (v) => (v === 'none' || v === 'wrap' ? undefined : t('Text wrap must be none or wrap')),
  clipContent: (v) => (typeof v === 'boolean' ? undefined : t('Clip content must be true or false')),
  name: (v) => (typeof v === 'string' && v.length >= 1 && v.length <= 64 ? undefined : t('Icon name must be 1 to 64 characters')),
  fontFamily: (v) => (typeof v === 'string' && v.trim().length > 0 && v.length <= 200 ? undefined : t('Font family must be 1 to 200 characters')),
  routing: (v) => (v === 'straight' || v === 'curved' || v === 'orthogonal' ? undefined : 'Routing must be straight, curved or orthogonal'),
  sourceArrow: (v) => (typeof v === 'string' && (ARROWS as readonly string[]).includes(v) ? undefined : 'Invalid arrowhead'),
  targetArrow: (v) => (typeof v === 'string' && (ARROWS as readonly string[]).includes(v) ? undefined : 'Invalid arrowhead'),
  label: (v) => (typeof v === 'string' && v.length <= EDGE_LABEL_MAX ? undefined : `Label must be at most ${EDGE_LABEL_MAX} characters`),
};

export const FIELDS: readonly FieldDef[] = [
  { name: 'x', label: 'X', kind: 'number', prefix: 'X' },
  { name: 'y', label: 'Y', kind: 'number', prefix: 'Y' },
  { name: 'width', label: 'Width', kind: 'number', prefix: 'W' },
  { name: 'height', label: 'Height', kind: 'number', prefix: 'H' },
  { name: 'rotation', label: 'Rotation', kind: 'number', prefixIcon: 'rotation' },
  { name: 'fill', label: 'Fill', kind: 'tokenColor' },
  { name: 'stroke', label: 'Stroke', kind: 'tokenColor' },
  { name: 'strokeWidth', label: 'Stroke width', kind: 'number', prefixIcon: 'strokeWidth' },
  {
    name: 'strokeStyle',
    label: 'Stroke style',
    kind: 'enum',
    values: PROPERTY_DESCRIPTORS['strokeStyle']!.values,
    display: 'segmented',
    defaultValue: 'solid',
  },
  { name: 'opacity', label: 'Opacity', kind: 'number', prefixIcon: 'opacity' },
  {
    name: 'cornerRadius',
    label: 'Corner radius',
    kind: 'number',
    appliesTo: PROPERTY_DESCRIPTORS['cornerRadius']!.appliesTo,
    prefixIcon: 'cornerRadius',
  },
  { name: 'cornerRadii', label: t('Corner radii'), kind: 'corners', appliesTo: PROPERTY_DESCRIPTORS['cornerRadii']!.appliesTo },
  { name: 'imageFill', label: t('Image fill'), kind: 'imageFill', appliesTo: MOCKUP_FIELD_SPECS.find((s) => s.name === 'imageFill')!.appliesTo },
  { name: 'clipContent', label: t('Clip content'), kind: 'boolean', appliesTo: ['frame'] },
  { name: 'name', label: t('Icon name'), kind: 'icon', appliesTo: ['icon'], minLength: 1, maxLength: 64 },
  { name: 'fontFamily', label: t('Font family'), kind: 'tokenFont', appliesTo: TEXT_TYPES, maxLength: 200 },
  { name: 'fontSize', label: 'Font size', kind: 'number', appliesTo: TEXT_TYPES, prefixIcon: 'fontSize' },
  { name: 'fontWeight', label: t('Font weight'), kind: 'enum', values: FONT_WEIGHT_VALUES, appliesTo: TEXT_TYPES, defaultValue: '400' },
  { name: 'textColor', label: t('Text color'), kind: 'tokenColor', appliesTo: PROPERTY_DESCRIPTORS['textColor']!.appliesTo },
  {
    name: 'textWrap',
    label: t('Text wrap'),
    kind: 'enum',
    values: TEXT_WRAP_VALUES,
    appliesTo: TEXT_TYPES,
    display: 'segmented',
    defaultValue: 'none',
  },
  {
    name: 'align',
    label: 'Text alignment',
    kind: 'enum',
    values: PROPERTY_DESCRIPTORS['align']!.values,
    appliesTo: TEXT_TYPES,
    display: 'segmented',
    defaultValue: 'left',
  },
  { name: 'baseWidth', label: 'Brush width', kind: 'number', appliesTo: ['freehand'], prefixIcon: 'strokeWidth' },
  {
    name: 'routing',
    label: 'Routing',
    kind: 'enum',
    values: ['straight', 'curved', 'orthogonal'],
    appliesTo: ['edge'],
    display: 'segmented',
    defaultValue: 'straight',
  },
  { name: 'sourceArrow', label: 'Source arrowhead', kind: 'enum', values: ARROWS, appliesTo: ['edge'] },
  { name: 'targetArrow', label: 'Target arrowhead', kind: 'enum', values: ARROWS, appliesTo: ['edge'] },
  { name: 'label', label: 'Label', kind: 'text', appliesTo: ['edge'], maxLength: EDGE_LABEL_MAX },
];

/** A titled, collapsible group of field rows in the panel. */
export interface FieldSectionSpec {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly (readonly string[])[];
}

/**
 * Panel sections, top to bottom. Short inputs share a row (X | Y, W | H, ...); long or free-text
 * inputs (font family, edge label) and icon rows get a row of their own. The Dimensions section also
 * hosts the sizing control, and Auto Layout follows it (both rendered by the view).
 */
export const FIELD_SECTIONS: readonly FieldSectionSpec[] = [
  { id: 'position', title: t('Position'), rows: [['x', 'y'], ['rotation']] },
  { id: 'dimensions', title: t('Dimensions'), rows: [['width', 'height']] },
  { id: 'appearance', title: t('Appearance'), rows: [['opacity', 'cornerRadius'], ['cornerRadii'], ['clipContent']] },
  { id: 'text', title: t('Text'), rows: [['fontFamily'], ['fontSize', 'fontWeight'], ['textColor'], ['align', 'textWrap']] },
  { id: 'fill', title: t('Fill'), rows: [['fill'], ['imageFill']] },
  { id: 'stroke', title: t('Stroke'), rows: [['stroke'], ['strokeWidth', 'baseWidth'], ['strokeStyle']] },
  { id: 'icon', title: t('Icon'), rows: [['name']] },
  { id: 'connector', title: t('Connector'), rows: [['routing'], ['sourceArrow', 'targetArrow'], ['label']] },
];

/** Every section row in display order (kept for callers that only need rows). */
export const FIELD_ROWS: readonly (readonly string[])[] = FIELD_SECTIONS.flatMap((s) => s.rows);

export interface FieldSection {
  id: string;
  title: string;
  rows: FieldDef[][];
}

/**
 * Groups the applicable fields into sections of display rows. Missing fields are dropped, so a row
 * whose partner does not apply holds a single full-width field, and a section with no applicable
 * field is omitted. Fields no section lists go to a trailing "Other" section, in FIELDS order.
 * `keep` lists section ids shown even when empty (the view adds its own controls to them).
 */
export function fieldSections(fields: readonly FieldDef[], keep: ReadonlySet<string> = new Set()): FieldSection[] {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const placed = new Set<string>();
  const out: FieldSection[] = [];
  for (const spec of FIELD_SECTIONS) {
    const rows: FieldDef[][] = [];
    for (const row of spec.rows) {
      const present = row.map((n) => byName.get(n)).filter((f): f is FieldDef => f !== undefined);
      present.forEach((f) => placed.add(f.name));
      if (present.length > 0) rows.push(present);
    }
    if (rows.length > 0 || keep.has(spec.id)) out.push({ id: spec.id, title: spec.title, rows });
  }
  const rest = fields.filter((f) => !placed.has(f.name)).map((f) => [f]);
  if (rest.length > 0) out.push({ id: 'other', title: t('Other'), rows: rest });
  return out;
}

/** The section rows flattened, in display order. */
export function fieldRows(fields: readonly FieldDef[]): FieldDef[][] {
  return fieldSections(fields).flatMap((s) => s.rows);
}

/** Fields that apply to every selected element (empty selection yields none). */
export function fieldsFor(elements: readonly Pick<Element, 'type'>[]): FieldDef[] {
  if (elements.length === 0) return [];
  return FIELDS.filter((f) => !f.appliesTo || elements.every((e) => f.appliesTo!.includes(e.type)));
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export type ParseResult = { ok: true; value: number | string | boolean } | { ok: false; error: string };

/** Parse raw field text to a typed value (no range checks). */
export function parseInput(def: FieldDef, raw: string): ParseResult {
  if (def.kind === 'number') {
    const t = raw.trim();
    if (!NUMBER_RE.test(t)) return { ok: false, error: `${def.label} must be a number` };
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a finite number` };
    return { ok: true, value: n };
  }
  if (def.name === 'fontWeight') {
    // Strict: digits only, so empty, fractional or signed text is rejected (Req 7.7).
    return { ok: true, value: /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN };
  }
  if (def.kind === 'boolean') {
    const s = raw.trim();
    return { ok: true, value: s === 'true' ? true : s === 'false' ? false : s };
  }
  if (def.kind === 'color' || def.kind === 'tokenColor') return { ok: true, value: raw.trim() };
  return { ok: true, value: raw };
}

export type CommitResult =
  | { ok: true; value: number | string | boolean }
  | { ok: false; error: string };

/** Parse and validate `raw` against every selected element; the first failure rejects the commit. */
export function commitValue(def: FieldDef, raw: string, elements: readonly Element[]): CommitResult {
  const parsed = parseInput(def, raw);
  if (!parsed.ok) return parsed;
  let result: number | string | boolean = parsed.value;
  if (def.name in EXTRA_VALIDATORS) {
    const err = EXTRA_VALIDATORS[def.name]!(parsed.value);
    return err ? { ok: false, error: err } : { ok: true, value: parsed.value };
  }
  for (const el of elements) {
    const r = validateProperty(el.type, def.name, parsed.value, { width: el.width, height: el.height });
    if (!r.ok) return { ok: false, error: r.error };
    result = r.value;
  }
  return { ok: true, value: result };
}

export interface UpdateOp {
  tool: 'openboard.element.update';
  input: { ids: string[]; set: Record<string, unknown> };
}

export function buildUpdateOp(ids: readonly string[], set: Record<string, unknown>): UpdateOp {
  return { tool: 'openboard.element.update', input: { ids: [...ids], set } };
}

// --- field state machine ---------------------------------------------------------------------

export interface FieldState {
  /** Text currently shown in the control. */
  draft: string;
  /** Last accepted value text; restored on rejection. */
  committed: string;
  error?: string;
  mixed: boolean;
}

export const MIXED_LABEL = 'Mixed';

export function displayText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Initial field state from the current selection. `fallback` is shown when no selected element
 * stores the property (an optional field the renderer defaults, such as `textWrap: 'none'`).
 */
export function initFieldState(elements: readonly Element[], name: string, fallback?: string): FieldState {
  const s = summarizeProperty(elements, name);
  const stored = s.mixed ? '' : displayText(s.value);
  const text = !s.mixed && stored === '' && fallback !== undefined ? fallback : stored;
  return { draft: text, committed: text, mixed: s.mixed };
}

/** `initFieldState` for a field definition, applying its default value. */
export function initFieldStateFor(elements: readonly Element[], def: Pick<FieldDef, 'name' | 'defaultValue'>): FieldState {
  return initFieldState(elements, def.name, elements.length > 0 ? def.defaultValue : undefined);
}

export type FieldEvent =
  | { type: 'edit'; text: string }
  | { type: 'accept'; text: string }
  | { type: 'reject'; error: string }
  /** External data changed (selection / document); clears errors and resyncs. */
  | { type: 'sync'; state: FieldState };

export function fieldReducer(state: FieldState, ev: FieldEvent): FieldState {
  switch (ev.type) {
    case 'edit':
      return { ...state, draft: ev.text, error: undefined };
    case 'accept':
      return { draft: ev.text, committed: ev.text, mixed: false };
    case 'reject':
      return { ...state, draft: state.committed, error: ev.error };
    case 'sync':
      return ev.state;
  }
}

export interface CommitOutcome {
  state: FieldState;
  /** Op to dispatch when accepted. */
  op?: UpdateOp | BatchOp;
}

/** One `openboard.batch` of updates, i.e. one Undo_History entry. */
export interface BatchOp {
  tool: 'openboard.batch';
  input: { operations: UpdateOp[] };
}

/** Run a commit attempt for a field: validate, then either accept (with op) or reject retaining the previous value. */
export function commitField(
  state: FieldState,
  def: FieldDef,
  text: string,
  elements: readonly Element[],
): CommitOutcome {
  // Untouched mixed field: nothing to commit.
  if (state.mixed && text === state.draft && text === '') return { state };
  if (!state.mixed && text === state.committed && state.error === undefined) return { state };
  const r = commitValue(def, text, elements);
  if (!r.ok) return { state: fieldReducer(state, { type: 'reject', error: r.error }) };
  const ids = elements.map((e) => e.id);
  const accepted = fieldReducer(state, { type: 'accept', text: displayText(r.value) });
  // Req 20.10: a size typed on a `hug` axis switches that axis to `fixed` in the same op (one undo entry).
  if ((def.name === 'width' || def.name === 'height') && elements.some((e) => e.sizing?.[def.name as 'width' | 'height'] === 'hug')) {
    const axis = def.name as 'width' | 'height';
    const ops: UpdateOp[] = elements.map((e) =>
      e.sizing?.[axis] === 'hug'
        ? buildUpdateOp([e.id], { [axis]: r.value, sizing: { width: e.sizing.width, height: e.sizing.height, [axis]: 'fixed' } })
        : buildUpdateOp([e.id], { [axis]: r.value }),
    );
    return { state: accepted, op: ops.length === 1 ? ops[0]! : { tool: 'openboard.batch', input: { operations: ops } } };
  }
  return { state: accepted, op: buildUpdateOp(ids, { [def.name]: r.value }) };
}

// --- corner radii (Req 6.11, 6.12, 26.x) -----------------------------------------------------

/** A corner sub-field: index 0..3 in top-left, top-right, bottom-right, bottom-left order, or the linked field. */
export type CornerSlot = 0 | 1 | 2 | 3 | 'linked';

/** Display order of the four corner fields (matches the `cornerRadii` tuple order). */
export const CORNER_SLOTS: readonly (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];

/** Localised label of a corner slot. */
export function cornerLabel(slot: CornerSlot): string {
  switch (slot) {
    case 0:
      return t('Top-left');
    case 1:
      return t('Top-right');
    case 2:
      return t('Bottom-right');
    case 3:
      return t('Bottom-left');
    case 'linked':
      return t('All corners');
  }
}

type Radii = readonly [number, number, number, number];

/** Effective four radii of an element: `cornerRadii` when present, else `cornerRadius` repeated (or 0). */
export function effectiveRadii(el: Element): Radii {
  const style = el.style as { cornerRadii?: Radii; cornerRadius?: number };
  if (style.cornerRadii) return style.cornerRadii;
  const r = typeof style.cornerRadius === 'number' ? style.cornerRadius : 0;
  return [r, r, r, r];
}

/** Initial state of a corner sub-field; differing selections show as mixed. */
export function initCornerState(elements: readonly Element[], slot: CornerSlot): FieldState {
  const values = elements.map((e) => {
    const r = effectiveRadii(e);
    if (slot === 'linked') return r.every((v) => v === r[0]) ? r[0] : undefined;
    return r[slot];
  });
  const first = values[0];
  if (values.length === 0 || first === undefined || values.some((v) => v !== first)) {
    return { draft: '', committed: '', mixed: values.length > 0 };
  }
  const text = displayText(first);
  return { draft: text, committed: text, mixed: false };
}

const CORNER_RADIUS_DEF: FieldDef = { name: 'cornerRadius', label: 'Corner radius', kind: 'number' };

export type CornerCommit = { ok: true; op: UpdateOp } | { ok: false; error: string };

/**
 * Build the op for committing `raw` into a corner slot. Linked: sets `cornerRadius` and removes `cornerRadii`
 * (`null` clears it). Single corner: creates `cornerRadii` from the current radius (or 0) or changes only that
 * corner. Both are one `element.update` call, i.e. one Undo_History entry, validated by the Agent_Tool rules.
 */
export function buildCornerCommit(elements: readonly Element[], slot: CornerSlot, raw: string): CornerCommit {
  const ids = elements.map((e) => e.id);
  if (slot === 'linked') {
    const r = commitValue(CORNER_RADIUS_DEF, raw, elements);
    if (!r.ok) return r;
    return { ok: true, op: buildUpdateOp(ids, { cornerRadius: r.value, cornerRadii: null }) };
  }
  const parsed = parseInput({ ...CORNER_RADIUS_DEF, label: cornerLabel(slot) }, raw);
  if (!parsed.ok) return parsed;
  const next = elements.map((el) => {
    const arr = [...effectiveRadii(el)];
    arr[slot] = parsed.value as number;
    return arr;
  });
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    const v = validateProperty(el.type, 'cornerRadii', next[i], { width: el.width, height: el.height });
    if (!v.ok) return { ok: false, error: v.error };
  }
  const key = JSON.stringify(next[0]);
  if (next.some((a) => JSON.stringify(a) !== key)) {
    return { ok: false, error: t('Selected elements have different corners; select them one at a time to edit a single corner') };
  }
  return { ok: true, op: buildUpdateOp(ids, { cornerRadii: next[0] }) };
}

/** Commit attempt for a corner sub-field; rejection retains the previous value and flags an error. */
export function commitCorner(
  state: FieldState,
  slot: CornerSlot,
  text: string,
  elements: readonly Element[],
): CommitOutcome & { op?: UpdateOp } {
  if (state.mixed && text === state.draft && text === '') return { state };
  if (!state.mixed && text === state.committed && state.error === undefined) return { state };
  const r = buildCornerCommit(elements, slot, text);
  if (!r.ok) return { state: fieldReducer(state, { type: 'reject', error: r.error }) };
  return { state: fieldReducer(state, { type: 'accept', text: text.trim() }), op: r.op };
}

// --- image fill (Req 9.6, 9.7, 9.12, 26.x) ---------------------------------------------------

export const IMAGE_FILL_FITS = ['cover', 'contain', 'stretch'] as const;
export type ImageFillFit = (typeof IMAGE_FILL_FITS)[number];

type ImageFill = { assetId: string; fit: ImageFillFit };

const imageFillOf = (el: Element): ImageFill | undefined => (el.style as { imageFill?: ImageFill }).imageFill;

export interface ImageFillSummary {
  /** At least one selected element has an image fill. */
  has: boolean;
  /** Fit mode shared by every selected element; undefined when mixed or none. */
  fit?: ImageFillFit;
  /** Selected elements disagree (some without a fill, or different fit/asset). */
  mixed: boolean;
}

export function summarizeImageFill(elements: readonly Element[]): ImageFillSummary {
  const fills = elements.map(imageFillOf);
  const has = fills.some((f) => f !== undefined);
  const first = fills[0];
  const mixed = fills.some((f) => f?.fit !== first?.fit || f?.assetId !== first?.assetId);
  return { has, mixed, ...(!mixed && first ? { fit: first.fit } : {}) };
}

export type ImageFillCommit = { ok: true; op: UpdateOp } | { ok: false; error: string };

/** Op that changes the fit mode of existing image fills; elements without a fill reject the commit. */
export function buildFitCommit(elements: readonly Element[], fit: string): ImageFillCommit {
  if (!(IMAGE_FILL_FITS as readonly string[]).includes(fit)) {
    return { ok: false, error: t('Fit must be cover, contain or stretch') };
  }
  const fills = elements.map(imageFillOf);
  if (fills.length === 0 || fills.some((f) => f === undefined)) {
    return { ok: false, error: t('Add an image fill before choosing a fit mode') };
  }
  const asset = fills[0]!.assetId;
  if (fills.some((f) => f!.assetId !== asset)) {
    return { ok: false, error: t('Selected elements have different images; select them one at a time to change the fit mode') };
  }
  return { ok: true, op: buildUpdateOp(elements.map((e) => e.id), { imageFill: { assetId: asset, fit } }) };
}

/** Op that deletes `imageFill` from every selected element (one Undo_History entry). */
export function buildRemoveImageFill(elements: readonly Element[]): UpdateOp {
  return buildUpdateOp(elements.map((e) => e.id), { imageFill: null });
}

// --- design tokens (Req 11.9, 11.12, 11.17, 26.1, 26.6) --------------------------------------

/** Token category a field draws from, or undefined when the field cannot hold a Token_Reference. */
export function tokenCategoryOf(def: FieldDef): TokenCategory | undefined {
  return def.kind === 'tokenColor' ? 'colors' : def.kind === 'tokenFont' ? 'fonts' : undefined;
}

/** Names of the tokens a field can reference, sorted. */
export function tokenNames(tokens: TokenCollection | undefined, category: TokenCategory): string[] {
  return Object.keys(tokens?.[category] ?? {}).sort();
}

export interface TokenFieldSummary {
  /** Token name referenced by every selected element; undefined when none or when they differ. */
  name?: string;
  /** At least one selected element holds a Token_Reference in this field. */
  hasRef: boolean;
  /** Selected elements disagree about the referenced token. */
  mixed: boolean;
  /** `name` is set but the token does not exist in the category (Req 11.9). */
  missing: boolean;
}

export function summarizeTokenField(elements: readonly Element[], def: FieldDef, tokens: TokenCollection | undefined): TokenFieldSummary {
  const category = tokenCategoryOf(def);
  if (!category) return { hasRef: false, mixed: false, missing: false };
  const refs = elements.map((e) => tokenRefName(summarizeProperty([e], def.name).value));
  const hasRef = refs.some((r) => r !== undefined);
  const first = refs[0];
  const mixed = hasRef && refs.some((r) => r !== first);
  const name = !mixed ? first : undefined;
  const missing = name !== undefined && !Object.prototype.hasOwnProperty.call(tokens?.[category] ?? {}, name);
  return { ...(name !== undefined ? { name } : {}), hasRef, mixed, missing };
}

export type TokenCommit = { ok: true; op: UpdateOp } | { ok: false; error: string };

/** Op that stores a Token_Reference to an existing token of the field's category (Req 11.12). */
export function buildApplyTokenOp(
  elements: readonly Element[],
  def: FieldDef,
  tokenName: string,
  tokens: TokenCollection | undefined,
): TokenCommit {
  const category = tokenCategoryOf(def);
  if (!category) return { ok: false, error: t('This field cannot reference a token') };
  if (!Object.prototype.hasOwnProperty.call(tokens?.[category] ?? {}, tokenName)) {
    return { ok: false, error: t('Token "{0}" does not exist', tokenName) };
  }
  return { ok: true, op: buildUpdateOp(elements.map((e) => e.id), { [def.name]: makeTokenRef(tokenName) }) };
}

/**
 * Op that replaces a Token_Reference with its resolved literal, or with the default when the token is
 * missing (Req 11.17). Elements that resolve to different literals reject, since one update sets one value.
 */
export function buildDetachTokenOp(elements: readonly Element[], def: FieldDef, tokens: TokenCollection | undefined): TokenCommit {
  const category = tokenCategoryOf(def);
  if (!category || category === 'numbers') return { ok: false, error: t('This field cannot reference a token') };
  const resolved = resolveTokens(tokens)[category];
  const literals = new Set<string>();
  for (const el of elements) {
    const name = tokenRefName(summarizeProperty([el], def.name).value);
    if (name === undefined) continue;
    literals.add(String(resolved.get(name) ?? DETACH_FALLBACK[category]));
  }
  if (literals.size === 0) return { ok: false, error: t('Nothing to detach') };
  if (literals.size > 1) {
    return { ok: false, error: t('Selected elements use different token values; select them one at a time to detach') };
  }
  const ids = elements.filter((e) => tokenRefName(summarizeProperty([e], def.name).value) !== undefined).map((e) => e.id);
  return { ok: true, op: buildUpdateOp(ids, { [def.name]: [...literals][0] }) };
}
