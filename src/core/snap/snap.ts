/** Pure grid and alignment snapping math (Requirements 3.11, 5.11). */

export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuide {
  /** 'vertical' guide is a line at constant x; 'horizontal' at constant y. */
  axis: 'vertical' | 'horizontal';
  /** Coordinate of the line on the guide's constant axis (canvas units). */
  position: number;
  /** Extent along the line (canvas units). */
  start: number;
  end: number;
}

export interface AlignmentSnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

export const ALIGNMENT_SNAP_THRESHOLD_PX = 8;

/** Nearest multiple of `spacing` to `value` (ties round up). */
export function snapToGrid(value: number, spacing: number): number {
  if (!(spacing > 0) || !Number.isFinite(value)) return value;
  const r = Math.round(value / spacing) * spacing;
  return r === 0 ? 0 : r; // normalize -0
}

export function snapPointToGrid(
  point: { x: number; y: number },
  spacing: number,
): { x: number; y: number } {
  return { x: snapToGrid(point.x, spacing), y: snapToGrid(point.y, spacing) };
}

const anchors = (min: number, size: number): number[] => [min, min + size / 2, min + size];

interface AxisSnap {
  delta: number;
  found: boolean;
}

function bestDelta(dragged: number[], others: number[][], threshold: number): AxisSnap {
  let best = Infinity;
  for (const d of dragged) {
    for (const o of others) {
      for (const t of o) {
        const delta = t - d;
        if (Math.abs(delta) <= threshold && Math.abs(delta) < Math.abs(best)) best = delta;
      }
    }
  }
  return best === Infinity ? { delta: 0, found: false } : { delta: best, found: true };
}

/**
 * Snap a dragged rect to edges/centers of other rects when within
 * `thresholdPx` screen pixels (converted to canvas units using `zoom`).
 * Returns the (possibly) snapped top-left position and the guides to show.
 */
export function snapToAlignment(
  dragged: SnapRect,
  others: readonly SnapRect[],
  zoom: number,
  thresholdPx: number = ALIGNMENT_SNAP_THRESHOLD_PX,
): AlignmentSnapResult {
  const threshold = thresholdPx / (zoom > 0 ? zoom : 1);
  const xs = others.map((o) => anchors(o.x, o.width));
  const ys = others.map((o) => anchors(o.y, o.height));
  const sx = bestDelta(anchors(dragged.x, dragged.width), xs, threshold);
  const sy = bestDelta(anchors(dragged.y, dragged.height), ys, threshold);
  const x = dragged.x + sx.delta;
  const y = dragged.y + sy.delta;
  const guides: SnapGuide[] = [];
  const eps = 1e-9;
  const snapped: SnapRect = { x, y, width: dragged.width, height: dragged.height };

  if (sx.found) {
    const mine = anchors(x, snapped.width);
    others.forEach((o, i) => {
      for (const t of xs[i]!) {
        if (mine.some((m) => Math.abs(m - t) <= eps)) {
          guides.push({
            axis: 'vertical',
            position: t,
            start: Math.min(snapped.y, o.y),
            end: Math.max(snapped.y + snapped.height, o.y + o.height),
          });
        }
      }
    });
  }
  if (sy.found) {
    const mine = anchors(y, snapped.height);
    others.forEach((o, i) => {
      for (const t of ys[i]!) {
        if (mine.some((m) => Math.abs(m - t) <= eps)) {
          guides.push({
            axis: 'horizontal',
            position: t,
            start: Math.min(snapped.x, o.x),
            end: Math.max(snapped.x + snapped.width, o.x + o.width),
          });
        }
      }
    });
  }
  return { x, y, guides };
}
