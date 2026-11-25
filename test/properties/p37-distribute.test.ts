import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../../src/core/model/types';
import { buildFullRegistry, emptyBoardDoc } from '../helpers/registry';

const EPS = 1e-6;
const ROUND_TOL = 0.01 + EPS;
const style = { fill: 'none', stroke: '#000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };

interface Item {
  main: number; // position along the axis
  size: number;
  cross: number;
  crossSize: number;
}

/** Items laid out left-to-right with non-negative gaps (strictly increasing positions), then shuffled. */
const itemsArb = (min: number, max: number) =>
  fc
    .array(
      fc.record({
        gap: fc.integer({ min: 0, max: 100 }),
        size: fc.integer({ min: 1, max: 80 }),
        cross: fc.integer({ min: -300, max: 300 }),
        crossSize: fc.integer({ min: 1, max: 80 }),
      }),
      { minLength: min, maxLength: max },
    )
    .chain((raw) => {
      let cursor = 0;
      const items: Item[] = raw.map((r) => {
        cursor += r.gap;
        const it: Item = { main: cursor, size: r.size, cross: r.cross, crossSize: r.crossSize };
        cursor += r.size;
        return it;
      });
      return fc.shuffledSubarray(items, { minLength: items.length, maxLength: items.length });
    });

const toElement = (it: Item, i: number, horizontal: boolean): Element =>
  ({
    id: `e${i}`,
    type: 'rectangle',
    x: horizontal ? it.main : it.cross,
    y: horizontal ? it.cross : it.main,
    width: horizontal ? it.size : it.crossSize,
    height: horizontal ? it.crossSize : it.size,
    rotation: 0,
    style,
  }) as unknown as Element;

function setup(items: Item[], horizontal: boolean) {
  const doc: BoardDocument = { ...emptyBoardDoc(), elements: items.map((it, i) => toElement(it, i, horizontal)) };
  const h = buildFullRegistry({ doc });
  const ids = items.map((_, i) => `e${i}`);
  const get = (id: string) => h.model.getDocument().elements.find((e) => e.id === id) as Element;
  return { h, ids, get };
}

// Feature: openboard, Property 37: Distribute
describe('Feature: openboard, Property 37: Distribute', () => {
  for (const direction of ['horizontal', 'vertical'] as const) {
    const horizontal = direction === 'horizontal';
    const pos = (e: Element) => (horizontal ? e.x : e.y);
    const size = (e: Element) => (horizontal ? e.width : e.height);
    const cross = (e: Element) => (horizontal ? e.y : e.x);

    it(`>=3 elements: outer two fixed, equal gaps, order and cross axis preserved (${direction})`, async () => {
      // **Validates: Requirements 5.9**
      await fc.assert(
        fc.asyncProperty(itemsArb(3, 8), async (items) => {
          const { h, ids, get } = setup(items, horizontal);
          const before = new Map(ids.map((id) => [id, { ...get(id) }]));
          const order = [...ids].sort((a, b) => pos(before.get(a)!) - pos(before.get(b)!));

          await h.registry.invoke('openboard.element.arrange', { action: 'distribute', ids, direction });

          const after = order.map((id) => get(id));
          const first = before.get(order[0]!)!;
          const last = before.get(order[order.length - 1]!)!;
          expect(pos(after[0]!)).toBeCloseTo(pos(first), 6);
          expect(pos(after[after.length - 1]!)).toBeCloseTo(pos(last), 6);

          const gaps: number[] = [];
          for (let i = 1; i < after.length; i++) {
            gaps.push(pos(after[i]!) - (pos(after[i - 1]!) + size(after[i - 1]!)));
            expect(pos(after[i]!)).toBeGreaterThanOrEqual(pos(after[i - 1]!) - EPS);
          }
          // The model stores coordinates rounded to 2 decimals (round2), so each gap may differ by <= 0.01.
          for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(ROUND_TOL);

          for (const id of ids) {
            const b = before.get(id)!;
            const a = get(id);
            expect(Math.abs(cross(a) - cross(b))).toBeLessThanOrEqual(EPS);
            expect(a.width).toBe(b.width);
            expect(a.height).toBe(b.height);
          }
        }),
        { numRuns: 100 },
      );
    });

    it(`<3 elements: no change and no history entry (${direction})`, async () => {
      // **Validates: Requirements 5.9**
      await fc.assert(
        fc.asyncProperty(itemsArb(1, 2), async (items) => {
          const { h, ids } = setup(items, horizontal);
          const docBefore = JSON.stringify(h.model.getDocument().elements);
          const undoBefore = h.history.undoCount();
          await h.registry.invoke('openboard.element.arrange', { action: 'distribute', ids, direction });
          expect(JSON.stringify(h.model.getDocument().elements)).toBe(docBefore);
          expect(h.history.undoCount()).toBe(undoBefore);
        }),
        { numRuns: 100 },
      );
    });
  }
});
