/**
 * Pure wheel-event -> viewport math. Chromium/Electron reports a trackpad pinch as a wheel event with
 * `ctrlKey` set (as does Ctrl + mouse wheel): those zoom around the pointer. Everything else pans.
 */
import type { Point, Viewport } from '../../core/model/types';
import { pan, zoomByFactor } from '../../core/viewport';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** WheelEvent.deltaMode: 0 pixel, 1 line, 2 page. */
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export const WHEEL_LINE_PX = 16;
/** Zoom sensitivity for ctrl/pinch wheel events (unchanged from the previous zoom-only handler). */
export const PINCH_ZOOM_SENSITIVITY = 0.01;

/** Normalizes line/page delta modes to pixels. */
export function wheelDeltaPx(e: Pick<WheelInput, 'deltaX' | 'deltaY' | 'deltaMode'>, screen: { width: number; height: number }): Point {
  if (e.deltaMode === 1) return { x: e.deltaX * WHEEL_LINE_PX, y: e.deltaY * WHEEL_LINE_PX };
  if (e.deltaMode === 2) return { x: e.deltaX * screen.width, y: e.deltaY * screen.height };
  return { x: e.deltaX, y: e.deltaY };
}

/** Next viewport for a wheel event; `pointer` is relative to the canvas element. */
export function viewportForWheel(v: Viewport, e: WheelInput, pointer: Point, screen: { width: number; height: number }): Viewport {
  if (e.ctrlKey) return zoomByFactor(v, pointer, Math.exp(-e.deltaY * PINCH_ZOOM_SENSITIVITY));
  let { x, y } = wheelDeltaPx(e, screen);
  if (e.shiftKey && x === 0) {
    x = y;
    y = 0;
  }
  return pan(v, -x, -y);
}
