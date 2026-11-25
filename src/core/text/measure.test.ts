import { describe, expect, it } from 'vitest';
import { measure } from './measure';

const base = { text: '', fontFamily: 'x', fontSize: 10, availableWidth: Infinity };

function lines(text: string, availableWidth: number): string[] {
  const r = measure({ ...base, text, availableWidth });
  if (!r.ok) throw new Error(r.error);
  return r.value.lines;
}

describe('measure', () => {
  it('rejects invalid font size and width', () => {
    expect(measure({ ...base, fontSize: 0 }).ok).toBe(false);
    expect(measure({ ...base, fontSize: NaN }).ok).toBe(false);
    expect(measure({ ...base, availableWidth: NaN }).ok).toBe(false);
  });

  it('splits explicit newlines without wrapping', () => {
    const r = measure({ ...base, text: 'a\r\nb\nc' });
    expect(r.ok && r.value.lines).toEqual(['a', 'b', 'c']);
    expect(r.ok && r.value.height).toBeCloseTo(36);
  });

  it('wraps greedily on whitespace', () => {
    expect(lines('aaa bbb ccc', 40)).toEqual(['aaa bbb', 'ccc']);
  });

  it('breaks overlong words by character', () => {
    const out = lines('abcdefghij', 20);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join('')).toBe('abcdefghij');
  });

  it('puts one character per line when narrower than a character', () => {
    expect(lines('abc', 1)).toEqual(['a', 'b', 'c']);
  });

  it('uses 1em fallback for non-ASCII', () => {
    const r = measure({ ...base, text: '漢' });
    expect(r.ok && r.value.widestLine).toBe(10);
  });
});

describe('measure edge cases (task 5.9)', () => {
  it('returns error outcomes for every invalid font size and width', () => {
    for (const fontSize of [0, -1, NaN, Infinity, -Infinity]) {
      const r = measure({ ...base, text: 'a', fontSize });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/fontSize/);
    }
    for (const availableWidth of [NaN, -Infinity]) {
      const r = measure({ ...base, text: 'a', availableWidth });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/availableWidth/);
    }
  });

  it('keeps blank lines and a trailing newline as empty lines', () => {
    expect(lines('a\n\nb\n', Infinity)).toEqual(['a', '', 'b', '']);
    expect(lines('a\n\nb\n', 100)).toEqual(['a', '', 'b', '']);
  });

  it('returns one empty line for empty text', () => {
    const r = measure({ ...base, text: '' });
    expect(r.ok && r.value.lines).toEqual(['']);
    expect(r.ok && r.value.widestLine).toBe(0);
    expect(r.ok && r.value.height).toBeCloseTo(12);
  });

  it('wraps each explicit-newline segment independently', () => {
    expect(lines('aaa bbb\nccc', 40)).toEqual(['aaa bbb', 'ccc']);
  });

  it('breaks an overlong word across lines and loses no characters', () => {
    const out = lines('abcdefghijklmnop', 20);
    expect(out.length).toBeGreaterThan(2);
    expect(out.join('')).toBe('abcdefghijklmnop');
    for (const l of out) expect(l.length).toBeGreaterThanOrEqual(1);
  });

  it('starts an overlong word on a new line after a short word', () => {
    const out = lines('hi abcdefghij', 20);
    expect(out[0]).toBe('hi');
    expect(out.slice(1).join('')).toBe('abcdefghij');
  });

  it('gives one character per line for zero and negative widths', () => {
    expect(lines('abc', 0)).toEqual(['a', 'b', 'c']);
    expect(lines('abc', -5)).toEqual(['a', 'b', 'c']);
    expect(lines('ab cd', 1)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('computes height as lines times fontSize times 1.2', () => {
    const r = measure({ ...base, text: 'a', availableWidth: 1, fontSize: 20 });
    expect(r.ok && r.value.height).toBeCloseTo(24);
    const r3 = measure({ ...base, text: 'abc', availableWidth: 1, fontSize: 20 });
    expect(r3.ok && r3.value.height).toBeCloseTo(72);
  });

  it('measures 10,000 characters within 20 ms', () => {
    const text = 'lorem ipsum dolor sit amet '.repeat(400).slice(0, 10000);
    expect(text.length).toBe(10000);
    measure({ ...base, text, availableWidth: 300 }); // warm up
    const start = performance.now();
    const r = measure({ ...base, text, availableWidth: 300 });
    const elapsed = performance.now() - start;
    expect(r.ok).toBe(true);
    expect(elapsed).toBeLessThan(20);
  });
});
