import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { constrainToAngle, finalizeStroke, type StrokePoint } from '../../src/core/freehand';

const DEG = 180 / Math.PI;
const EPS = 1e-6;

const coord = fc.integer({ min: -2000, max: 2000 });
const pt = fc.record({ x: coord, y: coord });

/** Smallest absolute difference between two angles in degrees, in [0, 180]. */
function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function check(start: StrokePoint, cur: StrokePoint, out: StrokePoint): void {
  const rawAngle = Math.atan2(cur.y - start.y, cur.x - start.x) * DEG;
  const outAngle = Math.atan2(out.y - start.y, out.x - start.x) * DEG;
  // Constrained line angle is a multiple of 15 degrees.
  const rem = Math.abs(outAngle / 15 - Math.round(outAngle / 15));
  expect(rem).toBeLessThan(EPS);
  // And it is the nearest multiple: within 7.5 degrees of the raw angle.
  expect(angDiff(outAngle, rawAngle)).toBeLessThanOrEqual(7.5 + EPS);
  // Length from the press point is preserved.
  expect(Math.hypot(out.x - start.x, out.y - start.y)).toBeCloseTo(Math.hypot(cur.x - start.x, cur.y - start.y), 6);
}

describe('Feature: openboard, Property 54: Shift-constrained strokes', () => {
  it('constrainToAngle snaps to the nearest multiple of 15 degrees from the press point', () => {
    // **Validates: Requirements 9.9**
    fc.assert(
      fc.property(
        pt,
        pt.filter((p) => p.x !== 0 || p.y !== 0),
        (start, delta) => {
          const cur = { x: start.x + delta.x, y: start.y + delta.y };
          check(start, cur, constrainToAngle(start, cur));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('finalizeStroke with shift yields a straight snapped line from the press point', () => {
    // **Validates: Requirements 9.9**
    fc.assert(
      fc.property(
        pt,
        fc.array(pt, { minLength: 0, maxLength: 10 }),
        pt.filter((p) => p.x !== 0 || p.y !== 0),
        (start, middle, delta) => {
          const last = { x: start.x + delta.x, y: start.y + delta.y };
          const samples = [start, ...middle, last];
          const out = finalizeStroke(samples, { shift: true })!;
          expect(out).toHaveLength(2);
          expect(out[0]).toEqual(start);
          check(start, last, out[1]!);
        },
      ),
      { numRuns: 200 },
    );
  });
});
