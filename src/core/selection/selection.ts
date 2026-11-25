import { intersects } from '../model/geometry';
import type { Bounds, Element, ElementId, Point, Viewport } from '../model/types';
import { screenToBoard } from '../viewport/viewport';

/** Viewport culling margin in screen pixels (Req 17.2). */
export const CULL_MARGIN = 256;

/** Minimum overlap, in board pixels, for a marquee to select an element (Req 5.4). */
export const MARQUEE_MIN_OVERLAP = 1;

type Box = Pick<Element, 'x' | 'y' | 'width' | 'height'>;

/** Normalize two drag corners into a bounds rectangle with non-negative size. */
export function marqueeBounds(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

type HitItem = Box & { id: ElementId; parentId?: ElementId; type?: string; clipContent?: boolean };

const inBox = (e: Box, p: Point): boolean => p.x >= e.x && p.x <= e.x + e.width && p.y >= e.y && p.y <= e.y + e.height;

/**
 * True when the point lies in a part of `e` hidden by a clipping ancestor Frame (Req 10.3):
 * some ancestor with `clipContent` does not contain the point. Cycle-safe.
 */
export function isClippedAt(
  e: { id: ElementId; parentId?: ElementId },
  byId: ReadonlyMap<ElementId, HitItem>,
  p: Point,
): boolean {
  const seen = new Set<ElementId>([e.id]);
  let pid = e.parentId;
  while (pid !== undefined && !seen.has(pid)) {
    seen.add(pid);
    const a = byId.get(pid);
    if (!a) return false;
    if (a.type === 'frame' && a.clipContent === true && !inBox(a, p)) return true;
    pid = a.parentId;
  }
  return false;
}

/**
 * Topmost element (last in z-order) whose bounds contain the point, or undefined.
 * A hit on a part of a descendant clipped away by a clipping Frame is ignored and falls
 * through to the next element or the background (Req 10.3).
 */
export function hitTest(elements: readonly HitItem[], p: Point): ElementId | undefined {
  let byId: Map<ElementId, HitItem> | undefined;
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i]!;
    if (!inBox(e, p)) continue;
    if (e.parentId !== undefined) {
      byId ??= new Map(elements.map((x) => [x.id, x]));
      if (isClippedAt(e, byId, p)) continue;
    }
    return e.id;
  }
  return undefined;
}

/** True when the overlap of the two boxes is at least `min` in both dimensions. */
export function overlapsBy(a: Bounds, b: Bounds, min: number = MARQUEE_MIN_OVERLAP): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w >= min && h >= min;
}

/**
 * Marquee selection (Req 5.4): unlocked elements whose bounds intersect the
 * marquee by at least 1 px. With `shift`, the result is the union with the
 * previous selection. Result order: previous selection first, then new ids in z-order.
 */
export function marqueeSelect(
  elements: readonly Element[],
  marquee: Bounds,
  previous: readonly ElementId[] = [],
  shift = false,
): ElementId[] {
  const hit = elements.filter((e) => !e.locked && overlapsBy(e, marquee)).map((e) => e.id);
  if (!shift) return hit;
  const out = [...previous];
  const seen = new Set(out);
  for (const id of hit) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Visible board-space rectangle expanded by `margin` screen pixels on each side. */
export function cullRegion(v: Viewport, screen: { width: number; height: number }, margin: number = CULL_MARGIN): Bounds {
  const tl = screenToBoard(v, { x: -margin, y: -margin });
  const br = screenToBoard(v, { x: screen.width + margin, y: screen.height + margin });
  return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

/** Elements whose bounds intersect the viewport expanded by 256 px (Req 17.2). */
export function cullToViewport<T extends Box>(
  elements: readonly T[],
  v: Viewport,
  screen: { width: number; height: number },
  margin: number = CULL_MARGIN,
): T[] {
  const region = cullRegion(v, screen, margin);
  return elements.filter((e) => intersects(e, region));
}
