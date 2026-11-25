/**
 * Pure gesture math and gesture -> operation mapping (Req 10.5). Each completed gesture (drag, resize,
 * rotate, freehand stroke, connect, ...) maps to AT MOST ONE op; multi-element gestures use
 * `openboard.batch` so they stay one undo entry.
 */
import { unionBounds } from '../../core/model/geometry';
import { clamp, COORD_RANGE, maxCornerRadius, MIN_SIZE, round2, ROTATION_RANGE } from '../../core/model/ranges';
import type { Bounds, Element, ElementId, FreehandPoint, Point } from '../../core/model/types';
import { finalizeStroke, type StrokePoint } from '../../core/freehand';
import { frameNestingProblem, wouldCreateFrameCycle } from '../../core/shapes/shapes';
import { snapToGrid } from '../../core/snap';
import type { ToolId } from '../uiState';

export interface Op {
  tool: string;
  input: unknown;
}

export const TOOL_ELEMENT_UPDATE = 'openboard.element.update';
export const TOOL_ELEMENT_CREATE = 'openboard.element.create';
export const TOOL_ELEMENT_DELETE = 'openboard.element.delete';
export const TOOL_CONNECT = 'openboard.connect';
export const TOOL_BATCH = 'openboard.batch';

/** Pointer movement below this many screen pixels is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 3;

type Patch = Record<string, unknown>;

function coord(v: number): number {
  return round2(clamp(v, COORD_RANGE));
}

function size(v: number): number {
  return round2(Math.max(MIN_SIZE, v));
}

/** One op for a list of per-element patches: update for one element, one batch for several. */
export function updateOps(patches: ReadonlyArray<{ id: ElementId; set: Patch }>): Op | undefined {
  if (patches.length === 0) return undefined;
  if (patches.length === 1) {
    const p = patches[0]!;
    return { tool: TOOL_ELEMENT_UPDATE, input: { ids: [p.id], set: p.set } };
  }
  return {
    tool: TOOL_BATCH,
    input: { operations: patches.map((p) => ({ tool: TOOL_ELEMENT_UPDATE, input: { ids: [p.id], set: p.set } })) },
  };
}

// --- move -----------------------------------------------------------------------------------------

/** Final top-left for a moved group: alignment-snapped delta, then grid snap of the group's top-left. */
export function snapMoveDelta(start: Bounds, dx: number, dy: number, gridSpacing: number | undefined): { dx: number; dy: number } {
  if (gridSpacing === undefined) return { dx, dy };
  return { dx: snapToGrid(start.x + dx, gridSpacing) - start.x, dy: snapToGrid(start.y + dy, gridSpacing) - start.y };
}

/** Per-element patches that move the elements by (dx, dy); elements that do not change are omitted. */
export function movePatches(
  elements: readonly Element[],
  ids: readonly ElementId[],
  dx: number,
  dy: number,
): Array<{ id: ElementId; set: Patch }> {
  const idSet = new Set(ids);
  return elements
    .filter((e) => idSet.has(e.id) && e.type !== 'edge' && !e.locked)
    .map((e) => ({ el: e, x: coord(e.x + dx), y: coord(e.y + dy) }))
    .filter((p) => p.x !== round2(p.el.x) || p.y !== round2(p.el.y))
    .map((p) => {
      const set: Patch = { x: p.x, y: p.y };
      if (p.el.type === 'freehand') set['points'] = p.el.points.map((pt) => shiftPoint(pt, p.x - p.el.x, p.y - p.el.y));
      return { id: p.el.id, set };
    });
}

/** Move the elements by (dx, dy); undefined when nothing moves. */
export function moveOp(elements: readonly Element[], ids: readonly ElementId[], dx: number, dy: number): Op | undefined {
  return updateOps(movePatches(elements, ids, dx, dy));
}

// --- drop onto a Frame (Req 21.4) -------------------------------------------------------------------

/**
 * What kind of container an element is for drops: 'layout' for a Layout_Frame (a Frame with `layout`),
 * 'frame' for any other Frame. The Layout_Pass orders a Layout_Frame's children by their main-axis
 * center (Req 19.2), so dropping or dragging a child to a new position IS the reorder; the host runs the
 * pass inside the same transaction as the move, giving one Undo_History entry (Req 19.11, 19.15).
 */
export type DropContainerKind = 'frame' | 'layout';

export function dropContainerKind(el: Element): DropContainerKind | undefined {
  if (el.type !== 'frame') return undefined;
  return el.layout !== undefined ? 'layout' : 'frame';
}

/**
 * Index at which an element whose main-axis center is `center` lands among the arranged children of
 * Layout_Frame `frame` (excluding `exclude`): the count of siblings whose center is strictly smaller,
 * matching the Layout_Pass ordering (ties keep the stored order, so the newcomer goes after them).
 */
export function layoutInsertionIndex(
  elements: readonly Element[],
  frame: Element,
  center: number,
  exclude: ReadonlySet<ElementId> = new Set(),
): number {
  if (frame.type !== 'frame' || frame.layout === undefined) return 0;
  const vertical = frame.layout.direction === 'vertical';
  return elements.filter((e) => {
    if (e.parentId !== frame.id || e.type === 'edge' || e.ignoreLayout === true || exclude.has(e.id)) return false;
    const c = vertical ? e.y + e.height / 2 : e.x + e.width / 2;
    return c <= center;
  }).length;
}

function containsPoint(el: Element, p: Point): boolean {
  return p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height;
}

/** Dragged ids whose ancestors are not also dragged; descendants of a dragged Frame keep their parent. */
function dropRoots(elements: readonly Element[], ids: readonly ElementId[]): ElementId[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const idSet = new Set(ids);
  return ids.filter((id) => {
    const seen = new Set<ElementId>([id]);
    for (let cur = byId.get(id)?.parentId; cur !== undefined; cur = byId.get(cur)?.parentId) {
      if (seen.has(cur)) break;
      if (idSet.has(cur)) return false;
      seen.add(cur);
    }
    return true;
  });
}

/**
 * The topmost Frame under `point` that can accept every dragged root: not itself dragged, not inside a
 * dragged element, and without creating a cycle or exceeding the nesting depth. Undefined when none.
 */
export function findDropTarget(elements: readonly Element[], ids: readonly ElementId[], point: Point): Element | undefined {
  const roots = dropRoots(elements, ids);
  if (roots.length === 0) return undefined;
  const dragged = new Set(ids);
  for (let i = elements.length - 1; i >= 0; i--) {
    const cand = elements[i]!;
    if (dropContainerKind(cand) === undefined || dragged.has(cand.id) || !containsPoint(cand, point)) continue;
    const ok = roots.every((id) => !wouldCreateFrameCycle(id, cand.id, elements));
    if (!ok) continue;
    const next = elements.map((e) => (roots.includes(e.id) ? { ...e, parentId: cand.id } : e)) as Element[];
    if (frameNestingProblem(next, roots) !== undefined) continue;
    return cand;
  }
  return undefined;
}

/**
 * One op that moves the selection by (dx, dy) and, when `target` is given, sets it as `parentId` of each
 * dropped root (Frames included). Locked elements are skipped like in a move. One op = one undo entry.
 * For a Layout_Frame target the moved position determines the insertion index; the Layout_Pass reflow
 * runs in the same transaction as this op, so move, reorder and reflow are one entry (Req 19.11).
 */
export function dropOp(
  elements: readonly Element[],
  ids: readonly ElementId[],
  dx: number,
  dy: number,
  target: Element | undefined,
): Op | undefined {
  const patches = movePatches(elements, ids, dx, dy);
  if (!target) return updateOps(patches);
  const roots = new Set(dropRoots(elements, ids));
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = patches.map((p) => (roots.has(p.id) ? { id: p.id, set: { ...p.set, parentId: target.id } } : p));
  for (const id of roots) {
    const el = byId.get(id);
    if (!el || el.type === 'edge' || el.locked || el.parentId === target.id || out.some((p) => p.id === id)) continue;
    out.push({ id, set: { parentId: target.id } });
  }
  return updateOps(out);
}

function shiftPoint(pt: FreehandPoint, dx: number, dy: number): FreehandPoint {
  return { ...pt, x: round2(pt.x + dx), y: round2(pt.y + dy) };
}

// --- resize ---------------------------------------------------------------------------------------

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const RESIZE_HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** New bounds when `handle` is dragged by (dx, dy) in board units. Shift keeps the aspect ratio. */
export function resizeBounds(start: Bounds, handle: HandleId, dx: number, dy: number, keepAspect = false): Bounds {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;

  // The edge being dragged may not cross the opposite edge by more than the minimum size.
  if (right - left < MIN_SIZE) {
    if (handle.includes('w')) left = right - MIN_SIZE;
    else right = left + MIN_SIZE;
  }
  if (bottom - top < MIN_SIZE) {
    if (handle.includes('n')) top = bottom - MIN_SIZE;
    else bottom = top + MIN_SIZE;
  }

  if (keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    const w = right - left;
    const h = bottom - top;
    const isCorner = handle.length === 2;
    let nw = w;
    let nh = h;
    if (isCorner) {
      const sx = w / start.width;
      const sy = h / start.height;
      const s = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
      nw = start.width * s;
      nh = start.height * s;
    } else if (handle === 'e' || handle === 'w') nh = w / ratio;
    else nw = h * ratio;
    nw = Math.max(MIN_SIZE, nw);
    nh = Math.max(MIN_SIZE, nh);
    if (isCorner) {
      if (handle.includes('w')) left = right - nw;
      else right = left + nw;
      if (handle.includes('n')) top = bottom - nh;
      else bottom = top + nh;
    } else if (handle === 'e' || handle === 'w') {
      const cy = (top + bottom) / 2;
      top = cy - nh / 2;
      bottom = cy + nh / 2;
      if (handle === 'w') left = right - nw;
      else right = left + nw;
    } else {
      const cx = (left + right) / 2;
      left = cx - nw / 2;
      right = cx + nw / 2;
      if (handle === 'n') top = bottom - nh;
      else bottom = top + nh;
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Per-element patches that scale `ids` from the `from` selection bounds to `to`. */
export function scalePatches(
  elements: readonly Element[],
  ids: readonly ElementId[],
  from: Bounds,
  to: Bounds,
): Array<{ id: ElementId; set: Patch }> {
  const idSet = new Set(ids);
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  const mapX = (x: number): number => to.x + (x - from.x) * sx;
  const mapY = (y: number): number => to.y + (y - from.y) * sy;
  return elements
    .filter((e) => idSet.has(e.id) && e.type !== 'edge' && !e.locked)
    .map((e) => {
      const set: Patch = { x: coord(mapX(e.x)), y: coord(mapY(e.y)), width: size(e.width * sx), height: size(e.height * sy) };
      if (e.type === 'freehand') {
        set['points'] = e.points.map((p) => ({ ...p, x: round2(mapX(p.x)), y: round2(mapY(p.y)) }));
      }
      // Req 6.9: keep per-corner radii within half the new shorter side, in the same op as the resize.
      const radii = (e.style as { cornerRadii?: readonly number[] } | undefined)?.cornerRadii;
      if (radii) {
        const max = maxCornerRadius(set['width'] as number, set['height'] as number);
        if (radii.some((r) => r > max)) set['cornerRadii'] = radii.map((r) => Math.min(r, max));
      }
      // Req 20.10: resizing a `hug` axis writes the chosen size and switches that axis to `fixed`.
      const sizing = e.sizing;
      if (sizing && ((sizing.width === 'hug' && set['width'] !== e.width) || (sizing.height === 'hug' && set['height'] !== e.height))) {
        set['sizing'] = {
          width: sizing.width === 'hug' && set['width'] !== e.width ? 'fixed' : sizing.width,
          height: sizing.height === 'hug' && set['height'] !== e.height ? 'fixed' : sizing.height,
        };
      }
      return { id: e.id, set };
    });
}

export function resizeOp(elements: readonly Element[], ids: readonly ElementId[], from: Bounds, to: Bounds): Op | undefined {
  if (from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height) return undefined;
  return updateOps(scalePatches(elements, ids, from, to));
}

// --- rotate ---------------------------------------------------------------------------------------

/** Angle in degrees of `p` around `c` (0 = pointing right, clockwise positive on screen). */
export function angleDeg(c: Point, p: Point): number {
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
}

export function normalizeRotation(deg: number): number {
  return round2(clamp(deg % 360, ROTATION_RANGE));
}

export function snapAngle(deg: number, step = 15): number {
  return Math.round(deg / step) * step;
}

/** Per-element patches rotating each element about its own center by `deltaDeg`. */
export function rotatePatches(
  elements: readonly Element[],
  ids: readonly ElementId[],
  deltaDeg: number,
): Array<{ id: ElementId; set: Patch }> {
  const idSet = new Set(ids);
  return elements
    .filter((e) => idSet.has(e.id) && e.type !== 'edge' && !e.locked)
    .map((e) => ({ id: e.id, set: { rotation: normalizeRotation(e.rotation + deltaDeg) } }));
}

export function rotateOp(elements: readonly Element[], ids: readonly ElementId[], deltaDeg: number): Op | undefined {
  if (deltaDeg === 0) return undefined;
  return updateOps(rotatePatches(elements, ids, deltaDeg));
}

/** Zoom percentage shown on the canvas, rounded to the nearest whole percent (Req 3.12). */
export function formatZoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/** Union bounds of the (unrotated) boxes of `ids`, or undefined for an empty selection. */
export function selectionBounds(elements: readonly Element[], ids: readonly ElementId[]): Bounds | undefined {
  const idSet = new Set(ids);
  return unionBounds(elements.filter((e) => idSet.has(e.id) && e.type !== 'edge'));
}

// --- create ---------------------------------------------------------------------------------------

export type DrawTool = Extract<ToolId, 'rectangle' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'frame' | 'sticky' | 'text'>;

const DEFAULT_SIZES: Record<DrawTool, { width: number; height: number }> = {
  rectangle: { width: 120, height: 80 },
  ellipse: { width: 120, height: 80 },
  diamond: { width: 120, height: 80 },
  line: { width: 120, height: 1 },
  arrow: { width: 120, height: 1 },
  frame: { width: 320, height: 240 },
  sticky: { width: 160, height: 160 },
  text: { width: 200, height: 32 },
};

export function isDrawTool(tool: ToolId): tool is DrawTool {
  return tool in DEFAULT_SIZES;
}

export function dragDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Geometry for a drawn element from a drag a -> b (board coordinates). A click (no drag) uses the
 * tool's default size anchored at `a`. Lines and arrows keep their direction through `rotation`.
 */
export function drawGeometry(tool: DrawTool, a: Point, b: Point, isClick: boolean, shift = false): Bounds & { rotation: number } {
  const def = DEFAULT_SIZES[tool];
  if (tool === 'line' || tool === 'arrow') {
    if (isClick) return { x: coord(a.x), y: coord(a.y), width: def.width, height: def.height, rotation: 0 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.max(MIN_SIZE, Math.hypot(dx, dy));
    const ang = shift ? snapAngle(angleDeg(a, b)) : angleDeg(a, b);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    return { x: coord(cx - len / 2), y: coord(cy - 0.5), width: size(len), height: size(1), rotation: normalizeRotation(ang) };
  }
  if (isClick) return { x: coord(a.x), y: coord(a.y), width: def.width, height: def.height, rotation: 0 };
  let w = Math.abs(b.x - a.x);
  let h = Math.abs(b.y - a.y);
  if (shift) w = h = Math.max(w, h);
  const x = b.x < a.x ? a.x - w : a.x;
  const y = b.y < a.y ? a.y - h : a.y;
  return { x: coord(x), y: coord(y), width: size(w), height: size(h), rotation: 0 };
}

export function createOp(tool: DrawTool, g: Bounds & { rotation: number }): Op {
  const el: Record<string, unknown> = { type: tool, x: g.x, y: g.y, width: g.width, height: g.height };
  if (g.rotation) el['rotation'] = g.rotation;
  if (tool === 'frame') el['name'] = 'Frame';
  if (tool === 'text' || tool === 'sticky') el['text'] = '';
  return { tool: TOOL_ELEMENT_CREATE, input: { elements: [el] } };
}

export const ICON_DEFAULT_SIZE = 24;
export const ICON_DEFAULT_STROKE_WIDTH = 2;

/** Icon tool click -> one create op for a 24 by 24 icon centered on `at` (Req 23.3). */
export function iconCreateOp(name: string, at: Point): Op {
  const half = ICON_DEFAULT_SIZE / 2;
  const el = {
    type: 'icon',
    name,
    x: coord(at.x - half),
    y: coord(at.y - half),
    width: ICON_DEFAULT_SIZE,
    height: ICON_DEFAULT_SIZE,
    strokeWidth: ICON_DEFAULT_STROKE_WIDTH,
  };
  return { tool: TOOL_ELEMENT_CREATE, input: { elements: [el] } };
}

/** Freehand gesture -> one create op; undefined when there are no samples. */
export function freehandOp(samples: readonly StrokePoint[], shift: boolean, baseWidth = 4): Op | undefined {
  const pts = finalizeStroke(samples, { shift });
  if (!pts || pts.length === 0) return undefined;
  const points: FreehandPoint[] = pts.map((p) => {
    const out: FreehandPoint = { x: round2(p.x), y: round2(p.y) };
    if (p.p !== undefined) out.p = p.p;
    return out;
  });
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  return {
    tool: TOOL_ELEMENT_CREATE,
    input: {
      elements: [
        { type: 'freehand', x: minX, y: minY, width: size(maxX - minX), height: size(maxY - minY), points, baseWidth },
      ],
    },
  };
}

// --- erase / delete / connect ---------------------------------------------------------------------

export function deleteOp(ids: readonly ElementId[]): Op | undefined {
  return ids.length === 0 ? undefined : { tool: TOOL_ELEMENT_DELETE, input: { ids: [...ids] } };
}

/**
 * Connect gesture (Req 8.2, 8.3): released over an element -> one edge to it; released over empty
 * space -> a new process Flow_Node centered at the release point plus an edge, in ONE op.
 */
export function connectOp(sourceId: ElementId, targetId: ElementId | undefined, drop: Point): Op {
  const spec = targetId !== undefined ? { sourceId, targetId } : { sourceId, toPosition: { x: round2(drop.x), y: round2(drop.y) } };
  return { tool: TOOL_CONNECT, input: { edges: [spec] } };
}
