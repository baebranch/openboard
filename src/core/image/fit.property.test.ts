import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { fitImage } from './fit';

// Feature: mockup-design-features, Property 13: Image fill fit-mode geometry
// **Validates: Requirements 9.3, 9.4, 9.5**

const dim = fc.integer({ min: 1, max: 5000 });
const coord = fc.integer({ min: -5000, max: 5000 });
const boxArb = fc.record({ x: coord, y: coord, width: dim, height: dim });
const EPS = 1e-6;

describe('Property 13: Image fill fit-mode geometry', () => {
  it('cover: both dims >= box, smallest uniform scale, aspect preserved, centered', () => {
    fc.assert(
      fc.property(dim, dim, boxArb, (w, h, box) => {
        const r = fitImage(w, h, box, 'cover');
        expect(r.width).toBeGreaterThanOrEqual(box.width - EPS);
        expect(r.height).toBeGreaterThanOrEqual(box.height - EPS);
        const s = r.width / w;
        expect(Math.abs(r.height / h - s)).toBeLessThan(1e-9 * Math.max(1, s));
        // smallest: at least one dimension matches the box exactly
        const tight = Math.abs(r.width - box.width) < EPS || Math.abs(r.height - box.height) < EPS;
        expect(tight).toBe(true);
        expect(Math.abs(r.x + r.width / 2 - (box.x + box.width / 2))).toBeLessThan(EPS);
        expect(Math.abs(r.y + r.height / 2 - (box.y + box.height / 2))).toBeLessThan(EPS);
      }),
      { numRuns: 200 },
    );
  });

  it('contain: both dims <= box, largest uniform scale, aspect preserved, centered', () => {
    fc.assert(
      fc.property(dim, dim, boxArb, (w, h, box) => {
        const r = fitImage(w, h, box, 'contain');
        expect(r.width).toBeLessThanOrEqual(box.width + EPS);
        expect(r.height).toBeLessThanOrEqual(box.height + EPS);
        const s = r.width / w;
        expect(Math.abs(r.height / h - s)).toBeLessThan(1e-9 * Math.max(1, s));
        const tight = Math.abs(r.width - box.width) < EPS || Math.abs(r.height - box.height) < EPS;
        expect(tight).toBe(true);
        expect(Math.abs(r.x + r.width / 2 - (box.x + box.width / 2))).toBeLessThan(EPS);
        expect(Math.abs(r.y + r.height / 2 - (box.y + box.height / 2))).toBeLessThan(EPS);
      }),
      { numRuns: 200 },
    );
  });

  it('stretch: equals the box exactly', () => {
    fc.assert(
      fc.property(dim, dim, boxArb, (w, h, box) => {
        expect(fitImage(w, h, box, 'stretch')).toEqual(box);
      }),
      { numRuns: 200 },
    );
  });
});
