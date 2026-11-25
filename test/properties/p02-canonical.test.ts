import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, serialize } from '../../src/core/format';
import type { BoardValidator } from '../../src/core/format';
import { arbBoardDocument } from '../arbitraries';
import { getBoardValidator } from '../helpers/validator';

let validator: BoardValidator;
beforeAll(() => {
  validator = getBoardValidator();
});

const INTEGER_KEY = /^(0|[1-9]\d*)$/;

/** Asserts keys are sorted at every object level (integer-like keys are reordered by JSON.parse, so skipped). */
function expectSortedKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectSortedKeys);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => !INTEGER_KEY.test(k));
  expect(keys).toEqual([...keys].sort());
  for (const k of Object.keys(obj)) expectSortedKeys(obj[k]);
}

// Feature: openboard, Property 2: Serialization is canonical and idempotent
describe('Feature: openboard, Property 2: Serialization is canonical and idempotent', () => {
  it('is byte-identical across calls and stable through parse', () => {
    // **Validates: Requirements 11.1, 11.3**
    fc.assert(
      fc.property(arbBoardDocument(40), (doc) => {
        const first = serialize(doc);
        expect(serialize(doc)).toBe(first);
        const parsed = parse(first, { validator });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(serialize(parsed.doc)).toBe(first);
      }),
      { numRuns: 150 },
    );
  });

  it('uses sorted keys, 2-space indent, LF only, trailing newline, and required top-level fields', () => {
    // **Validates: Requirements 11.1, 11.3**
    fc.assert(
      fc.property(arbBoardDocument(40), (doc) => {
        const text = serialize(doc);
        expect(text.includes('\r')).toBe(false);
        expect(text.endsWith('}\n')).toBe(true);
        expect(text.endsWith('\n\n')).toBe(false);
        // Every indented line uses an even number of leading spaces and no tabs.
        for (const line of text.split('\n')) {
          expect(line).toMatch(/^( {2})*(?! |\t)/);
        }
        const json = JSON.parse(text) as Record<string, unknown>;
        // Re-stringifying with 2-space indent reproduces the text only if key order is preserved.
        expect(JSON.stringify(json, null, 2) + '\n').toBe(text);
        expectSortedKeys(json);
        for (const key of ['schemaVersion', 'meta', 'elements', 'assets', 'library', 'viewport']) {
          expect(json).toHaveProperty(key);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('emits elements in stored z-order', () => {
    // **Validates: Requirements 11.1, 11.3**
    fc.assert(
      fc.property(arbBoardDocument(40), (doc) => {
        const json = JSON.parse(serialize(doc)) as { elements: Array<{ id: string }> };
        expect(json.elements.map((e) => e.id)).toEqual(doc.elements.map((e) => e.id));
      }),
      { numRuns: 100 },
    );
  });

  it('sorts keys of a hand-built unsorted document', () => {
    const doc = fc.sample(arbBoardDocument(3), 1)[0]!;
    const text = serialize(doc);
    expect(text.indexOf('"assets"')).toBeLessThan(text.indexOf('"elements"'));
    expect(text.indexOf('"schemaVersion"')).toBeGreaterThan(text.indexOf('"meta"'));
  });
});
