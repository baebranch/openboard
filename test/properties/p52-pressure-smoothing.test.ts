import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { pressureWidth, smoothStroke, type StrokePoint } from '../../src/core/freehand';

function distToSegment(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolyline(p: StrokePoint, path: readonly StrokePoint[]): number {
  if (path.length === 1) return Math.hypot(p.x - path[0]!.x, p.y - path[0]!.y);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, distToSegment(p, path[i - 1]!, path[i]!));
  return best;
}

const stroke = fc
  .tuple(
    fc.double({ min: -500, max: 500, noNaN: true }),
    fc.double({ min: -500, max: 500, noNaN: true }),
    fc.array(
      fc.tuple(fc.double({ min: -6, max: 6, noNaN: true }), fc.double({ min: -6, max: 6, noNaN: true })),
      { minLength: 1, maxLength: 200 },
    ),
  )
  .map(([x0, y0, steps]) => {
    const pts: StrokePoint[] = [{ x: x0, y: y0 }];
    for (const [dx, dy] of steps) {
      const last = pts[pts.length - 1]!;
      pts.push({ x: last.x + dx, y: last.y + dy });
    }
    return pts;
  });

// Feature: openboard, Property 52: Pressure width and smoothing
describe('Feature: openboard, Property 52: Pressure width and smoothing', () => {
  it('pressure width is within 25%-200% of base and proportional to pressure', () => {
    // **Validates: Requirements 9.4**
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (base, p1, p2) => {
          const w1 = pressureWidth(base, p1);
          const w2 = pressureWidth(base, p2);
          const eps = 1e-9 * base;
          expect(w1).toBeGreaterThanOrEqual(0.25 * base - eps);
          expect(w1).toBeLessThanOrEqual(2 * base + eps);
          // monotone: more pressure never yields a thinner line
          if (p1 <= p2) expect(w1).toBeLessThanOrEqual(w2 + eps);
          // proportional to pressure where not clamped by the lower bound
          if (p1 >= 0.125) expect(w1).toBeCloseTo(base * 2 * p1, 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('smoothed path stays within 2 px of the input path in both directions', () => {
    // **Validates: Requirements 9.5**
    fc.assert(
      fc.property(stroke, (input) => {
        const out = smoothStroke(input);
        const tol = 2 + 1e-6;
        for (const p of out) expect(distToPolyline(p, input)).toBeLessThanOrEqual(tol);
        for (const p of input) expect(distToPolyline(p, out)).toBeLessThanOrEqual(tol);
        // endpoints preserved
        expect(out[0]).toMatchObject({ x: input[0]!.x, y: input[0]!.y });
        expect(out[out.length - 1]).toMatchObject({
          x: input[input.length - 1]!.x,
          y: input[input.length - 1]!.y,
        });
      }),
      { numRuns: 200 },
    );
  });
});
