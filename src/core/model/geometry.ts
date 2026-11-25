import type { Bounds, Point } from './types';

export function boundsOf(el: Bounds): Bounds {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

export function right(b: Bounds): number {
  return b.x + b.width;
}

export function bottom(b: Bounds): number {
  return b.y + b.height;
}

export function center(b: Bounds): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Combined bounds of all boxes, or undefined when the list is empty. */
export function unionBounds(items: readonly Bounds[]): Bounds | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of items) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, right(b));
    maxY = Math.max(maxY, bottom(b));
  }
  if (minX === Infinity) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned bounds of a box rotated about its center (rotation in degrees). */
export function rotatedBounds(b: Bounds & { rotation?: number }): Bounds {
  const rad = ((b.rotation ?? 0) * Math.PI) / 180;
  if (rad === 0) return boundsOf(b);
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = b.width * cos + b.height * sin;
  const height = b.width * sin + b.height * cos;
  const c = center(b);
  return { x: c.x - width / 2, y: c.y - height / 2, width, height };
}

export function containsPoint(b: Bounds, p: Point): boolean {
  return p.x >= b.x && p.x <= right(b) && p.y >= b.y && p.y <= bottom(b);
}

/** True when `inner` lies fully inside `outer` (edges may touch). */
export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer)
  );
}

/** True when the boxes overlap or touch. */
export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= right(b) && right(a) >= b.x && a.y <= bottom(b) && bottom(a) >= b.y;
}

export function translate(b: Bounds, dx: number, dy: number): Bounds {
  return { ...b, x: b.x + dx, y: b.y + dy };
}
