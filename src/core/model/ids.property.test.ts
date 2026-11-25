import { describe, it } from 'vitest';
import fc from 'fast-check';
import { newId } from './ids';

describe('Feature: openboard, Property 26: Element identifiers do not collide', () => {
  /** **Validates: Requirements 15.9, 11.4** */
  it('generates pairwise-distinct ids across many generations', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 2000 }), (n) => {
        const ids = Array.from({ length: n }, () => newId());
        return new Set(ids).size === n;
      }),
      { numRuns: 100 },
    );
  });

  it('ids generated in independent "windows" (batches) never collide', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 2, maxLength: 8 }),
        (sizes) => {
          const all = sizes.flatMap((s) => Array.from({ length: s }, () => newId()));
          return new Set(all).size === all.length;
        },
      ),
      { numRuns: 100 },
    );
  });
});
