import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { arrangeStack, type StackChildInput } from './stack';
import type { LayoutConfig } from './types';

/** Feature: mockup-design-features, Property 26: Layout_Pass placement algebra */

const round = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100 + 0;
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 0.011;

const spacing = fc.integer({ min: 0, max: 40 });
const layoutArb: fc.Arbitrary<LayoutConfig> = fc.record({
  direction: fc.constantFrom('horizontal', 'vertical'),
  gap: spacing,
  padding: fc.record({ top: spacing, right: spacing, bottom: spacing, left: spacing }),
  mainAlign: fc.constantFrom('start', 'center', 'end', 'spaceBetween'),
  crossAlign: fc.constantFrom('start', 'center', 'end'),
});
const childrenArb = fc
  .array(
    fc.record({
      x: fc.integer({ min: -200, max: 400 }),
      y: fc.integer({ min: -200, max: 400 }),
      width: fc.integer({ min: 1, max: 120 }),
      height: fc.integer({ min: 1, max: 120 }),
      ignoreLayout: fc.boolean(),
    }),
    { maxLength: 8 },
  )
  .map((cs) => cs.map((c, i): StackChildInput => ({ id: `c${i}`, ...c })));
const frameArb = fc.record({
  width: fc.integer({ min: 50, max: 600 }),
  height: fc.integer({ min: 50, max: 600 }),
  x: fc.integer({ min: -100, max: 100 }),
  y: fc.integer({ min: -100, max: 100 }),
});

describe('Property 26: Layout_Pass placement algebra', () => {
  /**
   * **Validates: Requirements 19.2, 19.3, 19.4, 19.5, 19.6**
   */
  it('positions satisfy ordering, main-axis and cross-axis alignment formulas', () => {
    fc.assert(
      fc.property(layoutArb, frameArb, childrenArb, (layout, f, kids) => {
        const res = arrangeStack({ ...f, layout }, kids);
        const h = layout.direction === 'horizontal';
        const { top, right, bottom, left } = layout.padding;
        const laid = kids.filter((k) => !k.ignoreLayout);

        // ignoreLayout children omitted, all others present
        expect(res.size).toBe(laid.length);
        for (const k of kids) expect(res.has(k.id)).toBe(!k.ignoreLayout);

        const main = (k: StackChildInput) => (h ? k.width : k.height);
        const cross = (k: StackChildInput) => (h ? k.height : k.width);
        const center = (k: StackChildInput) => (h ? k.x + k.width / 2 : k.y + k.height / 2);
        const ordered = laid
          .map((k, i) => ({ k, i }))
          .sort((a, b) => center(a.k) - center(b.k) || a.i - b.i)
          .map((e) => e.k);

        const innerMain = h ? f.width - left - right : f.height - top - bottom;
        const innerCross = h ? f.height - top - bottom : f.width - left - right;
        const n = ordered.length;
        if (n === 0) return;
        const total = ordered.reduce((s, k) => s + main(k), 0);
        const run = total + layout.gap * (n - 1);
        const fits = run <= innerMain;
        let start = (h ? left + f.x : top + f.y);
        let step = layout.gap;
        if (fits) {
          if (layout.mainAlign === 'center') start += (innerMain - run) / 2;
          else if (layout.mainAlign === 'end') start += innerMain - run;
          else if (layout.mainAlign === 'spaceBetween' && n > 1) step = (innerMain - total) / (n - 1);
        }
        const crossBase = h ? top + f.y : left + f.x;

        let cursor = start;
        for (const k of ordered) {
          const p = res.get(k.id)!;
          const free = innerCross - cross(k);
          const co = layout.crossAlign === 'center' ? free / 2 : layout.crossAlign === 'end' ? free : 0;
          const expMain = round(cursor);
          const expCross = round(crossBase + co);
          expect(close(h ? p.x : p.y, expMain)).toBe(true);
          expect(close(h ? p.y : p.x, expCross)).toBe(true);
          // 2-decimal rounding
          expect(Math.abs(p.x * 100 - Math.round(p.x * 100))).toBeLessThan(1e-6);
          expect(Math.abs(p.y * 100 - Math.round(p.y * 100))).toBeLessThan(1e-6);
          cursor += main(k) + step;
        }
      }),
      { numRuns: 200 },
    );
  });

  it('ignores the unrotated-bounds-irrelevant extra fields (rotation is never read)', () => {
    fc.assert(
      fc.property(layoutArb, frameArb, childrenArb, fc.integer({ min: 1, max: 359 }), (layout, f, kids, rot) => {
        const a = arrangeStack({ ...f, layout }, kids);
        const rotated = kids.map((k) => ({ ...k, rotation: rot }) as StackChildInput);
        const b = arrangeStack({ ...f, layout }, rotated);
        expect([...b.entries()]).toEqual([...a.entries()]);
      }),
      { numRuns: 100 },
    );
  });
});
