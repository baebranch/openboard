import { describe, expect, it } from 'vitest';
import {
  countTokenReferences,
  detachTokenReferences,
  renameTokenReferences,
  resolveTokens,
  resolveTokenValue,
  scanTokenReferences,
  validateNewToken,
  validateTokenName,
  validateTokenValue,
} from './index';

describe('token validation', () => {
  it('validates names', () => {
    expect(validateTokenName('brand.primary-1_a').ok).toBe(true);
    expect(validateTokenName('').ok).toBe(false);
    expect(validateTokenName('a'.repeat(65)).ok).toBe(false);
    expect(validateTokenName('a'.repeat(64)).ok).toBe(true);
    expect(validateTokenName('has space').ok).toBe(false);
  });

  it('validates values per category and rejects references', () => {
    expect(validateTokenValue('colors', '#ff0000').ok).toBe(true);
    expect(validateTokenValue('colors', 'nope').ok).toBe(false);
    expect(validateTokenValue('fonts', '').ok).toBe(false);
    expect(validateTokenValue('fonts', 'x'.repeat(201)).ok).toBe(false);
    expect(validateTokenValue('numbers', Infinity).ok).toBe(false);
    expect(validateTokenValue('numbers', 4).ok).toBe(true);
    const r = validateTokenValue('colors', 'token:other');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('token_reference_value');
  });

  it('rejects duplicates case-sensitively', () => {
    const tokens = { colors: { Primary: '#111111' } };
    expect(validateNewToken(tokens, 'colors', 'Primary', '#222222').ok).toBe(false);
    expect(validateNewToken(tokens, 'colors', 'primary', '#222222').ok).toBe(true);
  });
});

describe('token resolution and references', () => {
  const tokens = { colors: { brand: '#112233' }, fonts: { body: 'Inter' } };
  const el = { id: 'a', style: { fill: 'token:brand', stroke: '#000000' }, fontFamily: 'token:body', textColor: 'token:gone' };

  it('resolves references and reports missing tokens as undefined', () => {
    const r = resolveTokens(tokens);
    expect(resolveTokenValue(r, 'colors', 'token:brand')).toBe('#112233');
    expect(resolveTokenValue(r, 'colors', 'token:gone')).toBeUndefined();
    expect(resolveTokenValue(r, 'colors', '#abcdef')).toBe('#abcdef');
  });

  it('scans and counts references', () => {
    expect(scanTokenReferences(el)).toHaveLength(3);
    expect(countTokenReferences(el, 'colors', 'brand')).toBe(1);
    expect(countTokenReferences(el, 'fonts', 'brand')).toBe(0);
  });

  it('renames references without mutating and keeps identity when unchanged', () => {
    const out = renameTokenReferences(el, 'colors', 'brand', 'accent');
    expect(out.style.fill).toBe('token:accent');
    expect(el.style.fill).toBe('token:brand');
    expect(renameTokenReferences(el, 'colors', 'zzz', 'y')).toBe(el);
  });

  it('detaches references to literals, using a fallback for missing tokens', () => {
    const out = detachTokenReferences(el, tokens, { fallback: { colors: '#000001' } });
    expect(out.style.fill).toBe('#112233');
    expect(out.fontFamily).toBe('Inter');
    expect(out.textColor).toBe('#000001');
    const only = detachTokenReferences(el, tokens, { only: { category: 'fonts', name: 'body' } });
    expect(only.fontFamily).toBe('Inter');
    expect(only.style.fill).toBe('token:brand');
  });
});
