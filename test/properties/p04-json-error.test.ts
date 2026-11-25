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

/**
 * Independent oracle: a strict RFC 8259 scanner returning the offset of the first character that
 * cannot extend a valid JSON prefix (or text.length when the text ends prematurely).
 * Returns null when the text is valid JSON.
 */
function failureOffset(s: string): number | null {
  let i = 0;
  const fail = (at: number): never => {
    throw at;
  };
  const ws = () => {
    while (i < s.length && ' \t\n\r'.includes(s[i]!)) i++;
  };
  const digits = (min: number) => {
    let n = 0;
    while (i < s.length && s[i]! >= '0' && s[i]! <= '9') {
      i++;
      n++;
    }
    if (n < min) fail(i);
  };
  const literal = (w: string) => {
    for (const ch of w) {
      if (s[i] !== ch) fail(i);
      i++;
    }
  };
  const string = () => {
    i++; // opening quote
    for (;;) {
      if (i >= s.length) fail(i);
      const c = s[i]!;
      if (c === '"') {
        i++;
        return;
      }
      if (c.charCodeAt(0) < 0x20) fail(i);
      if (c === '\\') {
        i++;
        const e = s[i];
        if (e === undefined || !'"\\/bfnrtu'.includes(e)) fail(i);
        i++;
        if (e === 'u') {
          for (let k = 0; k < 4; k++) {
            if (!/[0-9a-fA-F]/.test(s[i] ?? '')) fail(i);
            i++;
          }
        }
      } else i++;
    }
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      ws();
      if (s[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (s[i] !== '"') fail(i);
        string();
        ws();
        if (s[i] !== ':') fail(i);
        i++;
        value();
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === '}') {
          i++;
          return;
        }
        fail(i);
      }
    } else if (c === '[') {
      i++;
      ws();
      if (s[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === ']') {
          i++;
          return;
        }
        fail(i);
      }
    } else if (c === '"') string();
    else if (c === 't') literal('true');
    else if (c === 'f') literal('false');
    else if (c === 'n') literal('null');
    else if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) {
      if (c === '-') i++;
      if (s[i] === '0') i++;
      else if (s[i] !== undefined && s[i]! >= '1' && s[i]! <= '9') digits(1);
      else fail(i);
      if (s[i] === '.') {
        i++;
        digits(1);
      }
      if (s[i] === 'e' || s[i] === 'E') {
        i++;
        if (s[i] === '+' || s[i] === '-') i++;
        digits(1);
      }
    } else fail(i);
  };
  try {
    value();
    ws();
    if (i < s.length) fail(i);
    return null;
  } catch (e) {
    if (typeof e === 'number') return e;
    throw e;
  }
}

/** Offset of the 1-based (line, column) in text, or null when it lies outside the text. */
function offsetOf(text: string, line: number, column: number): number | null {
  let l = 1;
  let start = 0;
  for (let i = 0; i < text.length && l < line; i++) {
    const c = text[i];
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      l++;
      start = i + 1;
    }
  }
  if (l !== line) return null;
  return start + column - 1;
}

const lineCount = (t: string) => t.split(/\r\n|\n|\r/).length;

const INSERTS = ['{', '}', '[', ']', '"', ',', ':', 'x', '\\', '\n', '01', '-', 'tru'];

type Corruption =
  | { op: 'insert'; at: number; s: string }
  | { op: 'delete'; at: number }
  | { op: 'replace'; at: number; s: string }
  | { op: 'truncate'; at: number };

const arbCorruption: fc.Arbitrary<Corruption> = fc.oneof(
  fc.record({ op: fc.constant('insert' as const), at: fc.nat(), s: fc.constantFrom(...INSERTS) }),
  fc.record({ op: fc.constant('delete' as const), at: fc.nat() }),
  fc.record({ op: fc.constant('replace' as const), at: fc.nat(), s: fc.constantFrom(...INSERTS) }),
  fc.record({ op: fc.constant('truncate' as const), at: fc.nat() }),
);

function apply(text: string, c: Corruption): { text: string; at: number } {
  const at = c.at % Math.max(1, text.length);
  switch (c.op) {
    case 'insert':
      return { text: text.slice(0, at) + c.s + text.slice(at), at };
    case 'delete':
      return { text: text.slice(0, at) + text.slice(at + 1), at };
    case 'replace':
      return { text: text.slice(0, at) + c.s + text.slice(at + 1), at };
    case 'truncate':
      return { text: text.slice(0, at), at };
  }
}

// Feature: openboard, Property 4: Invalid JSON reports a correct position
describe('Feature: openboard, Property 4: Invalid JSON reports a correct position', () => {
  it('reports a 1-based line and column inside the text, at the true failure position', () => {
    // **Validates: Requirements 11.7**
    fc.assert(
      fc.property(
        arbBoardDocument(15),
        fc.boolean(),
        arbCorruption,
        (doc, reindent, corruption) => {
          const base = reindent ? JSON.stringify(JSON.parse(serialize(doc)), null, 2) : serialize(doc);
          const { text, at } = apply(base, corruption);
          const expected = failureOffset(text);
          // Skip corruptions that happen to keep the text valid JSON, or blank text (empty file is valid).
          fc.pre(expected !== null && text.trim() !== '');
          // Sanity check the oracle against the engine.
          expect(() => JSON.parse(text)).toThrow();

          const result = parse(text, { validator });
          expect(result.ok).toBe(false);
          if (result.ok || result.kind !== 'json') {
            expect(result.ok === false && result.kind).toBe('json');
            return;
          }
          expect(Number.isInteger(result.line)).toBe(true);
          expect(Number.isInteger(result.column)).toBe(true);
          expect(result.line).toBeGreaterThanOrEqual(1);
          expect(result.column).toBeGreaterThanOrEqual(1);
          expect(result.line).toBeLessThanOrEqual(lineCount(text));

          const actual = offsetOf(text, result.line, result.column);
          expect(actual).not.toBeNull();
          if (actual === null || expected === null) return;
          expect(actual).toBeLessThanOrEqual(text.length);
          // At or after the first corrupted character (the prefix before it is valid).
          expect(actual).toBeGreaterThanOrEqual(Math.min(at, expected));
          // Same line as, and within one character of, the true failure offset.
          expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reports line 1 column 1 for a bare invalid token and the end for truncated input', () => {
    const bad = parse('x', { validator });
    expect(bad).toMatchObject({ ok: false, kind: 'json', line: 1, column: 1 });
    const cut = parse('{\n  "a": [1,\n', { validator });
    expect(cut.ok).toBe(false);
    if (!cut.ok && cut.kind === 'json') expect(cut.line).toBeGreaterThanOrEqual(2);
  });
});
