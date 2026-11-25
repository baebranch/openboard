/**
 * Pure logic for the layout and sizing controls of the Properties_Panel (Req 19.8, 19.9, 19.10,
 * 20.1, 20.11, 26.1, 26.6, 26.7, 26.10): enable / disable Auto_Layout, edit one layout field, change
 * a sizing axis. Every commit is one op, so one Undo_History entry; the Layout_Pass reflow runs in the
 * same transaction on the host. No React here.
 */
import { CROSS_AXIS_ALIGNS, LAYOUT_SPACING_RANGE, MAIN_AXIS_ALIGNS, SIZING_MODES, STACK_DIRECTIONS } from '../../core/layout/types';
import type { CrossAxisAlign, LayoutConfig, LayoutSpec, MainAxisAlign, SizingMode, Spacing, StackDirection } from '../../core/layout/types';
import type { Element, FrameElement } from '../../core/model';
import type { TokenCollection } from '../../core/tokens/types';
import { tokenRefName } from '../../core/tokens/validate';
import { t } from '../i18n/t';

/** An op posted through `dispatchOp`; a single update or one `openboard.batch`. */
export interface PanelOp {
  tool: string;
  input: Record<string, unknown>;
}

export type PanelCommit = { ok: true; op: PanelOp } | { ok: false; error: string };

/** Defaults written when Auto_Layout is enabled (Req 19.8). */
export const DEFAULT_LAYOUT: LayoutConfig = {
  direction: 'horizontal',
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  mainAlign: 'start',
  crossAlign: 'start',
};

export type LayoutPath =
  | 'direction'
  | 'gap'
  | 'padding.top'
  | 'padding.right'
  | 'padding.bottom'
  | 'padding.left'
  | 'mainAlign'
  | 'crossAlign';

export const LAYOUT_PATHS: readonly LayoutPath[] = [
  'direction',
  'gap',
  'padding.top',
  'padding.right',
  'padding.bottom',
  'padding.left',
  'mainAlign',
  'crossAlign',
];

const ENUM_VALUES: Readonly<Record<'direction' | 'mainAlign' | 'crossAlign', readonly string[]>> = {
  direction: STACK_DIRECTIONS,
  mainAlign: MAIN_AXIS_ALIGNS,
  crossAlign: CROSS_AXIS_ALIGNS,
};

export const isEnumPath = (p: LayoutPath): p is 'direction' | 'mainAlign' | 'crossAlign' => p in ENUM_VALUES;

export function enumValues(p: 'direction' | 'mainAlign' | 'crossAlign'): readonly string[] {
  return ENUM_VALUES[p];
}

/** Localised label of a layout field; unique within the panel. */
export function layoutLabel(p: LayoutPath): string {
  switch (p) {
    case 'direction':
      return t('Layout direction');
    case 'gap':
      return t('Layout gap');
    case 'padding.top':
      return t('Padding top');
    case 'padding.right':
      return t('Padding right');
    case 'padding.bottom':
      return t('Padding bottom');
    case 'padding.left':
      return t('Padding left');
    case 'mainAlign':
      return t('Main-axis alignment');
    case 'crossAlign':
      return t('Cross-axis alignment');
  }
}

const isFrame = (el: Element): el is FrameElement => el.type === 'frame';

/** The layout section applies when every selected element is a Frame. */
export const layoutApplies = (elements: readonly Element[]): elements is readonly FrameElement[] =>
  elements.length > 0 && elements.every(isFrame);

/** The sizing section applies to every selected element except Edges, which have no box of their own. */
export const sizingApplies = (elements: readonly Element[]): boolean => elements.length > 0 && elements.every((e) => e.type !== 'edge');

const withLayout = (frames: readonly FrameElement[]): FrameElement[] => frames.filter((f) => f.layout !== undefined);

export interface LayoutSummary {
  /** Frames that have a `layout`. */
  on: number;
  /** Frames without. */
  off: number;
}

export function summarizeLayoutState(frames: readonly FrameElement[]): LayoutSummary {
  const on = withLayout(frames).length;
  return { on, off: frames.length - on };
}

const readPath = (layout: LayoutSpec, p: LayoutPath): string | number => {
  if (p.startsWith('padding.')) return layout.padding[p.slice('padding.'.length) as keyof LayoutSpec['padding']];
  return layout[p as 'direction' | 'gap' | 'mainAlign' | 'crossAlign'];
};

export interface LayoutFieldValue {
  /** Display text; '' when mixed. */
  text: string;
  mixed: boolean;
}

/** Value of one layout field across the frames that have a layout. */
export function layoutFieldValue(frames: readonly FrameElement[], p: LayoutPath): LayoutFieldValue {
  const values = withLayout(frames).map((f) => readPath(f.layout!, p));
  if (values.length === 0) return { text: '', mixed: false };
  const first = values[0]!;
  if (values.some((v) => v !== first)) return { text: '', mixed: true };
  return { text: String(first), mixed: false };
}

/**
 * Build one op that gives each element its own `set`. Elements with identical sets share an
 * `element.update`; differing sets go in one `openboard.batch`, so it is always one undo entry.
 */
export function buildPerElementOp(elements: readonly Element[], setFor: (el: Element) => Record<string, unknown>): PanelOp | undefined {
  const groups = new Map<string, { ids: string[]; set: Record<string, unknown> }>();
  for (const el of elements) {
    const set = setFor(el);
    const key = JSON.stringify(set);
    const g = groups.get(key);
    if (g) g.ids.push(el.id);
    else groups.set(key, { ids: [el.id], set });
  }
  const ops = [...groups.values()].map((g) => ({ tool: 'openboard.element.update', input: { ids: g.ids, set: g.set } }));
  if (ops.length === 0) return undefined;
  if (ops.length === 1) return ops[0]!;
  return { tool: 'openboard.batch', input: { operations: ops } };
}

/** Enable Auto_Layout on the frames that have none (Req 19.8). Undefined when all already have one. */
export function buildEnableLayoutOp(frames: readonly FrameElement[]): PanelOp | undefined {
  const ids = frames.filter((f) => f.layout === undefined).map((f) => f.id);
  if (ids.length === 0) return undefined;
  return { tool: 'openboard.element.update', input: { ids, set: { layout: structuredClone(DEFAULT_LAYOUT) } } };
}

/** Disable Auto_Layout on the frames that have it; children stay where they are (Req 19.9). */
export function buildDisableLayoutOp(frames: readonly FrameElement[]): PanelOp | undefined {
  const ids = withLayout(frames).map((f) => f.id);
  if (ids.length === 0) return undefined;
  return { tool: 'openboard.element.update', input: { ids, set: { layout: null } } };
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

type ParsedLayoutValue = { ok: true; value: string | number } | { ok: false; error: string };

/** Names of the document's number Tokens, sorted, for the gap and padding pickers (Req 11.15). */
export function numberTokenNames(tokens: TokenCollection | undefined): string[] {
  return Object.keys(tokens?.numbers ?? {}).sort();
}

/**
 * Validate raw text for a layout field with the rules of the Agent_Tool; errors name the property path.
 * Gap and padding also accept `token:<name>` naming an existing number Token (Req 11.15).
 */
export function parseLayoutValue(p: LayoutPath, raw: string, tokens?: TokenCollection): ParsedLayoutValue {
  const path = `layout.${p}`;
  if (isEnumPath(p)) {
    const v = raw.trim();
    return ENUM_VALUES[p].includes(v)
      ? { ok: true, value: v }
      : { ok: false, error: t('{0} must be one of: {1}', path, ENUM_VALUES[p].join(', ')) };
  }
  const text = raw.trim();
  const refName = tokenRefName(text);
  if (refName !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(tokens?.numbers ?? {}, refName)) {
      return { ok: false, error: t('Number token "{0}" does not exist', refName) };
    }
    return { ok: true, value: text };
  }
  const n = NUMBER_RE.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(n)) return { ok: false, error: t('{0} must be a finite number', path) };
  if (n < LAYOUT_SPACING_RANGE.min || n > LAYOUT_SPACING_RANGE.max) {
    return { ok: false, error: t('{0} must be between {1} and {2}', path, LAYOUT_SPACING_RANGE.min, LAYOUT_SPACING_RANGE.max) };
  }
  return { ok: true, value: n };
}

/** Op that changes one layout field on every selected frame with a layout, keeping its other fields (Req 26.7). */
export function buildLayoutFieldCommit(
  frames: readonly FrameElement[],
  p: LayoutPath,
  raw: string,
  tokens?: TokenCollection,
): PanelCommit {
  const parsed = parseLayoutValue(p, raw, tokens);
  if (!parsed.ok) return parsed;
  const targets = withLayout(frames);
  if (targets.length === 0) return { ok: false, error: t('Enable Auto Layout before editing it') };
  const op = buildPerElementOp(targets, (el) => {
    const cur = (el as FrameElement).layout!;
    const next: LayoutSpec = { ...cur, padding: { ...cur.padding } };
    if (p.startsWith('padding.')) next.padding[p.slice('padding.'.length) as keyof LayoutSpec['padding']] = parsed.value as Spacing;
    else if (p === 'direction') next.direction = parsed.value as StackDirection;
    else if (p === 'mainAlign') next.mainAlign = parsed.value as MainAxisAlign;
    else if (p === 'crossAlign') next.crossAlign = parsed.value as CrossAxisAlign;
    else next.gap = parsed.value as Spacing;
    return { layout: next };
  });
  return { ok: true, op: op! };
}

// --- sizing ----------------------------------------------------------------------------------

export type SizingAxis = 'width' | 'height';
export const SIZING_AXES: readonly SizingAxis[] = ['width', 'height'];
export const SIZING_MODE_LIST: readonly SizingMode[] = SIZING_MODES;

export function sizingAxisLabel(axis: SizingAxis): string {
  return axis === 'width' ? t('Width sizing') : t('Height sizing');
}

export function sizingModeLabel(mode: SizingMode): string {
  switch (mode) {
    case 'fixed':
      return t('Fixed');
    case 'hug':
      return t('Hug');
    case 'fill':
      return t('Fill');
  }
}

/** Sizing mode of an axis shared by every selected element; undefined when they differ. Absent means `fixed`. */
export function sizingAxisValue(elements: readonly Element[], axis: SizingAxis): SizingMode | undefined {
  const modes = elements.map((e) => e.sizing?.[axis] ?? 'fixed');
  const first = modes[0];
  return first !== undefined && modes.every((m) => m === first) ? first : undefined;
}

/**
 * Op that sets one axis' mode on every selected element and keeps the other axis (Req 20.11). One op,
 * so the change and its reflow are one Undo_History entry.
 */
export function buildSizingCommit(elements: readonly Element[], axis: SizingAxis, mode: string): PanelCommit {
  if (!(SIZING_MODES as readonly string[]).includes(mode)) {
    return { ok: false, error: t('sizing.{0} must be one of: {1}', axis, SIZING_MODES.join(', ')) };
  }
  const op = buildPerElementOp(elements, (el) => ({
    sizing: { width: el.sizing?.width ?? 'fixed', height: el.sizing?.height ?? 'fixed', [axis]: mode },
  }));
  if (!op) return { ok: false, error: t('Select an element to change its sizing') };
  return { ok: true, op };
}

// --- ignoreLayout ----------------------------------------------------------------------------

/** Localised label of the ignore-layout control. */
export const ignoreLayoutLabel = (): string => t('Ignore Auto Layout');

/**
 * The control applies when every selected element is a direct child of a Frame that has a `layout`
 * (Req 19.14, 26.1).
 */
export function ignoreLayoutApplies(elements: readonly Element[], all: readonly Element[]): boolean {
  if (elements.length === 0) return false;
  const byId = new Map(all.map((e) => [e.id, e] as const));
  return elements.every((e) => {
    if (e.parentId === undefined) return false;
    const parent = byId.get(e.parentId);
    return parent !== undefined && parent.type === 'frame' && parent.layout !== undefined;
  });
}

export type IgnoreLayoutState = 'on' | 'off' | 'mixed';

export function ignoreLayoutState(elements: readonly Element[]): IgnoreLayoutState {
  const on = elements.filter((e) => e.ignoreLayout === true).length;
  return on === 0 ? 'off' : on === elements.length ? 'on' : 'mixed';
}

/** One op that sets or clears `ignoreLayout`; clearing removes the field so the document can return to Schema_Version 1. */
export function buildIgnoreLayoutOp(elements: readonly Element[], ignore: boolean): PanelOp | undefined {
  const ids = elements.filter((e) => (e.ignoreLayout === true) !== ignore).map((e) => e.id);
  if (ids.length === 0) return undefined;
  return { tool: 'openboard.element.update', input: { ids, set: { ignoreLayout: ignore ? true : null } } };
}
