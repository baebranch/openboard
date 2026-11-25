import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { pan, boardToScreen } from '../../src/core/viewport';

// Feature: openboard, Property 30: Pan follows the drag
// **Validates: Requirements 3.3**
describe('Feature: openboard, Property 30: Pan follows the drag', () => {
  const viewportArb = fc.record({
    x: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
    y: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
    zoom: fc.double({ min: 0.02, max: 8, noNaN: true }),
  });
  const dragArb = fc.double({ min: -5000, max: 5000, noNaN: true });

  it('offset changes by the drag vector within 1px, same direction', () => {
    fc.assert(
      fc.property(viewportArb, dragArb, dragArb, (v, dx, dy) => {
        const r = pan(v, dx, dy);
        expect(Math.abs(r.x - v.x - dx)).toBeLessThanOrEqual(1);
        expect(Math.abs(r.y - v.y - dy)).toBeLessThanOrEqual(1);
        expect(r.zoom).toBe(v.zoom);
        // Same direction: sign of the offset change matches the drag sign.
        expect((r.x - v.x) * dx).toBeGreaterThanOrEqual(0);
        expect((r.y - v.y) * dy).toBeGreaterThanOrEqual(0);
        // Content moves with the pointer on screen.
        const p = { x: 10, y: 20 };
        const before = boardToScreen(v, p);
        const after = boardToScreen(r, p);
        expect(Math.abs(after.x - before.x - dx)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.y - before.y - dy)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });
});
