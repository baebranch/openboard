/**
 * Backdrop lookup for background-aware text. Pure: no DOM or vscode imports.
 *
 * Text that is not painted on a fill of its own sits on whatever is drawn behind it: a filled shape
 * or Frame lower in the stacking order, a filled ancestor Frame, or the canvas. The renderer resolves
 * the candidates' colors (tokens, theme) itself; this module only finds which elements can be behind.
 */
import { rotatedBounds } from '../model/geometry';
import type { Element, Point } from '../model/types';

/** Element types whose fill can sit behind text. Images, strokes and text are not considered. */
const BACKDROP_TYPES: ReadonlySet<Element['type']> = new Set(['rectangle', 'ellipse', 'diamond', 'sticky', 'frame', 'flowNode']);

/** Below this opacity a shape lets the canvas show through, so it is not treated as a backdrop. */
const MIN_BACKDROP_OPACITY = 50;

/** Element types that draw text and therefore have a backdrop worth finding. */
export function hasTextBackdrop(el: Element): boolean {
  return el.type === 'text' || el.type === 'sticky' || el.type === 'flowNode' || el.type === 'frame';
}

/** Where `el`'s text sits: the box center, or for a Frame the name label above its top-left corner. */
export function textAnchor(el: Element): Point {
  if (el.type === 'frame') return { x: el.x + 4, y: el.y - 11 };
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

function contains(e: Element, p: Point): boolean {
  const b = rotatedBounds(e);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

function isAncestor(candidate: Element, el: Element, byId: ReadonlyMap<string, Element>): boolean {
  const seen = new Set<string>([el.id]);
  let pid = el.parentId;
  while (pid !== undefined && !seen.has(pid)) {
    if (pid === candidate.id) return true;
    seen.add(pid);
    pid = byId.get(pid)?.parentId;
  }
  return false;
}

/**
 * Elements that may be drawn behind `el`'s text, topmost first: shapes earlier in `elements` (the
 * stacking order) and ancestors, that cover the text anchor and are not mostly transparent.
 * When `el` is not part of `elements` (a pre-filtered list), every listed element counts as earlier.
 */
export function backdropCandidates(
  el: Element,
  elements: readonly Element[],
  byId?: ReadonlyMap<string, Element>,
  /** Position of `el` in `elements` when the caller already knows it (-1 when absent). */
  knownIndex?: number,
): Element[] {
  const index = knownIndex ?? elements.findIndex((e) => e.id === el.id);
  const ids = byId ?? new Map(elements.map((e) => [e.id, e]));
  const p = textAnchor(el);
  const out: Element[] = [];
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i]!;
    if (e.id === el.id || !BACKDROP_TYPES.has(e.type)) continue;
    if (e.style.opacity < MIN_BACKDROP_OPACITY) continue;
    if (index >= 0 && i > index && !isAncestor(e, el, ids)) continue;
    if (!contains(e, p)) continue;
    out.push(e);
  }
  return out;
}
