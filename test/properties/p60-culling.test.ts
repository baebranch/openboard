import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cullToViewport } from '../../src/core/selection';

// Feature: openboard, Property 60: Viewport culling
// **Validates: Requirements 17.2**
describe('Feature: openboard, Property 60: Viewport culling', () => {
  const MARGIN = 256;
  const EPS = 1e-6;
  const num = (min: number, max: number) => fc.double({ min, max, noNaN: true });

  const viewportArb = fc.record({ x: num(-5000, 5000), y: num(-5000, 5000), zoom: num(0.02, 8) });
  const screenArb = fc.record({ width: fc.integer({ min: 100, max: 3000 }), height: fc.integer({ min: 100, max: 3000 }) });
  const elementArb = fc.record({
    x: num(-20000, 20000),
    y: num(-20000, 20000),
    width: num(0, 3000),
    height: num(0, 3000),
  });

  // Screen-space gap between the element and the margin-expanded screen rect
  // (negative = overlap depth, positive = separation).
  function gap(v: { x: number; y: number; zoom: number }, s: { width: number; height: number }, e: { x: number; y: number; width: number; height: number }) {
    const l = e.x * v.zoom + v.x;
    const r = (e.x + e.width) * v.zoom + v.x;
    const t = e.y * v.zoom + v.y;
    const b = (e.y + e.height) * v.zoom + v.y;
    const gx = Math.max(-MARGIN - r, l - (s.width + MARGIN));
    const gy = Math.max(-MARGIN - b, t - (s.height + MARGIN));
    return Math.max(gx, gy);
  }

  it('keeps every intersecting element and drops every element outside the expanded viewport', () => {
    fc.assert(
      fc.property(viewportArb, screenArb, fc.array(elementArb, { maxLength: 40 }), (v, s, els) => {
        const out = cullToViewport(els, v, s);
        const kept = new Set(out);
        for (const e of els) {
          const g = gap(v, s, e);
          if (g < -EPS) expect(kept.has(e)).toBe(true);
          if (g > EPS) expect(kept.has(e)).toBe(false);
        }
        // Result is a subsequence of the input (order preserved, no new items).
        let i = 0;
        for (const o of out) {
          while (i < els.length && els[i] !== o) i++;
          expect(i).toBeLessThan(els.length);
          i++;
        }
      }),
      { numRuns: 100 },
    );
  });
});
