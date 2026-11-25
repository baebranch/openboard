import { center, unionBounds } from '../model/geometry';
import { clamp, ZOOM_RANGE } from '../model/ranges';
import type { Bounds, Point, Viewport } from '../model/types';

/**
 * Viewport convention (matches ReactFlow): a board point `b` is drawn at the
 * screen point `b * zoom + (x, y)`.
 */

/** Margin in screen pixels kept free on each side by fit operations (Req 3.6, 3.9). */
export const FIT_MARGIN = 32;

export interface Size {
  width: number;
  height: number;
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, ZOOM_RANGE);
}

export function screenToBoard(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function boardToScreen(v: Viewport, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

/**
 * Set the zoom level, keeping the board point under `pointer` (screen coords)
 * at the same screen position (Req 3.2). The result is clamped to 2%..800%
 * (Req 3.4, 3.5); when clamping leaves the zoom unchanged the viewport is
 * returned unchanged.
 */
export function zoomAround(v: Viewport, pointer: Point, newZoom: number): Viewport {
  const zoom = clampZoom(newZoom);
  if (!Number.isFinite(zoom) || zoom === v.zoom) return { ...v };
  const b = screenToBoard(v, pointer);
  return { x: pointer.x - b.x * zoom, y: pointer.y - b.y * zoom, zoom };
}

/** Zoom by a multiplicative factor around the pointer. */
export function zoomByFactor(v: Viewport, pointer: Point, factor: number): Viewport {
  return zoomAround(v, pointer, v.zoom * factor);
}

/** Pan so the viewport offset changes by the pointer movement (Req 3.3). */
export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { x: v.x + dx, y: v.y + dy, zoom: v.zoom };
}

/**
 * Viewport that shows `bounds` fully with at least `margin` px on each side,
 * at the highest zoom within 2%..800% (Req 3.6, 3.9). If the content cannot fit
 * even at the minimum zoom, use the minimum zoom centered on the content
 * (Req 3.8). The content is always centered in the screen.
 */
export function fitBounds(bounds: Bounds, screen: Size, margin: number = FIT_MARGIN): Viewport {
  const availW = screen.width - 2 * margin;
  const availH = screen.height - 2 * margin;
  const fitW = bounds.width > 0 ? availW / bounds.width : Infinity;
  const fitH = bounds.height > 0 ? availH / bounds.height : Infinity;
  const zoom = clampZoom(Math.min(fitW, fitH));
  const c = center(bounds);
  return { x: screen.width / 2 - c.x * zoom, y: screen.height / 2 - c.y * zoom, zoom };
}

/** Zoom to fit all content; empty content leaves the viewport unchanged (Req 3.6-3.8). */
export function zoomToFit(v: Viewport, contentBounds: readonly Bounds[], screen: Size): Viewport {
  const u = unionBounds(contentBounds);
  if (!u) return { ...v };
  return fitBounds(u, screen);
}

/** Zoom to fit the selection; empty selection leaves the viewport unchanged (Req 3.9, 3.10). */
export function zoomToSelection(v: Viewport, selectedBounds: readonly Bounds[], screen: Size): Viewport {
  return zoomToFit(v, selectedBounds, screen);
}
