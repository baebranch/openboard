/**
 * Layout_Pass: resolves `hug` sizes innermost-first, then `fill` sizes and positions
 * outermost-first, using `arrangeStack` for placement. Pure and deterministic: no vscode,
 * DOM, or I/O. The stored `sizing` of an element is never modified; degradation rules are
 * evaluation-time substitutions only.
 *
 * Notes on behavior:
 * - Children with `ignoreLayout` (and `edge` elements) are not arranged or sized by their
 *   parent. They are shifted with the parent when it moves, so they keep their offset.
 * - A hug Layout_Frame or hug text element that is not arranged by a parent still resolves
 *   its own hug size (hug depends only on content).
 * - Wrapped text with a hug height depends on its final width. The pass therefore repeats
 *   internally until stable (bounded), so a single call is idempotent.
 */
import type { BoardDocument, Element, ElementId, FrameElement } from '../model/types';
import { round2 } from '../model/ranges';
import { measure } from '../text/measure';
import { runsToPlainText } from '../text/runs';
import type { TokenCollection } from '../tokens/types';
import { resolveLayoutSpacing } from '../tokens/number-fields';
import { arrangeStack } from './stack';

/** Upper bound for the internal settle loop. */
const MAX_SETTLE_ROUNDS = 8;

type Axis = 'width' | 'height';
type Mode = 'fixed' | 'hug' | 'fill';
type TextElement = Extract<Element, { type: 'text' | 'sticky' | 'flowNode' }>;
type LayoutFrame = FrameElement & { layout: NonNullable<FrameElement['layout']> };

function isLayoutFrame(e: Element): e is LayoutFrame {
  return e.type === 'frame' && e.layout !== undefined;
}

function isTextBearing(e: Element): e is TextElement {
  return e.type === 'text' || e.type === 'sticky' || e.type === 'flowNode';
}

/** Round and normalise negative zero. */
function r2(v: number): number {
  return round2(v) + 0;
}

function settleOnce(elements: readonly Element[], tokens: TokenCollection | undefined): readonly Element[] {
  const byId = new Map<ElementId, Element>();
  const kids = new Map<ElementId, Element[]>();
  for (const e of elements) {
    byId.set(e.id, e);
    if (e.parentId !== undefined) {
      const list = kids.get(e.parentId);
      if (list) list.push(e);
      else kids.set(e.parentId, [e]);
    }
  }
  const work = new Map<ElementId, Element>();
  const cur = (id: ElementId): Element => work.get(id) ?? byId.get(id)!;

  const setGeom = (id: ElementId, g: Partial<Record<'x' | 'y' | 'width' | 'height', number>>): void => {
    const e = cur(id);
    let next: Element | undefined;
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      const v = g[k];
      if (v !== undefined && v !== e[k]) next = { ...(next ?? e), [k]: v } as Element;
    }
    if (next) work.set(id, next);
  };

  /** Whether Layout_Frame `p` arranges its child `c`. User_Children of an instance are never arranged. */
  const arranges = (p: Element, c: Element): boolean =>
    c.type !== 'edge' &&
    c.ignoreLayout !== true &&
    !(p.type === 'frame' && p.instanceOf !== undefined && !c.id.startsWith(`${p.id}::`));

  /** The Layout_Frame that arranges `e`, if any. */
  const arrangingParent = (e: Element): LayoutFrame | undefined => {
    if (e.parentId === undefined) return undefined;
    const p = byId.get(e.parentId);
    return p !== undefined && isLayoutFrame(p) && arranges(p, e) ? p : undefined;
  };

  const arrangedKids = (f: Element): Element[] => (kids.get(f.id) ?? []).filter((c) => arranges(f, c));

  /** Effective sizing mode for this evaluation (stored `sizing` is never changed). */
  const mode = (e: Element, axis: Axis, parent: LayoutFrame | undefined): Mode => {
    let m: Mode = e.sizing?.[axis] ?? 'fixed';
    if (m === 'fill') {
      if (parent === undefined) return 'fixed';
      if (parent.sizing?.[axis] === 'hug') m = 'hug';
    }
    if (m === 'hug' && !isLayoutFrame(e) && !isTextBearing(e)) return 'fixed';
    return m;
  };

  /** Apply the Text_Measurer to a text element on its effective hug axes; keeps size on failure. */
  const hugText = (e: TextElement, wMode: Mode, hMode: Mode): void => {
    if (wMode !== 'hug' && hMode !== 'hug') return;
    const c = cur(e.id) as TextElement;
    const availableWidth = wMode !== 'hug' && c.textWrap === 'wrap' ? c.width : Infinity;
    const out = measure({
      text: runsToPlainText(c.runs),
      fontFamily: c.fontFamily,
      fontSize: c.fontSize,
      fontWeight: c.fontWeight,
      availableWidth,
    });
    if (!out.ok) return;
    const g: Partial<Record<Axis, number>> = {};
    if (wMode === 'hug') g.width = Math.max(1, r2(out.value.widestLine));
    if (hMode === 'hug') g.height = Math.max(1, r2(out.value.height));
    setGeom(e.id, g);
  };

  const guard = new Set<ElementId>();

  /** Bottom-up: resolve hug sizes of `e` and everything arranged beneath it. */
  const hugPass = (e0: Element, parent: LayoutFrame | undefined): void => {
    if (guard.has(e0.id)) return;
    guard.add(e0.id);
    const wMode = mode(e0, 'width', parent);
    const hMode = mode(e0, 'height', parent);
    if (isLayoutFrame(e0)) {
      const list = arrangedKids(e0);
      for (const k of list) hugPass(k, e0);
      const layout = resolveLayoutSpacing(e0.layout, tokens);
      const horizontal = layout.direction === 'horizontal';
      const g: Partial<Record<Axis, number>> = {};
      for (const axis of ['width', 'height'] as const) {
        if ((axis === 'width' ? wMode : hMode) !== 'hug') continue;
        const main = (axis === 'width') === horizontal;
        const sizes = list.map((k) => cur(k.id)[axis]);
        let content = 0;
        if (sizes.length > 0) {
          content = main
            ? sizes.reduce((s, v) => s + v, 0) + layout.gap * (sizes.length - 1)
            : Math.max(...sizes);
        }
        const pad =
          axis === 'width' ? layout.padding.left + layout.padding.right : layout.padding.top + layout.padding.bottom;
        g[axis] = Math.max(1, r2(content + pad));
      }
      setGeom(e0.id, g);
    } else if (isTextBearing(e0)) {
      hugText(e0, wMode, hMode);
    }
    guard.delete(e0.id);
  };

  /** Shift every descendant of `id` (kept by absolute coordinates) by the same offset. */
  const shiftDescendants = (id: ElementId, dx: number, dy: number, seen: Set<ElementId>): void => {
    for (const c of kids.get(id) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const e = cur(c.id);
      setGeom(c.id, { x: r2(e.x + dx), y: r2(e.y + dy) });
      shiftDescendants(c.id, dx, dy, seen);
    }
  };

  const moveTo = (id: ElementId, x: number, y: number): void => {
    const e = cur(id);
    const dx = r2(x - e.x);
    const dy = r2(y - e.y);
    if (dx === 0 && dy === 0) return;
    setGeom(id, { x, y });
    shiftDescendants(id, dx, dy, new Set([id]));
  };

  /** Top-down: resolve fill sizes and positions of the children of Layout_Frame `fid`. */
  const placePass = (fid: ElementId, depthGuard: Set<ElementId>): void => {
    if (depthGuard.has(fid)) return;
    depthGuard.add(fid);
    const f = cur(fid) as LayoutFrame;
    const list = arrangedKids(f);
    if (list.length > 0) {
      const layout = resolveLayoutSpacing(f.layout, tokens);
      const horizontal = layout.direction === 'horizontal';
      const mainDim: Axis = horizontal ? 'width' : 'height';
      const crossDim: Axis = horizontal ? 'height' : 'width';
      const { top, right, bottom, left } = layout.padding;
      const innerMain = horizontal ? f.width - left - right : f.height - top - bottom;
      const innerCross = horizontal ? f.height - top - bottom : f.width - left - right;

      const fillMain = list.filter((k) => mode(k, mainDim, f) === 'fill');
      const fixedMain = list
        .filter((k) => mode(k, mainDim, f) !== 'fill')
        .reduce((s, k) => s + cur(k.id)[mainDim], 0);
      const gaps = layout.gap * (list.length - 1);
      const share = fillMain.length > 0 ? Math.max(1, r2((innerMain - fixedMain - gaps) / fillMain.length)) : 0;

      for (const k of list) {
        const g: Partial<Record<Axis, number>> = {};
        if (mode(k, mainDim, f) === 'fill') g[mainDim] = share;
        if (mode(k, crossDim, f) === 'fill') g[crossDim] = Math.max(1, r2(innerCross));
        setGeom(k.id, g);
        const c = cur(k.id);
        // Wrapped text with a hug height depends on the width that was just resolved.
        if (isTextBearing(c) && c.textWrap === 'wrap') {
          const wm = mode(c, 'width', f);
          const hm = mode(c, 'height', f);
          if (hm === 'hug' && wm !== 'hug') hugText(c, wm, hm);
        }
      }

      const arranged = arrangeStack(
        { width: f.width, height: f.height, x: f.x, y: f.y, layout: f.layout, ...(tokens ? { tokens } : {}) },
        list.map((k) => {
          const c = cur(k.id);
          return { id: k.id, x: c.x, y: c.y, width: c.width, height: c.height };
        }),
      );
      for (const k of list) {
        const p = arranged.get(k.id);
        if (p) moveTo(k.id, p.x, p.y);
      }
      for (const k of list) if (isLayoutFrame(k)) placePass(k.id, depthGuard);
    }
    depthGuard.delete(fid);
  };

  const free = elements.filter((e) => arrangingParent(e) === undefined);
  for (const e of free) hugPass(e, undefined);
  for (const e of free) if (isLayoutFrame(e)) placePass(e.id, new Set());

  if (work.size === 0) return elements;
  return elements.map((e) => work.get(e.id) ?? e);
}

/**
 * Run the Layout_Pass. Returns the same `doc` reference and an empty `changedIds` when
 * nothing changes; otherwise a new document and the ids whose x, y, width, or height changed.
 */
export function runLayoutPass(doc: BoardDocument): { doc: BoardDocument; changedIds: ElementId[] } {
  if (!doc.elements.some((e) => isLayoutFrame(e) || (e.sizing !== undefined && isTextBearing(e)))) {
    return { doc, changedIds: [] };
  }
  let elements: readonly Element[] = doc.elements;
  for (let i = 0; i < MAX_SETTLE_ROUNDS; i++) {
    const next = settleOnce(elements, doc.tokens);
    if (next === elements) break;
    elements = next;
  }
  if (elements === doc.elements) return { doc, changedIds: [] };
  const changedIds: ElementId[] = [];
  elements.forEach((e, i) => {
    const b = doc.elements[i]!;
    if (e.x !== b.x || e.y !== b.y || e.width !== b.width || e.height !== b.height) changedIds.push(e.id);
  });
  if (changedIds.length === 0) return { doc, changedIds };
  return { doc: { ...doc, elements: elements.slice() }, changedIds };
}
