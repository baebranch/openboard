import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_SIDE, replaceImageSource, sizeForNaturalDimensions } from '../../src/core/image';

// Feature: openboard, Property 47: Image sizing
// **Validates: Requirements 7.5, 7.9**

const dim = fc.integer({ min: 1, max: 20000 });

describe('Feature: openboard, Property 47: Image sizing', () => {
  it('uses natural size when within the cap, else caps the longer side preserving aspect ratio', () => {
    fc.assert(
      fc.property(dim, dim, (w, h) => {
        const s = sizeForNaturalDimensions(w, h);
        if (Math.max(w, h) <= MAX_IMAGE_SIDE) {
          expect(s).toEqual({ width: w, height: h });
        } else {
          expect(Math.max(s.width, s.height)).toBeCloseTo(MAX_IMAGE_SIDE, 9);
          expect(s.width).toBeLessThanOrEqual(MAX_IMAGE_SIDE + 1e-9);
          expect(s.height).toBeLessThanOrEqual(MAX_IMAGE_SIDE + 1e-9);
          expect(s.width / s.height).toBeCloseTo(w / h, 6);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('replace-source keeps position, rotation, width and adjusts height to the new aspect ratio', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
          y: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
          rotation: fc.double({ min: -360, max: 360, noNaN: true }),
          width: fc.double({ min: 1, max: 5000, noNaN: true }),
          height: fc.double({ min: 1, max: 5000, noNaN: true }),
        }),
        dim,
        dim,
        (el, nw, nh) => {
          const r = replaceImageSource(el, { width: nw, height: nh });
          expect(r.x).toBe(el.x);
          expect(r.y).toBe(el.y);
          expect(r.rotation).toBe(el.rotation);
          expect(r.width).toBe(el.width);
          expect(r.height / r.width).toBeCloseTo(nh / nw, 6);
        },
      ),
      { numRuns: 200 },
    );
  });
});
