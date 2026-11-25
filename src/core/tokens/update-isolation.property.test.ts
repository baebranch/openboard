import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createEmptyDocument } from '../format';
import { renderElementToSvg } from '../export/svg';
import { BoardModel } from '../ops/model';
import type { BoardDocument, Color, Element } from '../model/types';

/**
 * Feature: mockup-design-features, Property 18: Token update isolation
 * **Validates: Requirements 11.7**
 */

const NAMES = ['brand', 'accent', 'ink', 'muted'] as const;

const hexArb = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map(([r, g, b]) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''));

/** A color field: a literal, or a reference to one of the tokens. */
const fieldArb = fc.oneof(
  hexArb,
  fc.constantFrom(...NAMES).map((n) => `token:${n}`),
);

const elementArb = (id: string): fc.Arbitrary<Element> =>
  fc.record({ fill: fieldArb, stroke: fieldArb }).map(
    ({ fill, stroke }) =>
      ({
        id,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        rotation: 0,
        style: { fill, stroke, strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 },
      }) as Element,
  );

const scenarioArb = fc
  .record({
    values: fc.tuple(hexArb, hexArb, hexArb, hexArb),
    elements: fc.tuple(elementArb('a'), elementArb('b'), elementArb('c'), elementArb('d'), elementArb('e')),
    target: fc.constantFrom(...NAMES),
    next: hexArb,
  })
  .filter(({ values, target, next }) => values[NAMES.indexOf(target)] !== next);

const refs = (el: Element, name: string): boolean =>
  el.style.fill === `token:${name}` || el.style.stroke === `token:${name}`;

describe('Property 18: Token update isolation', () => {
  it('updating a token changes only the rendering of elements that reference it', () => {
    fc.assert(
      fc.property(scenarioArb, ({ values, elements, target, next }) => {
        const nextColor = next as Color;
        const colors: Record<string, string> = {};
        NAMES.forEach((n, i) => (colors[n] = values[i] as string));
        const doc: BoardDocument = { ...createEmptyDocument(), elements: [...elements], tokens: { colors } };
        const model = new BoardModel('p', doc);
        const render = (d: BoardDocument, e: Element): string => renderElementToSvg(e, d);
        const before = elements.map((e) => render(model.getDocument(), e));

        model.transact('update token', (tx) => tx.updateToken('colors', target, next));
        const after = model.getDocument();
        expect(after.tokens?.colors?.[target]).toBe(next);

        elements.forEach((el, i) => {
          const now = render(after, el);
          if (!refs(el, target)) {
            // Unaffected elements render exactly as before.
            expect(now).toBe(before[i]);
            return;
          }
          // Referencing elements render as if the reference were the new literal.
          const literal: Element = {
            ...el,
            style: {
              ...el.style,
              fill: el.style.fill === `token:${target}` ? nextColor : el.style.fill,
              stroke: el.style.stroke === `token:${target}` ? nextColor : el.style.stroke,
            },
          };
          expect(now).toBe(render(after, literal));
          expect(now).not.toBe(before[i]);
        });
      }),
      { numRuns: 100 },
    );
  });
});
