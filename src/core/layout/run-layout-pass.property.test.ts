import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { BoardDocument, Element } from '../model/types';
import type { LayoutConfig } from './types';
import { runLayoutPass } from './run-layout-pass';

/** Feature: mockup-design-features, Property 28: Layout_Pass idempotence and determinism */

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const spacing = fc.integer({ min: 0, max: 30 });
const mode = fc.constantFrom('fixed', 'hug', 'fill');
const sizingArb = fc.option(fc.record({ width: mode, height: mode }), { nil: undefined });
const layoutArb: fc.Arbitrary<LayoutConfig> = fc.record({
  direction: fc.constantFrom('horizontal', 'vertical'),
  gap: spacing,
  padding: fc.record({ top: spacing, right: spacing, bottom: spacing, left: spacing }),
  mainAlign: fc.constantFrom('start', 'center', 'end', 'spaceBetween'),
  crossAlign: fc.constantFrom('start', 'center', 'end'),
});
const geom = fc.record({
  x: fc.integer({ min: -100, max: 300 }),
  y: fc.integer({ min: -100, max: 300 }),
  width: fc.integer({ min: 1, max: 150 }),
  height: fc.integer({ min: 1, max: 150 }),
});

const childSpec = fc.record({
  kind: fc.constantFrom('rect', 'text', 'wrapText', 'frame'),
  g: geom,
  sizing: sizingArb,
  ignore: fc.boolean(),
  content: fc.constantFrom('Hi', 'Hello world', 'A much longer line of text to wrap around'),
  layout: layoutArb,
  grandkids: fc.array(fc.record({ g: geom, sizing: sizingArb, text: fc.boolean() }), { maxLength: 3 }),
});

const docArb: fc.Arbitrary<BoardDocument> = fc
  .record({
    rootLayout: layoutArb,
    rootGeom: geom,
    rootSizing: sizingArb,
    kids: fc.array(childSpec, { maxLength: 5 }),
  })
  .map(({ rootLayout, rootGeom, rootSizing, kids }) => {
    const els: Element[] = [
      { id: 'root', type: 'frame', name: 'root', ...rootGeom, rotation: 0, style, layout: rootLayout, ...(rootSizing ? { sizing: rootSizing } : {}) } as Element,
    ];
    kids.forEach((k, i) => {
      const id = `k${i}`;
      const common = { id, parentId: 'root', ...k.g, rotation: 0, style, ...(k.sizing ? { sizing: k.sizing } : {}), ...(k.ignore ? { ignoreLayout: true } : {}) };
      if (k.kind === 'rect') els.push({ type: 'rectangle', ...common } as Element);
      else if (k.kind === 'text' || k.kind === 'wrapText') {
        els.push({
          type: 'text', ...common, runs: [{ text: k.content }], fontFamily: 'sans', fontSize: 12, align: 'left',
          ...(k.kind === 'wrapText' ? { textWrap: 'wrap' } : {}),
        } as Element);
      } else {
        els.push({ type: 'frame', name: id, ...common, layout: k.layout } as Element);
        k.grandkids.forEach((gk, j) => {
          const gc = { id: `${id}g${j}`, parentId: id, ...gk.g, rotation: 0, style, ...(gk.sizing ? { sizing: gk.sizing } : {}) };
          els.push(
            gk.text
              ? ({ type: 'text', ...gc, runs: [{ text: 'Nested text' }], fontFamily: 'sans', fontSize: 12, align: 'left' } as Element)
              : ({ type: 'rectangle', ...gc } as Element),
          );
        });
      }
    });
    return { schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: els, assets: [], library: [] } as BoardDocument;
  });

describe('Property 28: Layout_Pass idempotence and determinism', () => {
  it('running twice equals running once (serialized)', () => {
    // **Validates: Requirements 22.6, 22.7, 28.8**
    fc.assert(
      fc.property(docArb, (d) => {
        const once = runLayoutPass(d);
        const twice = runLayoutPass(once.doc);
        expect(JSON.stringify(twice.doc)).toBe(JSON.stringify(once.doc));
        expect(twice.changedIds).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic on the same input and does not mutate it', () => {
    // **Validates: Requirements 22.6, 22.7, 28.8**
    fc.assert(
      fc.property(docArb, (d) => {
        const before = JSON.stringify(d);
        const a = runLayoutPass(d);
        const b = runLayoutPass(JSON.parse(before) as BoardDocument);
        expect(JSON.stringify(a.doc)).toBe(JSON.stringify(b.doc));
        expect(a.changedIds).toEqual(b.changedIds);
        expect(JSON.stringify(d)).toBe(before);
      }),
      { numRuns: 200 },
    );
  });
});
