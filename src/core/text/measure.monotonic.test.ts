import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { measure } from './measure';

// Feature: mockup-design-features, Property 12: Text_Measurer width monotonicity (metamorphic)
describe('Property 12: Text_Measurer width monotonicity', () => {
  /** **Validates: Requirements 8.11** */
  it('line count does not increase when availableWidth increases', () => {
    const text = fc.oneof(
      fc.string({ maxLength: 120 }),
      fc.array(fc.stringMatching(/^[A-Za-z0-9@]{1,12}$/), { maxLength: 20 }).map((w) => w.join(' ')),
      fc.array(fc.stringMatching(/^[A-Za-z ]{0,15}$/), { maxLength: 5 }).map((w) => w.join('\n')),
    );
    fc.assert(
      fc.property(
        text,
        fc.constantFrom('sans-serif', 'serif', 'monospace'),
        fc.double({ min: 1, max: 80, noNaN: true }),
        fc.integer({ min: 100, max: 900 }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        (t, fontFamily, fontSize, fontWeight, a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const narrow = measure({ text: t, fontFamily, fontSize, fontWeight, availableWidth: lo });
          const wide = measure({ text: t, fontFamily, fontSize, fontWeight, availableWidth: hi });
          const inf = measure({ text: t, fontFamily, fontSize, fontWeight, availableWidth: Infinity });
          expect(narrow.ok && wide.ok && inf.ok).toBe(true);
          if (narrow.ok && wide.ok && inf.ok) {
            expect(wide.value.lines.length).toBeLessThanOrEqual(narrow.value.lines.length);
            expect(inf.value.lines.length).toBeLessThanOrEqual(wide.value.lines.length);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
