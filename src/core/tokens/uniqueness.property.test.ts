import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { installBoardValidator } from '../../../test/helpers/validator';
import { createEmptyDocument, parse, serialize } from '../format';
import type { BoardDocument, Element } from '../model/types';
import { TOKEN_CATEGORIES, type TokenCategory, type TokenCollection } from './types';
import { makeTokenRef, validateNewToken } from './validate';

beforeAll(() => {
  installBoardValidator();
}, 60_000);

const NAME_CHARS = 'abcABC019._-'.split('');
const nameArb = fc.string({ unit: fc.constantFrom(...NAME_CHARS), minLength: 1, maxLength: 12 });
const hexArb = fc.stringMatching(/^#[0-9a-f]{6}$/);

const valueArb: Record<TokenCategory, fc.Arbitrary<string | number>> = {
  colors: hexArb,
  fonts: fc.constantFrom('Inter', 'Georgia, serif', 'monospace', 'Fira Code'),
  numbers: fc.integer({ min: -1000, max: 1000 }),
};

/** A collection whose names are unique per category under case-sensitive comparison. */
const collectionArb: fc.Arbitrary<TokenCollection> = fc
  .tuple(
    ...TOKEN_CATEGORIES.map((c) =>
      fc.uniqueArray(fc.tuple(nameArb, valueArb[c]), { selector: (e) => e[0], maxLength: 8 }),
    ),
  )
  .map(([colors, fonts, numbers]) => {
    const out: TokenCollection = {};
    if (colors!.length) out.colors = Object.fromEntries(colors!) as Record<string, string>;
    if (fonts!.length) out.fonts = Object.fromEntries(fonts!) as Record<string, string>;
    if (numbers!.length) out.numbers = Object.fromEntries(numbers!) as Record<string, number>;
    return out;
  });

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };

function docFor(tokens: TokenCollection, refNames: string[]): BoardDocument {
  const elements = refNames.map(
    (n, i) =>
      ({ id: `r${i}`, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style: { ...style, fill: makeTokenRef(n) } }) as Element,
  );
  return { ...createEmptyDocument(), tokens, elements };
}

describe('Feature: mockup-design-features, Property 17: Token name uniqueness and collection round trip', () => {
  /** **Validates: Requirements 11.1, 11.2, 11.16** */
  it('parse(serialize(doc)) preserves every category, name, value, and Token_Reference', () => {
    fc.assert(
      fc.property(collectionArb, fc.nat(5), (tokens, nRefs) => {
        const colorNames = Object.keys(tokens.colors ?? {});
        const refs = colorNames.slice(0, nRefs);
        const doc = docFor(tokens, refs);
        const r = parse(serialize(doc));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.doc.tokens ?? {}).toEqual(tokens);
        expect(r.doc.elements.map((e) => e.style.fill)).toEqual(refs.map(makeTokenRef));
        // Second pass is stable.
        expect(serialize(r.doc)).toBe(serialize(doc));
      }),
      { numRuns: 100 },
    );
  });

  it('rejects an exact duplicate name in a category but allows case variants and other categories', () => {
    fc.assert(
      fc.property(collectionArb, nameArb, (tokens, name) => {
        for (const c of TOKEN_CATEGORIES) {
          const bucket = (tokens[c] ?? {}) as Record<string, unknown>;
          for (const existing of Object.keys(bucket)) {
            const dup = validateNewToken(tokens, c, existing, sampleValue(c));
            expect(dup.ok).toBe(false);
            if (!dup.ok) expect(dup.code).toBe('duplicate_name');
          }
          const fresh = Object.prototype.hasOwnProperty.call(bucket, name);
          const res = validateNewToken(tokens, c, name, sampleValue(c));
          expect(res.ok).toBe(!fresh);
        }
      }),
      { numRuns: 100 },
    );
  });
});

function sampleValue(c: TokenCategory): string | number {
  return c === 'colors' ? '#123456' : c === 'fonts' ? 'Inter' : 1;
}
