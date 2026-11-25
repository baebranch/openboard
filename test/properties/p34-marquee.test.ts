import fc from 'fast-check';
import { describe, it } from 'vitest';
import { marqueeSelect } from '../../src/core/selection';
import type { Element } from '../../src/core/model/types';

const elementArb = (id: string) =>
  fc.record({
    x: fc.integer({ min: -200, max: 200 }),
    y: fc.integer({ min: -200, max: 200 }),
    width: fc.integer({ min: 0, max: 100 }),
    height: fc.integer({ min: 0, max: 100 }),
    locked: fc.boolean(),
  }).map((r) => ({ id, type: 'rectangle', ...r }) as unknown as Element);

const elementsArb = fc
  .integer({ min: 0, max: 12 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => elementArb(`e${i}`))));

const marqueeArb = fc.record({
  x: fc.integer({ min: -250, max: 250 }),
  y: fc.integer({ min: -250, max: 250 }),
  width: fc.integer({ min: 0, max: 300 }),
  height: fc.integer({ min: 0, max: 300 }),
});

const expectedHits = (els: readonly Element[], m: { x: number; y: number; width: number; height: number }) =>
  els
    .filter(
      (e) =>
        !e.locked &&
        Math.min(e.x + e.width, m.x + m.width) - Math.max(e.x, m.x) >= 1 &&
        Math.min(e.y + e.height, m.y + m.height) - Math.max(e.y, m.y) >= 1,
    )
    .map((e) => e.id);

// Feature: openboard, Property 34: Marquee selection
describe('Feature: openboard, Property 34: Marquee selection', () => {
  it('replaces selection with unlocked elements overlapping by >= 1px; Shift unions with previous', () => {
    // **Validates: Requirements 5.4**
    fc.assert(
      fc.property(
        elementsArb,
        marqueeArb,
        fc.uniqueArray(fc.integer({ min: 0, max: 14 }), { maxLength: 8 }),
        (els, m, prevIdx) => {
          const previous = prevIdx.map((i) => `e${i}`);
          const hits = expectedHits(els, m);

          const replaced = marqueeSelect(els, m, previous, false);
          if (replaced.length !== hits.length || !hits.every((id) => replaced.includes(id))) return false;

          const unioned = marqueeSelect(els, m, previous, true);
          const want = new Set([...previous, ...hits]);
          return unioned.length === want.size && unioned.every((id) => want.has(id));
        },
      ),
      { numRuns: 200 },
    );
  });
});
