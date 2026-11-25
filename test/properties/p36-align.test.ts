import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../../src/core/model/types';
import { buildFullRegistry, emptyBoardDoc } from '../helpers/registry';

// Feature: openboard, Property 36: Align
// **Validates: Requirements 5.8**

const style = { fill: 'none', stroke: '#000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const arbBox = fc.record({
  x: fc.integer({ min: -500, max: 500 }),
  y: fc.integer({ min: -500, max: 500 }),
  width: fc.integer({ min: 1, max: 200 }),
  height: fc.integer({ min: 1, max: 200 }),
});

const arbAlignment = fc.constantFrom('left', 'center', 'right', 'top', 'middle', 'bottom');

const toDoc = (boxes: Box[]): BoardDocument =>
  ({
    ...emptyBoardDoc(),
    elements: boxes.map(
      (b, i) => ({ id: `e${i}`, type: 'rectangle', ...b, rotation: 0, style }) as unknown as Element,
    ),
  }) as BoardDocument;

const EPS = 1e-6;

describe('Feature: openboard, Property 36: Align', () => {
  it('aligns every selected element to the selection bounds, leaving the other axis and sizes alone', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbBox, { minLength: 2, maxLength: 12 }), arbAlignment, async (boxes, how) => {
        const { registry, model } = buildFullRegistry({ doc: toDoc(boxes) });
        const minX = Math.min(...boxes.map((b) => b.x));
        const minY = Math.min(...boxes.map((b) => b.y));
        const maxX = Math.max(...boxes.map((b) => b.x + b.width));
        const maxY = Math.max(...boxes.map((b) => b.y + b.height));
        const ids = boxes.map((_, i) => `e${i}`);
        const out = (await registry.invoke('openboard.element.arrange', { action: 'align', alignment: how, ids })) as {
          error?: unknown;
        };
        expect(out.error).toBeUndefined();
        const els = model.getDocument().elements as unknown as Box[];
        els.forEach((e, i) => {
          const o = boxes[i] as Box;
          expect(e.width).toBe(o.width);
          expect(e.height).toBe(o.height);
          const horizontal = how === 'left' || how === 'center' || how === 'right';
          if (horizontal) expect(e.y).toBe(o.y);
          else expect(e.x).toBe(o.x);
          switch (how) {
            case 'left':
              expect(Math.abs(e.x - minX)).toBeLessThan(EPS);
              break;
            case 'center':
              expect(Math.abs(e.x + e.width / 2 - (minX + maxX) / 2)).toBeLessThan(EPS);
              break;
            case 'right':
              expect(Math.abs(e.x + e.width - maxX)).toBeLessThan(EPS);
              break;
            case 'top':
              expect(Math.abs(e.y - minY)).toBeLessThan(EPS);
              break;
            case 'middle':
              expect(Math.abs(e.y + e.height / 2 - (minY + maxY) / 2)).toBeLessThan(EPS);
              break;
            case 'bottom':
              expect(Math.abs(e.y + e.height - maxY)).toBeLessThan(EPS);
              break;
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  it('fewer than two elements changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(arbBox, arbAlignment, fc.boolean(), async (box, how, useId) => {
        const { registry, model, history } = buildFullRegistry({ doc: toDoc([box]) });
        const before = JSON.stringify(model.getDocument().elements);
        const undoBefore = history.undoCount();
        const ids = useId ? ['e0'] : [];
        await registry.invoke('openboard.element.arrange', { action: 'align', alignment: how, ids });
        expect(JSON.stringify(model.getDocument().elements)).toBe(before);
        expect(history.undoCount()).toBe(undoBefore);
      }),
      { numRuns: 100 },
    );
  });
});
