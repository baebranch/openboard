import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, serialize } from '../../src/core/format';
import type { BoardValidator } from '../../src/core/format';
import { arbMockupBoardDocument } from '../arbitraries';
import { getBoardValidator } from '../helpers/validator';

let validator: BoardValidator;
beforeAll(() => {
  validator = getBoardValidator();
});

// Feature: mockup-design-features, Property 1: Whole-document round trip
describe('Feature: mockup-design-features, Property 1: Whole-document round trip', () => {
  it('parse(serialize(doc)) deeply equals doc for documents using every Mockup_Field', () => {
    // **Validates: Requirements 3.10, 4.1, 4.4, 28.1**
    fc.assert(
      fc.property(arbMockupBoardDocument(15), (doc) => {
        const result = parse(serialize(doc), { validator });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc).toEqual(doc);
        expect(result.doc.elements).toEqual(doc.elements);
        expect(result.doc.assets).toEqual(doc.assets);
      }),
      { numRuns: 100 },
    );
  });
});
