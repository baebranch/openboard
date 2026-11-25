import fc from 'fast-check';
import { describe, it } from 'vitest';
import { snapToGrid } from '../../src/core/snap';

// Feature: openboard, Property 32: Grid snapping
describe('Feature: openboard, Property 32: Grid snapping', () => {
  it('returns a multiple of spacing that is a nearest multiple', () => {
    // **Validates: Requirements 3.11**
    fc.assert(
      fc.property(
        fc.double({ min: -10000, max: 10000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 4, max: 200 }),
        (value, spacing) => {
          const r = snapToGrid(value, spacing);
          const k = Math.round(r / spacing);
          const eps = 1e-6;
          if (Math.abs(r - k * spacing) > eps) return false;
          // distance to result must not exceed half spacing (nearest multiple, ties either way)
          return Math.abs(value - r) <= spacing / 2 + eps;
        },
      ),
      { numRuns: 200 },
    );
  });
});
