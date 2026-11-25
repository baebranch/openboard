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

// Feature: openboard, Property 1: Document round trip
describe('Feature: openboard, Property 1: Document round trip', () => {
  it('parse(serialize(doc)) equals doc (ids and text run formatting retained)', () => {
    // **Validates: Requirements 11.5, 11.6, 11.4, 6.11**
    fc.assert(
      fc.property(arbBoardDocument(40), (doc) => {
        const result = parse(serialize(doc), { validator });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.readOnly).toBe(false);
        expect(result.doc).toEqual(doc);
        expect(result.doc.elements.map((e) => e.id)).toEqual(doc.elements.map((e) => e.id));
        const runsOf = (d: typeof doc) =>
          d.elements.flatMap((e) => ('runs' in e ? e.runs : []));
        expect(runsOf(result.doc)).toEqual(runsOf(doc));
        // Serialization is stable after one round trip.
        expect(serialize(result.doc)).toBe(serialize(doc));
      }),
      { numRuns: 150 },
    );
  });

  it('retains bold/italic/underline on a concrete text element', () => {
    const doc = fc.sample(arbBoardDocument(5), 1)[0]!;
    const text = {
      id: 'el-text',
      type: 'text' as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      style: { fill: 'theme:default' as const, stroke: 'theme:default' as const, strokeWidth: 1, strokeStyle: 'solid' as const, opacity: 100, cornerRadius: 0 },
      runs: [{ text: 'a', bold: true, italic: true, underline: true }, { text: 'b' }],
      fontFamily: 'serif',
      fontSize: 14,
      align: 'left' as const,
    };
    const input = { ...doc, elements: [text], assets: [] };
    const r = parse(serialize(input), { validator });
    expect(r.ok && r.doc).toEqual(input);
  });
});
