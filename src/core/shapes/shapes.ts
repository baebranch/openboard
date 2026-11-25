/**
 * Shape creation, resize, and frames. Pure functions: they return new element data or patches,
 * which tools apply inside a single transaction. No vscode or DOM imports.
 */
import { containsBounds, newId } from '../model';
import type { Bounds, Element, ElementId, ElementStyle, FrameElement, Point, ShapeElement } from '../model';

/** Drags smaller than this (width or height) create a default-sized shape (Req 6.2). */
export const MIN_DRAG_SIZE = 4;
export const DEFAULT_SHAPE_SIZE = 100;
export const MIN_ELEMENT_SIZE = 1;

export type DragShapeType = 'rectangle' | 'ellipse' | 'diamond';

export function defaultStyle(): ElementStyle {
  return {
    fill: 'theme:default',
    stroke: 'theme:default',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
    cornerRadius: 0,
  };
}

/**
 * Bounds for a shape created by dragging from `start` to `end` (Req 6.1, 6.2).
 * Tiny drags yield a 100x100 box centered on the release point `end`.
 */
export function boundsFromDrag(start: Point, end: Point): Bounds {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < MIN_DRAG_SIZE || height < MIN_DRAG_SIZE) {
    return {
      x: end.x - DEFAULT_SHAPE_SIZE / 2,
      y: end.y - DEFAULT_SHAPE_SIZE / 2,
      width: DEFAULT_SHAPE_SIZE,
      height: DEFAULT_SHAPE_SIZE,
    };
  }
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height };
}

/** Create a shape element from a drag gesture. The caller selects the new element. */
export function createShapeFromDrag(
  type: DragShapeType | ShapeElement['type'],
  start: Point,
  end: Point,
  id: ElementId = newId(),
): ShapeElement {
  return { id, type, ...boundsFromDrag(start, end), rotation: 0, style: defaultStyle() };
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Resize `b` by dragging `handle` by (dx, dy). Width and height never drop below 1 unit.
 * With `keepAspect` (Shift held) the result keeps the original ratio (Req 6.10); edge handles
 * scale the perpendicular axis about the box center, corner handles anchor the opposite corner.
 */
export function resizeBounds(b: Bounds, handle: ResizeHandle, dx: number, dy: number, keepAspect = false): Bounds {
  const movesW = handle.includes('w');
  const movesE = handle.includes('e');
  const movesN = handle.includes('n');
  const movesS = handle.includes('s');

  let width = b.width + (movesE ? dx : movesW ? -dx : 0);
  let height = b.height + (movesS ? dy : movesN ? -dy : 0);
  width = Math.max(MIN_ELEMENT_SIZE, width);
  height = Math.max(MIN_ELEMENT_SIZE, height);

  if (keepAspect && b.width > 0 && b.height > 0) {
    const horizontal = movesE || movesW;
    const vertical = movesN || movesS;
    let scale: number;
    if (horizontal && vertical) scale = Math.max(width / b.width, height / b.height);
    else if (horizontal) scale = width / b.width;
    else scale = height / b.height;
    // Keep both sides at least the minimum size.
    scale = Math.max(scale, MIN_ELEMENT_SIZE / b.width, MIN_ELEMENT_SIZE / b.height);
    // Clamp again: scale * size can land a hair under the minimum through FP error.
    width = Math.max(MIN_ELEMENT_SIZE, b.width * scale);
    height = Math.max(MIN_ELEMENT_SIZE, b.height * scale);
  }

  let x = b.x;
  let y = b.y;
  if (movesW) x = b.x + b.width - width;
  else if (!movesE) x = b.x + (b.width - width) / 2;
  if (movesN) y = b.y + b.height - height;
  else if (!movesS) y = b.y + (b.height - height) / 2;
  return { x, y, width, height };
}

export interface ElementPatch {
  id: ElementId;
  patch: Partial<Pick<Element, 'x' | 'y' | 'parentId'>> & { parentId?: ElementId | undefined };
}

/**
 * Elements fully inside the frame bounds (Req 6.12). The frame itself, ancestors of the frame,
 * and other frames are not adopted by the frame (frames do not nest implicitly).
 */
export function adoptableChildren(frame: Bounds & { id: ElementId }, elements: readonly Element[]): Element[] {
  return elements.filter(
    (e) => e.id !== frame.id && e.type !== 'frame' && containsBounds(frame, e),
  );
}

/** Patches that make every element fully inside `frame` a child of it. */
export function adoptChildrenPatches(frame: FrameElement, elements: readonly Element[]): ElementPatch[] {
  return adoptableChildren(frame, elements)
    .filter((e) => e.parentId !== frame.id)
    .map((e) => ({ id: e.id, patch: { parentId: frame.id } }));
}

/** Descendants of `frameId` (children, and children of child frames). */
export function descendantsOf(frameId: ElementId, elements: readonly Element[]): Element[] {
  const result: Element[] = [];
  const seen = new Set<ElementId>([frameId]);
  const queue: ElementId[] = [frameId];
  while (queue.length > 0) {
    const parent = queue.shift() as ElementId;
    for (const e of elements) {
      if (e.parentId === parent && !seen.has(e.id)) {
        seen.add(e.id);
        result.push(e);
        queue.push(e.id);
      }
    }
  }
  return result;
}

/** Maximum Frame nesting depth (Req 21.1). */
export const MAX_FRAME_DEPTH = 16;

/**
 * 1-based nesting depth of a Frame: 1 when it has no Frame parent, +1 per Frame level above it
 * (Req 21.1). A parent chain that loops back on itself yields `Infinity`.
 */
export function frameNestingDepth(frameId: ElementId, elements: readonly Element[]): number {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const seen = new Set<ElementId>();
  let depth = 0;
  for (let cur = byId.get(frameId); cur; cur = cur.parentId === undefined ? undefined : byId.get(cur.parentId)) {
    if (seen.has(cur.id)) return Infinity;
    seen.add(cur.id);
    depth += 1;
  }
  return depth;
}

/** True when making `newParentId` the parent of `childId` would make `childId` its own ancestor (Req 21.6). */
export function wouldCreateFrameCycle(childId: ElementId, newParentId: ElementId, elements: readonly Element[]): boolean {
  if (childId === newParentId) return true;
  return descendantsOf(childId, elements).some((e) => e.id === newParentId);
}

/**
 * The first nesting violation (Req 21.1, 21.6) among `changedIds`, their descendants, or undefined.
 * Checks that each parent is an existing Frame, that no Frame is its own ancestor, and that no
 * Frame (including Frames below a changed element) is deeper than {@link MAX_FRAME_DEPTH}.
 */
export function frameNestingProblem(elements: readonly Element[], changedIds: Iterable<ElementId>): string | undefined {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const scope = new Set<ElementId>();
  for (const id of changedIds) {
    if (!byId.has(id)) continue;
    scope.add(id);
    for (const d of descendantsOf(id, elements)) scope.add(d.id);
  }
  for (const id of scope) {
    const el = byId.get(id) as Element;
    if (el.parentId === undefined) continue;
    const parent = byId.get(el.parentId);
    if (!parent || parent.type !== 'frame') {
      return `Element ${el.id} cannot be placed in ${el.parentId}: it is not an existing Frame.`;
    }
    if (frameNestingDepth(el.id, elements) === Infinity) {
      return `Element ${el.id} cannot be placed in ${el.parentId}: a Frame cannot be its own ancestor.`;
    }
  }
  for (const id of scope) {
    const el = byId.get(id) as Element;
    if (el.type === 'frame' && frameNestingDepth(el.id, elements) > MAX_FRAME_DEPTH) {
      return `Frame ${el.id} would exceed the maximum nesting depth of ${MAX_FRAME_DEPTH}.`;
    }
  }
  return undefined;
}

/** Patches that move a frame and all of its descendants by the same offset (Req 6.12). */
export function moveFramePatches(
  frameId: ElementId,
  elements: readonly Element[],
  dx: number,
  dy: number,
): ElementPatch[] {
  const frame = elements.find((e) => e.id === frameId);
  if (!frame) return [];
  // Instance_Children are regenerated by the Sync_Pass from the moved instance; only User_Children move here.
  const prefix = `${frameId}::`;
  return [frame, ...descendantsOf(frameId, elements).filter((e) => !e.id.startsWith(prefix))].map((e) => ({
    id: e.id,
    patch: { x: e.x + dx, y: e.y + dy },
  }));
}

/** Create a Frame element and report which existing elements it adopts. */
export function createFrame(
  bounds: Bounds,
  elements: readonly Element[],
  opts: { name?: string; preset?: string; id?: ElementId } = {},
): { frame: FrameElement; adopt: ElementPatch[] } {
  const frame: FrameElement = {
    id: opts.id ?? newId(),
    type: 'frame',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: 0,
    style: { ...defaultStyle(), fill: 'theme:default' },
    name: opts.name ?? 'Frame',
    ...(opts.preset !== undefined ? { preset: opts.preset } : {}),
  };
  return { frame, adopt: adoptChildrenPatches(frame, elements) };
}

export interface FramePreset {
  id: string;
  name: string;
  category: 'device' | 'social';
  width: number;
  height: number;
}

/** Preset frame sizes (Req 6.13): at least 5 device screens and 3 social post formats. */
export const FRAME_PRESETS: readonly FramePreset[] = [
  { id: 'phone', name: 'Phone (390 x 844)', category: 'device', width: 390, height: 844 },
  { id: 'phone-small', name: 'Phone small (360 x 640)', category: 'device', width: 360, height: 640 },
  { id: 'tablet', name: 'Tablet (768 x 1024)', category: 'device', width: 768, height: 1024 },
  { id: 'tablet-large', name: 'Tablet large (1024 x 1366)', category: 'device', width: 1024, height: 1366 },
  { id: 'laptop', name: 'Laptop (1440 x 900)', category: 'device', width: 1440, height: 900 },
  { id: 'desktop', name: 'Desktop (1920 x 1080)', category: 'device', width: 1920, height: 1080 },
  { id: 'social-square', name: 'Social square post (1080 x 1080)', category: 'social', width: 1080, height: 1080 },
  { id: 'social-portrait', name: 'Social portrait post (1080 x 1350)', category: 'social', width: 1080, height: 1350 },
  { id: 'social-story', name: 'Social story (1080 x 1920)', category: 'social', width: 1080, height: 1920 },
  { id: 'social-landscape', name: 'Social landscape post (1200 x 630)', category: 'social', width: 1200, height: 630 },
];

export function getFramePreset(id: string): FramePreset | undefined {
  return FRAME_PRESETS.find((p) => p.id === id);
}

/** Create a frame from a preset with its top-left at `origin`. Returns undefined for unknown presets. */
export function createFrameFromPreset(
  presetId: string,
  origin: Point,
  elements: readonly Element[],
  id?: ElementId,
): { frame: FrameElement; adopt: ElementPatch[] } | undefined {
  const preset = getFramePreset(presetId);
  if (!preset) return undefined;
  return createFrame({ x: origin.x, y: origin.y, width: preset.width, height: preset.height }, elements, {
    name: preset.name,
    preset: preset.id,
    ...(id !== undefined ? { id } : {}),
  });
}

/** Total character count across the runs of a text-bearing element. */
function textLength(el: Element): number {
  if (el.type !== 'text' && el.type !== 'sticky' && el.type !== 'flowNode') return 0;
  return el.runs.reduce((n, r) => n + r.text.length, 0);
}

/**
 * Text-edit exit rule (Req 6.4): leaving edit mode of a text element with no characters deletes it.
 * Returns the id to delete, or undefined when the element must be kept.
 */
export function elementToDeleteOnTextEditExit(el: Element): ElementId | undefined {
  return el.type === 'text' && textLength(el) === 0 ? el.id : undefined;
}
