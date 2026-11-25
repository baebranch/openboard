import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { BoardDocument, Element } from '../model/types';
import type { LayoutConfig } from './types';
import { runLayoutPass } from './run-layout-pass';

/** Feature: mockup-design-features, Property 29: Fixed-children containment */

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const EPS = 0.011;

const spacing = fc.integer({ min: 0, max: 30 });
const layoutArb: fc.Arbitrary<LayoutConfig> = fc.record({
  direction: fc.constantFrom('horizontal', 'vertical'),
  gap: spacing,
  padding: fc.record({ top: spacing, right: spacing, bottom: spacing, left: spacing }),
  mainAlign: fc.constantFrom('start', 'center', 'end', 'spaceBetween'),
  crossAlign: fc.constantFrom('start', 'center', 'end'),
});
const frameArb = fc.record({
  x: fc.integer({ min: -100, max: 100 }),
  y: fc.integer({ min: -100, max: 100 }),
  width: fc.integer({ min: 20, max: 400 }),
  height: fc.integer({ min: 20, max: 400 }),
});
const kidArb = fc.record({
  x: fc.integer({ min: -200, max: 400 }),
  y: fc.integer({ min: -200, max: 400 }),
  width: fc.integer({ min: 1, max: 150 }),
  height: fc.integer({ min: 1, max: 150 }),
  fill: fc.boolean(),
});

function build(
  layout: LayoutConfig,
  f: { x: number; y: number; width: number; height: number },
  kids: { x: number; y: number; width: number; height: number; fill: boolean }[],
  fillMain: boolean,
): BoardDocument {
  const mainDim = layout.direction === 'horizontal' ? 'width' : 'height';
  const frame = { id: 'f', type: 'frame', name: 'f', rotation: 0, style, ...f, layout } as Element;
  const els = kids.map(
    (k, i) =>
      ({
        id: `c${i}`, type: 'rectangle', parentId: 'f', rotation: 0, style,
        x: k.x, y: k.y, width: k.width, height: k.height,
        ...(fillMain && k.fill ? { sizing: { [mainDim]: 'fill' } } : {}),
      }) as Element,
  );
  return { schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [frame, ...els], assets: [], library: [] };
}

describe('Property 29: Fixed-children containment', () => {
  /**
   * **Validates: Requirements 22.8**
   */
  it('fixed children fitting the frame stay inside its inner bounds', () => {
    fc.assert(
      fc.property(layoutArb, frameArb, fc.array(kidArb, { minLength: 1, maxLength: 6 }), (layout, f, kids) => {
        const h = layout.direction === 'horizontal';
        const { top, right, bottom, left } = layout.padding;
        const innerMain = h ? f.width - left - right : f.height - top - bottom;
        const innerCross = h ? f.height - top - bottom : f.width - left - right;
        const total = kids.reduce((s, k) => s + (h ? k.width : k.height), 0) + layout.gap * (kids.length - 1);
        fc.pre(total <= innerMain);
        fc.pre(kids.every((k) => (h ? k.height : k.width) <= innerCross));

        const { doc } = runLayoutPass(build(layout, f, kids, false));
        for (let i = 0; i < kids.length; i++) {
          const c = doc.elements.find((e) => e.id === `c${i}`)!;
          expect(c.x).toBeGreaterThanOrEqual(f.x + left - EPS);
          expect(c.y).toBeGreaterThanOrEqual(f.y + top - EPS);
          expect(c.x + c.width).toBeLessThanOrEqual(f.x + f.width - right + EPS);
          expect(c.y + c.height).toBeLessThanOrEqual(f.y + f.height - bottom + EPS);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('on overflow, children start at the inner start edge and fill children are 1 unit', () => {
    fc.assert(
      fc.property(layoutArb, frameArb, fc.array(kidArb, { minLength: 1, maxLength: 6 }), (layout, f, kids) => {
        const h = layout.direction === 'horizontal';
        const { top, left, right, bottom } = layout.padding;
        const innerMain = h ? f.width - left - right : f.height - top - bottom;
        const fixedTotal = kids.filter((k) => !k.fill).reduce((s, k) => s + (h ? k.width : k.height), 0);
        const filled = kids.filter((k) => k.fill).length;
        const total = fixedTotal + filled + layout.gap * (kids.length - 1);
        fc.pre(total > innerMain);
        // Fill children must be starved of space (fixed sizes + gaps alone exhaust the inner size).
        fc.pre(fixedTotal + layout.gap * (kids.length - 1) >= innerMain);

        const { doc } = runLayoutPass(build(layout, f, kids, true));
        const mainDim = h ? 'width' : 'height';
        const start = h ? f.x + left : f.y + top;
        let min = Infinity;
        kids.forEach((k, i) => {
          const c = doc.elements.find((e) => e.id === `c${i}`)!;
          if (k.fill) expect(c[mainDim]).toBe(1);
          min = Math.min(min, h ? c.x : c.y);
        });
        expect(Math.abs(min - start)).toBeLessThanOrEqual(EPS);
      }),
      { numRuns: 200 },
    );
  });

  it('smoke: concrete overflow example', () => {
    const layout: LayoutConfig = {
      direction: 'horizontal', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 },
      mainAlign: 'center', crossAlign: 'start',
    };
    const { doc } = runLayoutPass(
      build(layout, { x: 0, y: 0, width: 50, height: 50 }, [
        { x: 0, y: 0, width: 40, height: 10, fill: false },
        { x: 100, y: 0, width: 40, height: 10, fill: false },
      ], false),
    );
    expect(doc.elements.find((e) => e.id === 'c0')!.x).toBe(0);
  });
});
