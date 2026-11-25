import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createEmptyDocument } from '../format';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerTokenTools } from './token-tools';

/**
 * Feature: mockup-design-features, Property 19: Token delete/detach invariants
 * **Validates: Requirements 11.9, 11.10, 11.17**
 */

const DEFINED = ['brand', 'accent', 'ink'] as const;
const NAMES = [...DEFINED, 'ghost'] as const; // `ghost` is never defined: a missing token.

const hexArb = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map(([r, g, b]) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''));

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

const scenarioArb = fc.record({
  values: fc.tuple(hexArb, hexArb, hexArb),
  elements: fc.tuple(elementArb('a'), elementArb('b'), elementArb('c'), elementArb('d')),
});

function setup(values: readonly string[], elements: readonly Element[]) {
  const colors: Record<string, string> = {};
  DEFINED.forEach((n, i) => (colors[n] = values[i] as string));
  const doc: BoardDocument = { ...createEmptyDocument(), elements: [...elements], tokens: { colors } };
  const model = new BoardModel('/p.openboard', doc, { history: new UndoHistory() });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerTokenTools(reg);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  return { model, run, colors };
}

const countRefs = (elements: readonly Element[], name: string): number =>
  elements.reduce(
    (n, e) => n + (e.style.fill === `token:${name}` ? 1 : 0) + (e.style.stroke === `token:${name}` ? 1 : 0),
    0,
  );

describe('Property 19: Token delete/detach invariants', () => {
  it('deleting a referenced token is rejected with the exact count and leaves the document unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ values, elements }) => {
        const { model, run } = setup(values, elements);
        for (const name of DEFINED) {
          const n = countRefs(elements, name);
          if (n === 0) continue;
          const before = JSON.stringify(model.getDocument());
          const res = await run('openboard.token.delete', { category: 'colors', name });
          expect(res.error.code).toBe('token_in_use');
          expect(res.error.message).toContain(`it has ${n} reference${n === 1 ? '' : 's'}`);
          expect(JSON.stringify(model.getDocument())).toBe(before);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('detach replaces every reference with a literal and is idempotent', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ values, elements }) => {
        const { model, run, colors } = setup(values, elements);
        const first = await run('openboard.token.detach', {});
        expect(first.error, JSON.stringify(first)).toBeUndefined();
        const after = model.getDocument();
        const resolve = (v: string): string =>
          v.startsWith('token:') ? (colors[v.slice(6)] ?? 'theme:default') : v;
        after.elements.forEach((el, i) => {
          const orig = elements[i] as Element;
          expect(el.style.fill).toBe(resolve(orig.style.fill as string));
          expect(el.style.stroke).toBe(resolve(orig.style.stroke as string));
          expect(el.style.fill).not.toMatch(/^token:/);
          expect(el.style.stroke).not.toMatch(/^token:/);
        });
        expect(after.tokens?.colors).toEqual(colors);

        const snapshot = JSON.stringify(after);
        const again = await run('openboard.token.detach', {});
        expect(again.ids).toEqual([]);
        expect(JSON.stringify(model.getDocument())).toBe(snapshot);

        // Once nothing references a token it can be deleted.
        for (const name of DEFINED) {
          const res = await run('openboard.token.delete', { category: 'colors', name });
          expect(res.error).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});
