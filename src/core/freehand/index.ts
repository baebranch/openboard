/**
 * Pure freehand stroke logic (Req 9.2-9.6, 9.9). No DOM or VS Code dependencies.
 */

export interface StrokePoint {
  x: number;
  y: number;
  /** Pointer pressure, 0..1, when the device reports it. */
  p?: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const SMOOTHING_TOLERANCE_PX = 2;
export const MIN_PRESSURE_FACTOR = 0.25;
export const MAX_PRESSURE_FACTOR = 2;
export const SHIFT_SNAP_DEGREES = 15;

/** Perpendicular distance from point to the segment a-b. */
function distToSegment(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Smooth (simplify) a stroke with Douglas-Peucker. Every removed input point lies within
 * `tolerance` of the output path and, because the input between kept points is a connected
 * curve inside that strip, every output point lies within `tolerance` of the input path.
 * Tolerance is capped at 2 px (Req 9.5). Endpoints are preserved.
 */
export function smoothStroke(
  points: readonly StrokePoint[],
  tolerance: number = SMOOTHING_TOLERANCE_PX,
): StrokePoint[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const eps = Math.max(0, Math.min(tolerance, SMOOTHING_TOLERANCE_PX));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(points[i]!, points[lo]!, points[hi]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > eps) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ ...p }));
}

/**
 * Rendered width for a pressure sample: proportional to pressure (1.0 pressure = 200%),
 * clamped to 25%..200% of the base width (Req 9.4). Missing pressure yields the base width.
 */
export function pressureWidth(baseWidth: number, pressure?: number): number {
  if (pressure === undefined || !Number.isFinite(pressure)) return baseWidth;
  const factor = Math.max(MIN_PRESSURE_FACTOR, Math.min(MAX_PRESSURE_FACTOR, pressure * MAX_PRESSURE_FACTOR));
  return baseWidth * factor;
}

/** Constrain `current` to a straight line from `start`, snapped to the nearest 15 degrees (Req 9.9). */
export function constrainToAngle(start: StrokePoint, current: StrokePoint): StrokePoint {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { ...current };
  const step = (SHIFT_SNAP_DEGREES * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const out: StrokePoint = { x: start.x + dist * Math.cos(angle), y: start.y + dist * Math.sin(angle) };
  if (current.p !== undefined) out.p = current.p;
  return out;
}

/**
 * Build the final point list for a stroke on pointer release.
 * - Fewer than 2 sampled points: a single-dot stroke at the press position (Req 9.3).
 * - Shift held: a straight line from the press position to the last pointer position, snapped (Req 9.9).
 * - Otherwise: the smoothed path (Req 9.5).
 * Returns null if there is no press position at all.
 */
export function finalizeStroke(
  samples: readonly StrokePoint[],
  options: { shift?: boolean } = {},
): StrokePoint[] | null {
  if (samples.length === 0) return null;
  if (samples.length < 2) return [{ ...samples[0]! }];
  if (options.shift) {
    const start = samples[0]!;
    return [{ ...start }, constrainToAngle(start, samples[samples.length - 1]!)];
  }
  return smoothStroke(samples);
}

/** True if segment a-b intersects the axis-aligned rectangle (Liang-Barsky). */
function segmentIntersectsBounds(a: StrokePoint, b: StrokePoint, r: Bounds): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a.x - r.x) &&
    clip(dx, r.x + r.width - a.x) &&
    clip(-dy, a.y - r.y) &&
    clip(dy, r.y + r.height - a.y)
  );
}

/** True if the pointer path touches the bounds. A single-point path is a point hit test. */
export function pathIntersectsBounds(path: readonly StrokePoint[], bounds: Bounds): boolean {
  if (path.length === 0) return false;
  if (path.length === 1) return segmentIntersectsBounds(path[0]!, path[0]!, bounds);
  for (let i = 1; i < path.length; i++) {
    if (segmentIntersectsBounds(path[i - 1]!, path[i]!, bounds)) return true;
  }
  return false;
}

/**
 * Ids of every element whose rendered bounds intersect the eraser pointer path (Req 9.6).
 * The caller deletes them all in one undoable action per drag.
 */
export function eraseIntersecting(
  path: readonly StrokePoint[],
  elements: ReadonlyArray<{ id: string; bounds: Bounds }>,
): string[] {
  return elements.filter((e) => pathIntersectsBounds(path, e.bounds)).map((e) => e.id);
}
