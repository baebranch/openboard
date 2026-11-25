import fc from 'fast-check';
import { describe, it } from 'vitest';
import { snapToAlignment, type SnapRect } from '../../src/core/snap';

const rectArb = fc.record({
  x: fc.integer({ min: -200, max: 200 }),
  y: fc.integer({ min: -200, max: 200 }),
  width: fc.integer({ min: 1, max: 50 }).map((n) => n * 2),
  height: fc.integer({ min: 1, max: 50 }).map((n) => n * 2),
});
const zoomArb = fc.constantFrom(0.5, 1, 2, 4);

const anchors = (min: number, size: number): number[] => [min, min + size / 2, min + size];

/** Smallest |target - dragged| over all anchor pairs, or Infinity when no others. */
function minDist(dragged: number[], others: number[][]): number {
  let best = Infinity;
  for (const d of dragged) for (const o of others) for (const t of o) best = Math.min(best, Math.abs(t - d));
  return best;
}

// Feature: openboard, Property 33: Alignment snapping
describe('Feature: openboard, Property 33: Alignment snapping', () => {
  it('snaps and shows a guide within 8 screen px; otherwise unchanged with no guide', () => {
    // **Validates: Requirements 5.11**
    fc.assert(
      fc.property(rectArb, fc.array(rectArb, { maxLength: 5 }), zoomArb, (dragged, others: SnapRect[], zoom) => {
        const threshold = 8 / zoom;
        const r = snapToAlignment(dragged, others, zoom);

        const axes = [
          { key: 'x' as const, size: 'width' as const, axis: 'vertical' as const },
          { key: 'y' as const, size: 'height' as const, axis: 'horizontal' as const },
        ];
        for (const a of axes) {
          const dAnch = anchors(dragged[a.key], dragged[a.size]);
          const oAnch = others.map((o) => anchors(o[a.key], o[a.size]));
          const dist = minDist(dAnch, oAnch);
          const guides = r.guides.filter((g) => g.axis === a.axis);
          if (dist <= threshold) {
            const mine = anchors(r[a.key], dragged[a.size]);
            const coincides = mine.some((m) => oAnch.some((o) => o.some((t) => Math.abs(t - m) < 1e-6)));
            if (!coincides) return false;
            if (guides.length === 0) return false;
            if (!guides.every((g) => mine.some((m) => Math.abs(m - g.position) < 1e-6))) return false;
          } else {
            if (r[a.key] !== dragged[a.key]) return false;
            if (guides.length !== 0) return false;
          }
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('exactly 8 px snaps, just beyond does not', () => {
    // **Validates: Requirements 5.11**
    fc.assert(
      fc.property(rectArb, zoomArb, fc.boolean(), (base, zoom, beyond) => {
        const other: SnapRect = { x: 1000, y: 1000, width: 20, height: 20 };
        const offset = 8 / zoom + (beyond ? 0.25 : 0);
        // place dragged left edge `offset` canvas units left of other's left edge
        const dragged = { ...base, x: other.x - offset, width: 0 };
        const r = snapToAlignment(dragged, [other], zoom);
        const hasV = r.guides.some((g) => g.axis === 'vertical');
        return beyond ? r.x === dragged.x && !hasV : r.x === other.x && hasV;
      }),
      { numRuns: 100 },
    );
  });
});
