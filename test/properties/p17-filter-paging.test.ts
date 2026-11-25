import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES, type Element } from '../../src/core/model';
import { arbBoardDocument } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 17: Filtered selection matches the filter
// **Validates: Requirements 13.5, 13.14**

const QUERY = 'openboard.element.query';
const UPDATE = 'openboard.element.update';

/** Independent oracle for a type + flat-property filter. */
function oracle(elements: readonly Element[], type: string | undefined, filter: Record<string, unknown> | undefined): Element[] {
  return elements.filter((e) => {
    if (type !== undefined && e.type !== type) return false;
    for (const [k, v] of Object.entries(filter ?? {})) {
      const top = (e as any)[k];
      const actual = top !== undefined ? top : (e.style as any)?.[k];
      if (actual !== v) return false;
    }
    return true;
  });
}

interface Sel {
  type?: string;
  filter?: Record<string, unknown>;
}

/** A selector derived from the document so that matches are common. */
const arbSel = (elements: readonly Element[]): fc.Arbitrary<Sel> => {
  const filters: fc.Arbitrary<Record<string, unknown> | undefined>[] = [fc.constant(undefined)];
  if (elements.length > 0) {
    filters.push(
      fc.nat(elements.length - 1).chain((i) =>
        fc.constantFrom(
          { opacity: elements[i]!.style.opacity },
          { fill: elements[i]!.style.fill },
          { strokeWidth: elements[i]!.style.strokeWidth },
          { x: elements[i]!.x },
          { width: elements[i]!.width, height: elements[i]!.height },
          { opacity: 12345 },
        ),
      ),
    );
  }
  return fc
    .tuple(fc.option(fc.constantFrom(...ELEMENT_TYPES), { nil: undefined }), fc.oneof(...filters))
    .filter(([t, f]) => t !== undefined || f !== undefined)
    .map(([type, filter]) => ({ ...(type ? { type } : {}), ...(filter ? { filter } : {}) }));
};

const arbCase = arbBoardDocument(300).chain((doc) =>
  fc.record({
    doc: fc.constant(doc),
    sel: arbSel(doc.elements),
    limit: fc.integer({ min: 1, max: 500 }),
    useCursor: fc.boolean(),
  }),
);

describe('Feature: openboard, Property 17: Filtered selection matches the filter', () => {
  it('query returns exactly the oracle matches; pages reassemble in order with correct total', async () => {
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ doc, sel, limit, useCursor }) => {
        const { registry } = buildFullRegistry({ doc });
        const expected = oracle(doc.elements, sel.type, sel.filter).map((e) => e.id);
        const seen: string[] = [];
        let offset = 0;
        let cursor: string | undefined;
        for (let guard = 0; guard < 1000; guard++) {
          const input = { ...sel, limit, ...(useCursor ? (cursor ? { cursor } : {}) : { offset }) };
          const page: any = await registry.invoke(QUERY, input);
          expect(page.error).toBeUndefined();
          expect(page.total).toBe(expected.length);
          expect(page.items.length).toBeLessThanOrEqual(limit);
          seen.push(...page.items.map((e: Element) => e.id));
          if (page.nextCursor === undefined) break;
          cursor = page.nextCursor;
          offset = page.nextOffset;
        }
        expect(seen).toEqual(expected);
        expect(new Set(seen).size).toBe(seen.length);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects limits outside 1..500', async () => {
    const { registry } = buildFullRegistry();
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.integer({ min: -1000, max: 0 }), fc.integer({ min: 501, max: 100000 }), fc.double({ min: 1.1, max: 400, noNaN: true }).filter((n) => !Number.isInteger(n))),
        async (limit) => {
          const r: any = await registry.invoke(QUERY, { type: 'rectangle', limit });
          expect(r.error?.code).toBe('invalid_input');
          expect(r.items).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('update by filter changes exactly the matched elements', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBoardDocument(300).chain((doc) => fc.record({ doc: fc.constant(doc), sel: arbSel(doc.elements), opacity: fc.integer({ min: 0, max: 100 }) })),
        async ({ doc, sel, opacity }) => {
          const { registry, model } = buildFullRegistry({ doc });
          const matched = new Set(oracle(doc.elements, sel.type, sel.filter).map((e) => e.id));
          const before = model.getDocument().elements;
          const r: any = await registry.invoke(UPDATE, { ...sel, set: { opacity } });
          if (matched.size === 0) {
            expect(r.error?.code).toBe('no_match');
            expect(model.getDocument().elements).toEqual(before);
            return;
          }
          expect(r.error).toBeUndefined();
          expect(new Set(r.ids)).toEqual(matched);
          expect(r.updated).toBe(matched.size);
          const after = model.getDocument().elements;
          expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
          after.forEach((e, i) => {
            if (matched.has(e.id)) expect(e.style.opacity).toBe(opacity);
            else expect(e).toEqual(before[i]);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
