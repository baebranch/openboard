/**
 * Text_Measurer: pure, deterministic text measuring and wrapping.
 * Uses a synthetic glyph-width table (no DOM, canvas, or font access) so the
 * result is identical in every bundle and in the code-mode sandbox.
 */

export interface MeasureInput {
  text: string;
  /** Accepted but not used for width (one synthetic table for all fonts). */
  fontFamily: string;
  fontSize: number;
  /** Default 400. */
  fontWeight?: number;
  /** Infinity when no wrapping is wanted. */
  availableWidth: number;
}

export interface MeasureResult {
  lines: string[];
  widestLine: number;
  height: number;
}

export type MeasureOutcome = { ok: true; value: MeasureResult } | { ok: false; error: string };

/** Same line-height multiplier renderText uses. */
const LINE_HEIGHT = 1.2;
/** Width in em for characters outside printable ASCII. */
const FALLBACK_EM = 1.0;

function buildTable(): number[] {
  const table: number[] = [];
  const set = (chars: string, w: number): void => {
    for (const c of chars) table[c.charCodeAt(0) - 32] = w;
  };
  for (let i = 0; i < 95; i++) table[i] = 0.55; // default
  set(' ', 0.28);
  set("!',.:;|il`", 0.26);
  set('()-/[\\]Ifjrt{}', 0.34);
  set('"*^', 0.4);
  set('0123456789', 0.56);
  set('#$&?_abdeghknopqsuvxyzcL', 0.55);
  set('+<=>~', 0.58);
  set('ABCDEFGHJKNPRSTUVXYZ', 0.67);
  set('OQGDHMNU', 0.74);
  set('mw', 0.82);
  set('MW', 0.92);
  set('@', 1.0);
  return table;
}

const TABLE = buildTable();

function charEm(ch: string): number {
  const code = ch.charCodeAt(0);
  if (ch.length === 1 && code >= 32 && code <= 126) return TABLE[code - 32]!;
  return FALLBACK_EM;
}

function weightFactor(weight: number): number {
  const w = Number.isFinite(weight) ? Math.min(900, Math.max(100, weight)) : 400;
  return 1 + ((w - 400) / 500) * 0.1;
}

export function measure(input: MeasureInput): MeasureOutcome {
  const { text, fontSize, availableWidth } = input;
  if (typeof fontSize !== 'number' || !Number.isFinite(fontSize) || fontSize <= 0) {
    return { ok: false, error: 'fontSize must be a finite number greater than 0' };
  }
  if (
    typeof availableWidth !== 'number' ||
    Number.isNaN(availableWidth) ||
    availableWidth === -Infinity
  ) {
    return { ok: false, error: 'availableWidth must be finite or Infinity' };
  }

  const scale = fontSize * weightFactor(input.fontWeight ?? 400);
  const widthOf = (s: string): number => {
    let w = 0;
    for (const ch of Array.from(s)) w += charEm(ch);
    return w * scale;
  };

  const lines: string[] = [];
  for (const segment of String(text).split(/\r\n|\r|\n/)) {
    if (availableWidth === Infinity) {
      lines.push(segment);
      continue;
    }
    const words = segment.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    const spaceW = charEm(' ') * scale;
    let cur = '';
    let curW = 0;
    for (const word of words) {
      const wordW = widthOf(word);
      if (cur !== '' && curW + spaceW + wordW <= availableWidth) {
        cur += ' ' + word;
        curW += spaceW + wordW;
        continue;
      }
      if (cur !== '') {
        lines.push(cur);
        cur = '';
        curW = 0;
      }
      if (wordW <= availableWidth) {
        cur = word;
        curW = wordW;
        continue;
      }
      // Overlong word: break by character, at least one character per line.
      for (const ch of Array.from(word)) {
        const cw = charEm(ch) * scale;
        if (cur !== '' && curW + cw > availableWidth) {
          lines.push(cur);
          cur = '';
          curW = 0;
        }
        cur += ch;
        curW += cw;
      }
    }
    if (cur !== '') lines.push(cur);
  }

  let widest = 0;
  for (const l of lines) widest = Math.max(widest, widthOf(l));
  return {
    ok: true,
    value: { lines, widestLine: widest, height: lines.length * fontSize * LINE_HEIGHT },
  };
}
