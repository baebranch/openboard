import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resizeBounds, type ResizeHandle } from '../../src/core/shapes/shapes';

// Feature: openboard, Property 43: Aspect-ratio resize
// **Validates: Requirements 6.10**
describe('Feature: openboard, Property 43: Aspect-ratio resize', () => {
  const handles: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  it('with Shift the aspect ratio stays within 1% of the original for all handles', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: -1000, max: 1000 }),
          y: fc.integer({ min: -1000, max: 1000 }),
          width: fc.integer({ min: 10, max: 2000 }),
          height: fc.integer({ min: 10, max: 2000 }),
        }),
        fc.constantFrom(...handles),
        fc.integer({ min: -3000, max: 3000 }),
        fc.integer({ min: -3000, max: 3000 }),
        (b, handle, dx, dy) => {
          const r = resizeBounds(b, handle, dx, dy, true);
          const original = b.width / b.height;
          const ratio = r.width / r.height;
          expect(Math.abs(ratio - original) / original).toBeLessThanOrEqual(0.01);
          expect(r.width).toBeGreaterThanOrEqual(1);
          expect(r.height).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
