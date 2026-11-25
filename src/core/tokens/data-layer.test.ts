import { beforeAll, describe, expect, it } from 'vitest';
import { installBoardValidator } from '../../../test/helpers/validator';
import { createEmptyDocument, parse, serialize } from '../format';
import { normalise } from '../tools/element-tools';
import { documentFields, isSchemaV2Field, type BoardDocument } from '../model';

beforeAll(() => {
  installBoardValidator();
}, 60_000);

function docWith(extra: Record<string, unknown>): string {
  const base = JSON.parse(serialize(createEmptyDocument())) as Record<string, unknown>;
  return JSON.stringify({ ...base, ...extra });
}

describe('tokens in the data layer', () => {
  it('round-trips tokens and unknown nested properties', () => {
    const text = docWith({
      tokens: { colors: { brand: '#112233' }, fonts: { body: 'Inter' }, numbers: { gap: 8 }, future: { a: 1 } },
    });
    const r = parse(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc: BoardDocument = r.doc;
    expect(doc.tokens?.colors?.['brand']).toBe('#112233');
    const out = JSON.parse(serialize(doc)) as { tokens: Record<string, unknown> };
    expect(out.tokens['future']).toEqual({ a: 1 });
    expect(out.tokens['numbers']).toEqual({ gap: 8 });
  });

  it('rejects a Token_Reference as a Token value', () => {
    expect(parse(docWith({ tokens: { colors: { a: 'token:b' } } })).ok).toBe(false);
    expect(parse(docWith({ tokens: { fonts: { a: 'token:b' } } })).ok).toBe(false);
  });

  it('rejects more than 500 tokens in a category', () => {
    const numbers: Record<string, number> = {};
    for (let i = 0; i < 501; i++) numbers[`n${i}`] = i;
    expect(parse(docWith({ tokens: { numbers } })).ok).toBe(false);
  });

  it('registers tokens as a schema-v2 document field', () => {
    expect(documentFields()).toContain('tokens');
    expect(isSchemaV2Field('tokens')).toBe(true);
  });

  it('accepts token references in color fields and fontFamily', () => {
    const size = { width: 100, height: 50 };
    const n = normalise('text', { fill: 'token:brand', textColor: 'token:ink', fontFamily: 'token:body' }, size, 'e');
    expect(n.style['fill']).toBe('token:brand');
    expect(n.top['textColor']).toBe('token:ink');
    expect(n.top['fontFamily']).toBe('token:body');
    expect(() => normalise('text', { fill: 'token:bad name' }, size, 'e')).toThrow();
  });
});
