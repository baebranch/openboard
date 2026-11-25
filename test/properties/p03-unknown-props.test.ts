import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, serialize } from '../../src/core/format';
import type { BoardValidator } from '../../src/core/format';
import { arbBoardDocument, arbElement } from '../arbitraries';
import { getBoardValidator } from '../helpers/validator';

let validator: BoardValidator;
beforeAll(() => {
  validator = getBoardValidator();
});

type Obj = Record<string, unknown>;

/** Unknown property bag: keys carry a prefix no known property uses. */
const arbBag: fc.Arbitrary<Obj> = fc.dictionary(
  fc.stringMatching(/^[a-z0-9]{1,8}$/).map((k) => `x-unknown-${k}`),
  fc.jsonValue(),
  { maxKeys: 3 },
);
const arbBags = fc.array(arbBag, { minLength: 1, maxLength: 8 });

function inject(target: Obj, bags: Obj[], i: number): void {
  Object.assign(target, bags[i % bags.length]);
}

// Feature: openboard, Property 3: Unknown properties are preserved
describe('Feature: openboard, Property 3: Unknown properties are preserved', () => {
  it('parse then serialize emits unknown properties at the same location with equal values', () => {
    // **Validates: Requirements 11.11**
    fc.assert(
      fc.property(
        arbBoardDocument(15),
        arbElement('rectangle', 'lib-el'),
        arbBags,
        arbBags,
        (doc, libEl, bags, styleBags) => {
          const withLib = {
            ...doc,
            library: [{ id: 'lib-0', name: 'component', elements: [libEl] }],
          };
          const raw = JSON.parse(serialize(withLib)) as Obj;

          // Inject unknown properties at every supported location.
          inject(raw, bags, 0);
          inject(raw['meta'] as Obj, bags, 1);
          inject(raw['viewport'] as Obj, bags, 2);
          (raw['elements'] as Obj[]).forEach((el, i) => {
            inject(el, bags, i + 3);
            inject(el['style'] as Obj, styleBags, i);
          });
          (raw['assets'] as Obj[]).forEach((a, i) => inject(a, bags, i + 4));
          (raw['library'] as Obj[]).forEach((c, i) => {
            inject(c, bags, i + 5);
            (c['elements'] as Obj[]).forEach((el, j) => {
              inject(el, bags, j + 6);
              inject(el['style'] as Obj, styleBags, j + 1);
            });
          });

          const text = JSON.stringify(raw);
          const expected = JSON.parse(text) as unknown;

          const parsed = parse(text, { validator });
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) return;
          const out = JSON.parse(serialize(parsed.doc)) as unknown;
          expect(out).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves a concrete unknown property at the document root', () => {
    const doc = fc.sample(arbBoardDocument(3), 1)[0]!;
    const raw = { ...JSON.parse(serialize(doc)), 'x-future': { a: [1, null, 'b'] } };
    const r = parse(JSON.stringify(raw), { validator });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((JSON.parse(serialize(r.doc)) as Obj)['x-future']).toEqual({ a: [1, null, 'b'] });
  });
});
