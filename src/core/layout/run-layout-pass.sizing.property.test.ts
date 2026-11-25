import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { round2 } from '../model/ranges';
import type { LayoutConfig } from './types';
import { runLayoutPass } from './run-layout-pass';

/**
 * Feature: mockup-design-features, Property 27: Sizing resolution formulas
 * **Validates: Requirements 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9**
 */

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { x: 0, y: 0, rotation: 0, style };
const doc = (elements: Element[]): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
});
const find = (d: BoardDocument, id: string): Element => d.elements.find((e) => e.id === id)!;

type RootMode = 'fixed' | 'hug';
type ChildMode = 'fixed' | 'fill';
const dim = fc.integer({ min: 1, max: 200 });
const pad = fc.integer({ min: 0, max: 30 });

const scenario = fc.record({
  direction: fc.constantFrom('horizontal', 'vertical') as fc.Arbitrary<'horizontal' | 'vertical'>,
  gap: fc.integer({ min: 0, max: 20 }),
  padding: fc.record({ top: pad, right: pad, bottom: pad, left: pad }),
  rootW: dim,
  rootH: dim,
  rootWMode: fc.constantFrom<RootMode>('fixed', 'hug'),
  rootHMode: fc.constantFrom<RootMode>('fixed', 'hug'),
  kids: fc.array(
    fc.record({
      w: dim, h: dim,
      wMode: fc.constantFrom<ChildMode>('fixed', 'fill'),
      hMode: fc.constantFrom<ChildMode>('fixed', 'fill'),
    }),
    { minLength: 1, maxLength: 6 },
  ),
});

describe('Property 27: sizing resolution formulas', () => {
  it('resolves fixed/hug/fill sizes of children in a Layout_Frame per the formulas', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const layout: LayoutConfig = {
          direction: s.direction, gap: s.gap, padding: s.padding, mainAlign: 'start', crossAlign: 'start',
        };
        const root = {
          id: 'root', type: 'frame', name: 'root', ...base, width: s.rootW, height: s.rootH, layout,
          sizing: { width: s.rootWMode, height: s.rootHMode },
        } as Element;
        const kids = s.kids.map((k, i) => ({
          id: `k${i}`, type: 'rectangle', ...base, parentId: 'root', width: k.w, height: k.h,
          sizing: { width: k.wMode, height: k.hMode },
        }) as Element);
        const out = runLayoutPass(doc([root, ...kids])).doc;

        const horizontal = s.direction === 'horizontal';
        const padSum = { width: s.padding.left + s.padding.right, height: s.padding.top + s.padding.bottom };
        const orig = (i: number, axis: 'width' | 'height'): number => (axis === 'width' ? s.kids[i]!.w : s.kids[i]!.h);
        const cmode = (i: number, axis: 'width' | 'height'): ChildMode =>
          axis === 'width' ? s.kids[i]!.wMode : s.kids[i]!.hMode;
        const n = s.kids.length;

        const final = { width: s.rootW, height: s.rootH };
        for (const axis of ['width', 'height'] as const) {
          const rmode = axis === 'width' ? s.rootWMode : s.rootHMode;
          const main = (axis === 'width') === horizontal;
          if (rmode === 'hug') {
            // fill children of a hug parent on the same axis resolve as hug (a rectangle hugs as fixed)
            const sizes = s.kids.map((_, i) => orig(i, axis));
            const content = main
              ? sizes.reduce((a, b) => a + b, 0) + s.gap * (n - 1)
              : Math.max(...sizes);
            final[axis] = Math.max(1, round2(content + padSum[axis]));
          }
          expect(find(out, 'root')[axis]).toBe(final[axis]);
        }

        for (const axis of ['width', 'height'] as const) {
          const rmode = axis === 'width' ? s.rootWMode : s.rootHMode;
          const main = (axis === 'width') === horizontal;
          const inner = final[axis] - padSum[axis];
          const fillIdx = s.kids.map((_, i) => i).filter((i) => cmode(i, axis) === 'fill');
          const fixedSum = s.kids.reduce((a, _, i) => (cmode(i, axis) === 'fill' ? a : a + orig(i, axis)), 0);
          const share = Math.max(1, round2((inner - fixedSum - s.gap * (n - 1)) / Math.max(1, fillIdx.length)));
          s.kids.forEach((_, i) => {
            const got = find(out, `k${i}`)[axis];
            if (cmode(i, axis) === 'fixed' || rmode === 'hug') expect(got).toBe(orig(i, axis));
            else if (main) expect(got).toBe(share);
            else expect(got).toBe(Math.max(1, round2(inner)));
          });
        }
      }),
      { numRuns: 100 },
    );
  });

  it('resolves a fill Layout_Frame child of a hug parent on the same axis as hug', () => {
    fc.assert(
      fc.property(dim, dim, pad, pad, fc.integer({ min: 0, max: 10 }), (cw, ch, p1, p2, gap) => {
        const lay = (padding: number): LayoutConfig => ({
          direction: 'horizontal', gap, padding: { top: padding, right: padding, bottom: padding, left: padding },
          mainAlign: 'start', crossAlign: 'start',
        });
        const root = {
          id: 'root', type: 'frame', name: 'root', ...base, width: 500, height: 500, layout: lay(p1),
          sizing: { width: 'hug', height: 'hug' },
        } as Element;
        const inner = {
          id: 'inner', type: 'frame', name: 'inner', ...base, parentId: 'root', width: 300, height: 300,
          layout: lay(p2), sizing: { width: 'fill', height: 'fill' },
        } as Element;
        const leaf = { id: 'leaf', type: 'rectangle', ...base, parentId: 'inner', width: cw, height: ch } as Element;
        const out = runLayoutPass(doc([root, inner, leaf])).doc;
        expect(find(out, 'inner').width).toBe(Math.max(1, cw + 2 * p2));
        expect(find(out, 'inner').height).toBe(Math.max(1, ch + 2 * p2));
        expect(find(out, 'root').width).toBe(Math.max(1, cw + 2 * p2 + 2 * p1));
        expect(find(out, 'root').height).toBe(Math.max(1, ch + 2 * p2 + 2 * p1));
      }),
      { numRuns: 100 },
    );
  });

  it('keeps hug text/fixed sizes: fill outside any Layout_Frame resolves as fixed', () => {
    fc.assert(
      fc.property(dim, dim, (w, h) => {
        const r = { id: 'r', type: 'rectangle', ...base, width: w, height: h, sizing: { width: 'fill', height: 'fill' } } as Element;
        const plain = { id: 'f', type: 'frame', name: 'f', ...base, width: 100, height: 100 } as Element;
        const inPlain = {
          id: 'c', type: 'rectangle', ...base, parentId: 'f', width: w, height: h, sizing: { width: 'fill', height: 'fill' },
        } as Element;
        // A layout frame elsewhere makes the pass do real work.
        const lf = {
          id: 'lf', type: 'frame', name: 'lf', ...base, width: 100, height: 100,
          layout: { direction: 'horizontal', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, mainAlign: 'start', crossAlign: 'start' },
        } as Element;
        const out = runLayoutPass(doc([r, plain, inPlain, lf])).doc;
        expect([find(out, 'r').width, find(out, 'r').height]).toEqual([w, h]);
        expect([find(out, 'c').width, find(out, 'c').height]).toEqual([w, h]);
      }),
      { numRuns: 100 },
    );
  });
});
