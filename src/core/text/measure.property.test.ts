import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { measure } from './measure';

const stripWs = (s: string): string => s.replace(/\s/g, '');

describe('Feature: mockup-design-features, Property 11: Text_Measurer round trip', () => {
  /** **Validates: Requirements 8.10** */
  it('wrapped lines, concatenated and stripped of whitespace, equal the stripped input', () => {
    const textArb = fc.oneof(
      fc.string({ maxLength: 200 }),
      fc.string({ unit: 'binary', maxLength: 120 }),
      fc.array(fc.constantFrom('foo', 'bar', 'Wide', 'x', ' ', '\n', '\r\n', '\t', 'ééé', '😀'), {
        maxLength: 40,
      }).map((a) => a.join('')),
    );
    fc.assert(
      fc.property(
        textArb,
        fc.string({ maxLength: 10 }),
        fc.double({ min: 1, max: 96, noNaN: true }),
        fc.integer({ min: 100, max: 900 }),
        fc.oneof(
          fc.constant(Infinity),
          fc.double({ min: 0, max: 600, noNaN: true }),
        ),
        (text, fontFamily, fontSize, fontWeight, availableWidth) => {
          const r = measure({ text, fontFamily, fontSize, fontWeight, availableWidth });
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(stripWs(r.value.lines.join(''))).toBe(stripWs(text));
        },
      ),
      { numRuns: 200 },
    );
  });
});
