import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../../src/core/format/parser';
import type { Element } from '../../src/core/model/types';
import { BoardModel } from '../../src/core/ops/model';
import { adoptableChildren, createFrame, defaultStyle, moveFramePatches } from '../../src/core/shapes';

const rectArb = (id: string) =>
  fc
    .record({
      x: fc.integer({ min: -200, max: 400 }),
      y: fc.integer({ min: -200, max: 400 }),
      width: fc.integer({ min: 1, max: 150 }),
      height: fc.integer({ min: 1, max: 150 }),
    })
    .map((r) => ({ id, type: 'rectangle', rotation: 0, style: defaultStyle(), ...r }) as Element);

const scenarioArb = fc.record({
  rects: fc.integer({ min: 0, max: 10 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => rectArb(`r${i}`)))),
  frame: fc.record({
    x: fc.integer({ min: -100, max: 200 }),
    y: fc.integer({ min: -100, max: 200 }),
    width: fc.integer({ min: 20, max: 400 }),
    height: fc.integer({ min: 20, max: 400 }),
  }),
  dx: fc.integer({ min: -1000, max: 1000 }),
  dy: fc.integer({ min: -1000, max: 1000 }),
});

const inside = (f: { x: number; y: number; width: number; height: number }, e: Element) =>
  e.x >= f.x && e.y >= f.y && e.x + e.width <= f.x + f.width && e.y + e.height <= f.y + f.height;

// Feature: openboard, Property 44: Frame children move with the frame
describe('Feature: openboard, Property 44: Frame children move with the frame', () => {
  it('adopts fully-inside elements, and moving the frame moves descendants by the same offset', () => {
    // **Validates: Requirements 6.12**
    fc.assert(
      fc.property(scenarioArb, ({ rects, frame: fb, dx, dy }) => {
        const doc = { ...createEmptyDocument(), elements: [...rects] as Element[] };
        const model = new BoardModel('p44.board', doc);

        const { frame, adopt } = createFrame(fb, rects, { id: 'frame' });
        expect(adoptableChildren(frame, rects).map((e) => e.id)).toEqual(adopt.map((p) => p.id));
        model.transact('create frame', (tx) => {
          tx.create(frame);
          for (const p of adopt) tx.update(p.id, { parentId: p.patch.parentId });
        });

        const expectedIds = new Set(rects.filter((r) => inside(fb, r)).map((r) => r.id));
        const afterCreate = model.getDocument().elements;
        for (const r of rects) {
          const el = afterCreate.find((e) => e.id === r.id)!;
          expect(el.parentId).toBe(expectedIds.has(r.id) ? 'frame' : undefined);
        }

        model.transact('move frame', (tx) => {
          for (const p of moveFramePatches('frame', tx.doc.elements, dx, dy)) {
            tx.update(p.id, { x: p.patch.x as number, y: p.patch.y as number });
          }
        });

        const after = model.getDocument().elements;
        const f = after.find((e) => e.id === 'frame')!;
        expect([f.x, f.y]).toEqual([fb.x + dx, fb.y + dy]);
        for (const r of rects) {
          const el = after.find((e) => e.id === r.id)!;
          if (expectedIds.has(r.id)) {
            expect([el.x, el.y]).toEqual([r.x + dx, r.y + dy]);
          } else {
            expect([el.x, el.y]).toEqual([r.x, r.y]);
          }
          expect([el.width, el.height]).toEqual([r.width, r.height]);
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
