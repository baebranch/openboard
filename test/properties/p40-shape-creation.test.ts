import fc from 'fast-check';
import { describe, it } from 'vitest';
import { boundsFromDrag, createShapeFromDrag } from '../../src/core/shapes';

const coord = fc.double({ min: -5000, max: 5000, noNaN: true, noDefaultInfinity: true });
const point = fc.record({ x: coord, y: coord });
const shapeType = fc.constantFrom('rectangle', 'ellipse', 'diamond' as const);

// Feature: openboard, Property 40: Shape creation from a drag
describe('Feature: openboard, Property 40: Shape creation from a drag', () => {
  it('large drags match the dragged region in any direction', () => {
    // **Validates: Requirements 6.1**
    fc.assert(
      fc.property(
        point,
        fc.double({ min: 4, max: 3000, noNaN: true }),
        fc.double({ min: 4, max: 3000, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        shapeType,
        (start, w, h, flipX, flipY, type) => {
          const end = { x: start.x + (flipX ? -w : w), y: start.y + (flipY ? -h : h) };
          const region = {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
          };
          if (region.width < 4 || region.height < 4) return true; // float rounding at boundary
          const shape = createShapeFromDrag(type, start, end, 'id1');
          const b = boundsFromDrag(start, end);
          return [b, shape].every(
            (r) =>
              Math.abs(r.x - region.x) <= 1 &&
              Math.abs(r.y - region.y) <= 1 &&
              Math.abs(r.width - region.width) <= 1 &&
              Math.abs(r.height - region.height) <= 1,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('tiny drags yield 100x100 centered on the release point', () => {
    // **Validates: Requirements 6.2**
    fc.assert(
      fc.property(
        point,
        fc.double({ min: -3.99, max: 3.99, noNaN: true }),
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        fc.boolean(),
        shapeType,
        (end, small, other, smallIsX, type) => {
          const start = smallIsX
            ? { x: end.x + small, y: end.y + other }
            : { x: end.x + other, y: end.y + small };
          const w = Math.abs(end.x - start.x);
          const h = Math.abs(end.y - start.y);
          if (w >= 4 && h >= 4) return true; // rounding guard
          const shape = createShapeFromDrag(type, start, end, 'id1');
          return (
            shape.width === 100 &&
            shape.height === 100 &&
            Math.abs(shape.x + 50 - end.x) <= 1e-6 &&
            Math.abs(shape.y + 50 - end.y) <= 1e-6
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
