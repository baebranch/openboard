/**
 * Pure logic for the Properties_Panel (Req 6.6-6.9, 8.5, 9.7, 9.8): field definitions,
 * parse/validate/commit state machine and update-op construction. No React here.
 */
import { EDGE_LABEL_MAX, type Element, type ElementType } from '../../core/model';
import { PROPERTY_DESCRIPTORS } from '../../core/properties/descriptors';
import { summarizeProperty } from '../../core/properties/mixed';
import { validateProperty } from '../../core/properties/validate';

export type FieldKind = 'number' | 'enum' | 'color' | 'text';

export interface FieldDef {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly values?: readonly string[];
  readonly maxLength?: number;
  readonly appliesTo?: readonly ElementType[];
  /** Min length for text fields. */
  readonly minLength?: number;
}

const TEXT_TYPES: readonly ElementType[] = ['text', 'sticky', 'flowNode'];
const ARROWS = ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar'] as const;

/** Extra (non-descriptor) properties handled by this module. */
const EXTRA_VALIDATORS: Readonly<Record<string, (v: unknown) => string | undefined>> = {
  fontFamily: (v) => (typeof v === 'string' && v.trim().length > 0 && v.length <= 200 ? undefined : 'Font family must be 1 to 200 characters'),
  routing: (v) => (v === 'straight' || v === 'curved' || v === 'orthogonal' ? undefined : 'Routing must be straight, curved or orthogonal'),
  sourceArrow: (v) => (typeof v === 'string' && (ARROWS as readonly string[]).includes(v) ? undefined : 'Invalid arrowhead'),
  targetArrow: (v) => (typeof v === 'string' && (ARROWS as readonly string[]).includes(v) ? undefined : 'Invalid arrowhead'),
  label: (v) => (typeof v === 'string' && v.length <= EDGE_LABEL_MAX ? undefined : `Label must be at most ${EDGE_LABEL_MAX} characters`),
};

export const FIELDS: readonly FieldDef[] = [
  { name: 'x', label: 'X', kind: 'number' },
  { name: 'y', label: 'Y', kind: 'number' },
  { name: 'width', label: 'Width', kind: 'number' },
  { name: 'height', label: 'Height', kind: 'number' },
  { name: 'rotation', label: 'Rotation', kind: 'number' },
  { name: 'fill', label: 'Fill', kind: 'color' },
  { name: 'stroke', label: 'Stroke', kind: 'color' },
  { name: 'strokeWidth', label: 'Stroke width', kind: 'number' },
  { name: 'strokeStyle', label: 'Stroke style', kind: 'enum', values: PROPERTY_DESCRIPTORS['strokeStyle']!.values },
  { name: 'opacity', label: 'Opacity', kind: 'number' },
  { name: 'cornerRadius', label: 'Corner radius', kind: 'number', appliesTo: PROPERTY_DESCRIPTORS['cornerRadius']!.appliesTo },
  { name: 'fontFamily', label: 'Font family', kind: 'text', appliesTo: TEXT_TYPES, maxLength: 200 },
  { name: 'fontSize', label: 'Font size', kind: 'number', appliesTo: TEXT_TYPES },
  { name: 'align', label: 'Text alignment', kind: 'enum', values: PROPERTY_DESCRIPTORS['align']!.values, appliesTo: TEXT_TYPES },
  { name: 'baseWidth', label: 'Brush width', kind: 'number', appliesTo: ['freehand'] },
  { name: 'routing', label: 'Routing', kind: 'enum', values: ['straight', 'curved', 'orthogonal'], appliesTo: ['edge'] },
  { name: 'sourceArrow', label: 'Source arrowhead', kind: 'enum', values: ARROWS, appliesTo: ['edge'] },
  { name: 'targetArrow', label: 'Target arrowhead', kind: 'enum', values: ARROWS, appliesTo: ['edge'] },
  { name: 'label', label: 'Label', kind: 'text', appliesTo: ['edge'], maxLength: EDGE_LABEL_MAX },
];

/**
 * Layout rows for the panel: short inputs share a row (X | Y, Width | Height, Fill | Stroke, ...);
 * long or free-text inputs (font family, edge label) get a row of their own. Fields not listed here
 * appear alone, in FIELDS order.
 */
export const FIELD_ROWS: readonly (readonly string[])[] = [
  ['x', 'y'],
  ['width', 'height'],
  ['rotation', 'cornerRadius'],
  ['fill', 'stroke'],
  ['strokeWidth', 'strokeStyle'],
  ['opacity', 'baseWidth'],
  ['fontFamily'],
  ['fontSize', 'align'],
  ['routing'],
  ['sourceArrow', 'targetArrow'],
  ['label'],
];

/**
 * Groups the applicable fields into display rows. Missing fields are dropped, so a row whose partner
 * does not apply (e.g. Rotation without Corner radius on an ellipse) holds a single full-width field.
 */
export function fieldRows(fields: readonly FieldDef[]): FieldDef[][] {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const placed = new Set<string>();
  const rows: FieldDef[][] = [];
  for (const row of FIELD_ROWS) {
    const present = row.map((n) => byName.get(n)).filter((f): f is FieldDef => f !== undefined);
    present.forEach((f) => placed.add(f.name));
    if (present.length > 0) rows.push(present);
  }
  for (const f of fields) if (!placed.has(f.name)) rows.push([f]);
  return rows;
}

/** Fields that apply to every selected element (empty selection yields none). */
export function fieldsFor(elements: readonly Pick<Element, 'type'>[]): FieldDef[] {
  if (elements.length === 0) return [];
  return FIELDS.filter((f) => !f.appliesTo || elements.every((e) => f.appliesTo!.includes(e.type)));
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export type ParseResult = { ok: true; value: number | string } | { ok: false; error: string };

/** Parse raw field text to a typed value (no range checks). */
export function parseInput(def: FieldDef, raw: string): ParseResult {
  if (def.kind === 'number') {
    const t = raw.trim();
    if (!NUMBER_RE.test(t)) return { ok: false, error: `${def.label} must be a number` };
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, error: `${def.label} must be a finite number` };
    return { ok: true, value: n };
  }
  if (def.kind === 'color') return { ok: true, value: raw.trim() };
  return { ok: true, value: raw };
}

export type CommitResult =
  | { ok: true; value: number | string }
  | { ok: false; error: string };

/** Parse and validate `raw` against every selected element; the first failure rejects the commit. */
export function commitValue(def: FieldDef, raw: string, elements: readonly Element[]): CommitResult {
  const parsed = parseInput(def, raw);
  if (!parsed.ok) return parsed;
  let result: number | string = parsed.value;
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

/** Initial field state from the current selection. */
export function initFieldState(elements: readonly Element[], name: string): FieldState {
  const s = summarizeProperty(elements, name);
  const text = s.mixed ? '' : displayText(s.value);
  return { draft: text, committed: text, mixed: s.mixed };
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
  op?: UpdateOp;
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
  return {
    state: fieldReducer(state, { type: 'accept', text: displayText(r.value) }),
    op: buildUpdateOp(ids, { [def.name]: r.value }),
  };
}
