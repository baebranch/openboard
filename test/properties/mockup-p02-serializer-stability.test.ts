import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, serialize } from '../../src/core/format';
import type { BoardValidator } from '../../src/core/format';
import {
  arbComponentNestingDocument,
  arbLayoutTreeDocument,
  arbMockupBoardDocument,
  arbNestedFrameDocument,
  arbSchemaV1Document,
  arbSchemaV2Document,
} from '../arbitraries';
import { getBoardValidator } from '../helpers/validator';

let validator: BoardValidator;
beforeAll(() => {
  validator = getBoardValidator();
});

function expectStable(doc: Parameters<typeof serialize>[0]): void {
  const first = serialize(doc);
  const parsed = parse(first, { validator });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(serialize(parsed.doc)).toBe(first);
}

// Feature: mockup-design-features, Property 2: Serializer stability
describe('Feature: mockup-design-features, Property 2: Serializer stability', () => {
  it('serialize(parse(serialize(doc))) is byte-identical to serialize(doc)', () => {
    // **Validates: Requirements 3.11**
    fc.assert(fc.property(arbMockupBoardDocument(), expectStable), { numRuns: 100 });
  });

  it('holds for v1, v2, nested-frame, component-nesting, and layout-tree documents', () => {
    // **Validates: Requirements 3.11**
    fc.assert(
      fc.property(
        fc.oneof(
          arbSchemaV1Document(),
          arbSchemaV2Document(),
          arbNestedFrameDocument(),
          arbComponentNestingDocument(),
          arbLayoutTreeDocument(),
        ),
        expectStable,
      ),
      { numRuns: 100 },
    );
  });
});
