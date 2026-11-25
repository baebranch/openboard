import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format';
import { effectiveSchemaVersion, hasSchemaV2Feature } from '../../src/core/format/schema-version';
import { arbSchemaV1Document, arbSchemaV2Document } from '../arbitraries';

const NUM_RUNS = 100;

// Feature: mockup-design-features, Property 3: Lowest-representable schema version
// **Validates: Requirements 3.1, 3.2, 3.3, 3.14, 11.14, 13.11, 14.16, 19.12, 23.12**
describe('Feature: mockup-design-features, Property 3: Lowest-representable schema version', () => {
  it('documents without a Schema_V2_Feature are version 1, whatever version the document claims', () => {
    fc.assert(
      fc.property(arbSchemaV1Document(), fc.constantFrom(1, 2), (doc, claimed) => {
        const d = { ...doc, schemaVersion: claimed };
        expect(hasSchemaV2Feature(d)).toBe(false);
        expect(effectiveSchemaVersion(d)).toBe(1);
        expect(JSON.parse(serialize(d)).schemaVersion).toBe(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('documents with a Schema_V2_Feature are version 2, whatever version the document claims', () => {
    fc.assert(
      fc.property(arbSchemaV2Document(), fc.constantFrom(1, 2), (doc, claimed) => {
        const d = { ...doc, schemaVersion: claimed };
        expect(hasSchemaV2Feature(d)).toBe(true);
        expect(effectiveSchemaVersion(d)).toBe(2);
        expect(JSON.parse(serialize(d)).schemaVersion).toBe(2);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('version is 2 if and only if a Schema_V2_Feature is present (either generator)', () => {
    fc.assert(
      fc.property(fc.oneof(arbSchemaV1Document(), arbSchemaV2Document()), (doc) => {
        expect(effectiveSchemaVersion(doc) === 2).toBe(hasSchemaV2Feature(doc));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
