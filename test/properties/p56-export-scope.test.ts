import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_OPTIONS,
  prepareExport,
  selectFrameScopes,
  selectScope,
} from '../../src/core/export/scope';
import type { Element } from '../../src/core/model/types';

type Box = { x: number; y: number; width: number; height: number };

const boxArb = fc.record({
  x: fc.integer({ min: -200, max: 200 }),
  y: fc.integer({ min: -200, max: 200 }),
  width: fc.integer({ min: 1, max: 120 }),
  height: fc.integer({ min: 1, max: 120 }),
});

const touches = (a: Box, b: Box) =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;

/** Elements e0..eN, some of which are frames. No parent links. */
const elementsArb = fc
  .array(fc.tuple(boxArb, fc.boolean()), { minLength: 0, maxLength: 14 })
  .map(
    (items) =>
      items.map(
        ([b, isFrame], i) =>
          ({ id: `e${i}`, type: isFrame ? 'frame' : 'rectangle', rotation: 0, ...b }) as unknown as Element,
      ),
  );

const expectedFrame = (els: Element[], f: Element) =>
  els.filter((e) => e.id === f.id || touches(e as unknown as Box, f as unknown as Box)).map((e) => e.id);

const ids = (els: readonly Element[]) => els.map((e) => e.id);

// Feature: openboard, Property 56: Export scope
describe('Feature: openboard, Property 56: Export scope', () => {
  it('board scope returns every element', () => {
    // **Validates: Requirements 12.2**
    fc.assert(
      fc.property(elementsArb, (elements) => {
        expect(ids(selectScope({ elements }, { kind: 'board' }))).toEqual(ids(elements));
      }),
      { numRuns: 100 },
    );
  });

  it('selection scope includes exactly the selected elements', () => {
    // **Validates: Requirements 12.2, 12.15**
    fc.assert(
      fc.property(elementsArb, fc.array(fc.integer({ min: 0, max: 16 })), (elements, picks) => {
        const sel = picks.map((i) => `e${i}`);
        const got = ids(selectScope({ elements }, { kind: 'selection', ids: sel }));
        expect(got).toEqual(ids(elements).filter((id) => sel.includes(id)));
      }),
      { numRuns: 100 },
    );
  });

  it('frame scope includes the frame and intersecting elements only', () => {
    // **Validates: Requirements 12.2, 12.15**
    fc.assert(
      fc.property(elementsArb, (elements) => {
        for (const f of elements.filter((e) => e.type === 'frame')) {
          const got = ids(selectScope({ elements }, { kind: 'frame', id: f.id }));
          expect(got).toEqual(expectedFrame(elements, f));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all-frames scope yields one separate scope per frame', () => {
    // **Validates: Requirements 12.2**
    fc.assert(
      fc.property(elementsArb, (elements) => {
        const frames = elements.filter((e) => e.type === 'frame');
        const scopes = selectFrameScopes({ elements });
        expect(scopes.map((s) => s.frame.id)).toEqual(ids(frames));
        for (const s of scopes) expect(ids(s.elements)).toEqual(expectedFrame(elements, s.frame));
      }),
      { numRuns: 100 },
    );
  });

  it('an empty scope aborts with an empty-scope error', () => {
    // **Validates: Requirements 12.15**
    fc.assert(
      fc.property(elementsArb, (elements) => {
        const r1 = prepareExport({ elements }, { ...DEFAULT_EXPORT_OPTIONS, scope: { kind: 'selection', ids: [] } });
        const r2 = prepareExport({ elements }, { ...DEFAULT_EXPORT_OPTIONS, scope: { kind: 'frame', id: 'missing' } });
        for (const r of [r1, r2]) {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.code).toBe('empty-scope');
        }
      }),
      { numRuns: 100 },
    );
  });
});
