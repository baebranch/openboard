import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../../src/core/model/types';
import { buildFullRegistry, emptyBoardDoc } from '../helpers/registry';

const style = { fill: 'none', stroke: '#000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const FRAMES = 3;

const coord = fc.integer({ min: -500, max: 500 });

const scenarioArb = fc.record({
  frames: fc.array(fc.tuple(coord, coord), { minLength: FRAMES, maxLength: FRAMES }),
  rects: fc.array(
    fc.record({ x: coord, y: coord, parent: fc.option(fc.integer({ min: 0, max: FRAMES - 1 }), { nil: undefined }) }),
    { maxLength: 8 },
  ),
  selectFrames: fc.array(fc.boolean(), { minLength: FRAMES, maxLength: FRAMES }),
  selectRects: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
  dir: fc.constantFrom<[number, number]>([1, 0], [-1, 0], [0, 1], [0, -1]),
  shift: fc.boolean(),
});

describe('Feature: openboard, Property 39: Keyboard nudge', () => {
  it('nudges selected elements (and frame descendants) by 1 or 10 in one undoable entry', async () => {
    // **Validates: Requirements 5.13**
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const elements: Element[] = [
          ...s.frames.map(
            ([x, y], i) => ({ id: `f${i}`, type: 'frame', x, y, width: 100, height: 100, rotation: 0, style }) as unknown as Element,
          ),
          ...s.rects.map(
            (r, i) =>
              ({
                id: `r${i}`,
                type: 'rectangle',
                x: r.x,
                y: r.y,
                width: 10,
                height: 10,
                rotation: 0,
                style,
                ...(r.parent === undefined ? {} : { parentId: `f${r.parent}` }),
              }) as unknown as Element,
          ),
        ];
        const doc: BoardDocument = { ...emptyBoardDoc(), elements };
        const { registry, model, history } = buildFullRegistry({ doc });
        const before = structuredClone(model.getDocument().elements);

        const selected = new Set<string>([
          ...s.frames.map((_, i) => `f${i}`).filter((_, i) => s.selectFrames[i]),
          ...s.rects.map((_, i) => `r${i}`).filter((_, i) => s.selectRects[i]),
        ]);
        const moving = new Set(selected);
        for (const e of before) {
          if (e.parentId && selected.has(e.parentId)) moving.add(e.id);
        }
        const amount = s.shift ? 10 : 1;
        const [dx, dy] = s.dir;
        const undoBefore = history.undoCount();

        const out: any = await registry.invoke('openboard.element.arrange', {
          action: 'nudge',
          ids: [...selected],
          dx,
          dy,
          ...(s.shift ? { amount: 10 } : {}),
        });

        const after = model.getDocument().elements;
        if (selected.size === 0) {
          expect(out.changed).toBe(false);
          expect(history.undoCount()).toBe(undoBefore);
          expect(after).toEqual(before);
          return true;
        }
        expect(out.changed).toBe(true);
        for (const b of before) {
          const a = after.find((e) => e.id === b.id)!;
          const m = moving.has(b.id);
          expect([a.x, a.y]).toEqual(m ? [b.x + dx * amount, b.y + dy * amount] : [b.x, b.y]);
          expect([a.width, a.height]).toEqual([b.width, b.height]);
        }
        expect(history.undoCount()).toBe(undoBefore + 1);
        expect(history.undo(model)).toBe(true);
        expect(model.getDocument().elements).toEqual(before);
        return true;
      }),
      { numRuns: 150 },
    );
  });
});
