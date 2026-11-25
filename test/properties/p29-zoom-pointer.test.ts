import fc from 'fast-check';
import { describe, it } from 'vitest';
import { boardToScreen, screenToBoard, zoomByFactor } from '../../src/core/viewport/viewport';

// Feature: openboard, Property 29: Zoom keeps the pointer point fixed
describe('Property 29: Zoom keeps the pointer point fixed', () => {
  it('board point under the pointer stays within 1px after zoom', () => {
    // **Validates: Requirements 3.2**
    const coord = fc.double({ min: -5000, max: 5000, noNaN: true });
    fc.assert(
      fc.property(
        coord,
        coord,
        fc.double({ min: 0.05, max: 7, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        (x, y, zoom, px, py, factor) => {
          const v = { x, y, zoom };
          const pointer = { x: px, y: py };
          const before = boardToScreen(v, screenToBoard(v, pointer));
          const next = zoomByFactor(v, pointer, factor);
          const after = boardToScreen(next, screenToBoard(v, pointer));
          return Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1;
        },
      ),
      { numRuns: 200 },
    );
  });
});
