import { beforeAll, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Element } from '../model/types';
import { getBoardValidator } from '../../../test/helpers/validator';
import { createEmptyDocument, parse, setBoardValidator } from '../format/parser';
import { serialize } from '../format/serializer';
import { renderToSvg } from './svg';

const style = { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, strokeStyle: 'solid', opacity: 1, cornerRadius: 0 } as const;

/** Names of 1..64 characters, biased toward markup/attribute-breaking characters. */
const nameArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 64 }),
  fc.string({
    unit: fc.constantFrom('<', '>', '&', '"', "'", '/', '=', ' ', 'a', 'b', '\\', '{', '}', 'é'),
    minLength: 1,
    maxLength: 64,
  }),
  fc.constantFrom(
    '"><script>alert(1)</script>',
    '"/><foreignObject/><"',
    '</svg><svg onload=alert(1)>',
    "' onmouseover='x",
  ),
);

function iconElement(name: string): Element {
  return { id: 'i1', type: 'icon', x: 10, y: 20, width: 24, height: 24, rotation: 0, style: { ...style }, name } as Element;
}

describe('Property 32: Icon name round trip and safe rendering', () => {
  beforeAll(() => setBoardValidator(getBoardValidator()), 60_000);

  it('**Validates: Requirements 23.6, 23.13, 23.14, 23.15** name survives serialize/parse and renders safely', () => {
    fc.assert(
      fc.property(nameArb, (name) => {
        const doc = { ...createEmptyDocument(), elements: [iconElement(name)] };
        const parsed = parse(serialize(doc));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const el = parsed.doc.elements[0] as Element & { name?: string };
        expect(el.type).toBe('icon');
        expect(el.name).toBe(name);

        const out = renderToSvg(parsed.doc, parsed.doc.elements);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        const svg = (out.value as { svg?: string }).svg ?? String(out.value);
        // No injected elements, no external references.
        expect(svg).not.toMatch(/<script|<foreignObject|<image|<use|<a[\s>]|\son\w+=/i);
        // Every attribute value must be properly quoted: no raw quote/angle inside the icon path tag.
        const tag = /<path d="([^"]*)" transform=/.exec(svg);
        expect(tag).not.toBeNull();
        expect(tag![1]).not.toMatch(/[<>]/);
        // Well-formed: total tag count of `<` equals `>` outside attribute values.
        const stripped = svg.replace(/"[^"]*"/g, '""');
        expect(stripped.split('<').length).toBe(stripped.split('>').length);
      }),
      { numRuns: 200 },
    );
  });
});
