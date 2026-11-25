import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { DerivedGeometryError, MAX_DERIVED_ITERATIONS, runDerivedGeometryPass, type DerivedPassFn } from './derived-geometry';

/**
 * Feature: mockup-design-features, Property 23: Derived_Geometry_Pass termination
 * **Validates: Requirements 15.7, 18.6, 18.7, 28.3**
 */

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const frame = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name: id, x: 0, y: 0, width: 100, height: 50, rotation: 0, style, ...extra }) as Element;
const rect = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'rectangle', x: 1, y: 2, width: 10, height: 10, rotation: 0, style, ...extra }) as Element;
const docOf = (elements: Element[]): BoardDocument =>
  ({ schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [] }) as BoardDocument;

// Arbitrary instanceOf graph over N frames, which may contain self-loops and cycles.
const graphArb = fc.integer({ min: 1, max: 6 }).chain((n) =>
  fc.array(
    fc.record({
      component: fc.boolean(),
      instanceOf: fc.option(fc.nat(n), { nil: null }), // n => dangling id
      parent: fc.option(fc.nat(n - 1), { nil: null }),
      kid: fc.boolean(),
    }),
    { minLength: n, maxLength: n },
  ),
);

function buildGraph(spec: { component: boolean; instanceOf: number | null; parent: number | null; kid: boolean }[]): BoardDocument {
  const els: Element[] = [];
  spec.forEach((s, i) => {
    const extra: Record<string, unknown> = {};
    if (s.component) extra.component = `C${i}`;
    if (s.instanceOf !== null) extra.instanceOf = `F${s.instanceOf}`;
    if (s.parent !== null && s.parent !== i) extra.parentId = `F${s.parent}`;
    els.push(frame(`F${i}`, extra));
    if (s.kid) els.push(rect(`F${i}k`, { parentId: `F${i}` }));
  });
  return docOf(els);
}

describe('Property 23: Derived_Geometry_Pass termination', () => {
  it('default passes either stabilize or throw DerivedGeometryError, never mutating the input', () => {
    fc.assert(
      fc.property(graphArb, (spec) => {
        const d = buildGraph(spec);
        const snapshot = structuredClone(d);
        try {
          const r = runDerivedGeometryPass(d);
          // Stabilized: running again on the result yields no further changes.
          expect(runDerivedGeometryPass(r.doc).patches).toEqual([]);
        } catch (err) {
          expect(err).toBeInstanceOf(DerivedGeometryError);
        }
        expect(d).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });

  it('component cycles are reported as errors, not loops', () => {
    const d = docOf([
      frame('A', { component: 'A' }),
      frame('ai', { parentId: 'A', instanceOf: 'B' }),
      frame('B', { component: 'B' }),
      frame('bi', { parentId: 'B', instanceOf: 'A' }),
    ]);
    expect(() => runDerivedGeometryPass(d)).toThrow(DerivedGeometryError);
  });

  it('a never-stabilizing pass stops at the iteration cap with iteration-limit and leaves input untouched', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        const d = docOf(Array.from({ length: n }, (_, i) => frame(`F${i}`)));
        const snapshot = structuredClone(d);
        let calls = 0;
        const oscillate: DerivedPassFn = (doc) => {
          calls++;
          return {
            doc: { ...doc, elements: doc.elements.map((e) => ({ ...e, x: e.x + 1 }) as Element) },
            changedIds: doc.elements.map((e) => e.id),
          };
        };
        let thrown: unknown;
        try {
          runDerivedGeometryPass(d, [oscillate]);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(DerivedGeometryError);
        expect((thrown as DerivedGeometryError).reason).toBe('iteration-limit');
        expect(calls).toBe(MAX_DERIVED_ITERATIONS);
        expect(d).toEqual(snapshot);
      }),
      { numRuns: 20 },
    );
  });

  it('arbitrary pass sequences that change for k iterations then stop terminate within the cap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 15 }), (k) => {
        const d = docOf([frame('F0')]);
        let calls = 0;
        const pass: DerivedPassFn = (doc) => {
          calls++;
          if (calls > k) return { doc, changedIds: [] };
          return { doc: { ...doc, elements: doc.elements.map((e) => ({ ...e, x: e.x + 1 }) as Element) }, changedIds: ['F0'] };
        };
        try {
          const r = runDerivedGeometryPass(d, [pass]);
          expect(k).toBeLessThan(MAX_DERIVED_ITERATIONS);
          expect(r.doc.elements[0]!.x).toBe(k);
        } catch (err) {
          expect(err).toBeInstanceOf(DerivedGeometryError);
          expect(k).toBeGreaterThanOrEqual(MAX_DERIVED_ITERATIONS);
        }
        expect(calls).toBeLessThanOrEqual(MAX_DERIVED_ITERATIONS);
        expect(d.elements[0]!.x).toBe(0);
      }),
      { numRuns: 40 },
    );
  });
});
