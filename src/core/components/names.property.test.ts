import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { uniqueComponentName } from './names';
import { COMPONENT_NAME_MAX } from './types';

// Feature: mockup-design-features, Property 20: Component name de-duplication
describe('Property 20: Component name de-duplication', () => {
  /** **Validates: Requirements 13.9** */
  it('returns an unused name of at most 100 characters, equal to the desired name when free', () => {
    // Small alphabet and short names make collisions (including suffix collisions) frequent.
    const shortName = fc.string({ unit: fc.constantFrom('a', 'b', ' ', '2', '3'), minLength: 1, maxLength: 4 });
    const longName = fc.string({ unit: fc.constantFrom('a', 'b'), minLength: 90, maxLength: COMPONENT_NAME_MAX });
    const name = fc.oneof(shortName, longName);
    fc.assert(
      fc.property(
        fc.array(name, { maxLength: 30 }),
        name,
        fc.boolean(),
        (existingBase, desired, includeDesired) => {
          const existing = includeDesired ? [...existingBase, desired] : existingBase;
          // Also force collisions with the generated suffix candidates.
          const withSuffixes = includeDesired ? [...existing, `${desired} 2`, `${desired.slice(0, 97)} 3`] : existing;
          const result = uniqueComponentName(desired, withSuffixes);
          expect(withSuffixes.includes(result)).toBe(false);
          expect(result.length).toBeLessThanOrEqual(COMPONENT_NAME_MAX);
          if (!withSuffixes.includes(desired)) expect(result).toBe(desired);
        },
      ),
      { numRuns: 200 },
    );
  });
});
