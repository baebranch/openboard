// Pure text run model: restricted runs (bold, italic, underline), whitelist
// HTML import, escaping, range styling, and SVG data URI helper.
import type { TextRun } from '../model/types';

export type RunStyleKey = 'bold' | 'italic' | 'underline';
export type RunStyle = Partial<Record<RunStyleKey, boolean>>;

const STYLE_KEYS: readonly RunStyleKey[] = ['bold', 'italic', 'underline'];

function makeRun(text: string, style: RunStyle): TextRun {
  const run: TextRun = { text };
  if (style.bold) run.bold = true;
  if (style.italic) run.italic = true;
  if (style.underline) run.underline = true;
  return run;
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline;
}

/** Drops empty runs, strips unknown/false props, and merges adjacent equal-style runs. */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (typeof r.text !== 'string' || r.text === '') continue;
    const next = makeRun(r.text, r);
    const last = out[out.length - 1];
    if (last && sameStyle(last, next)) last.text += next.text;
    else out.push(next);
  }
  return out;
}

export function runsToPlainText(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

export function runsLength(runs: readonly TextRun[]): number {
  return runs.reduce((n, r) => n + r.text.length, 0);
}

/** Builds runs from plain text with a uniform style. */
export function plainTextToRuns(text: string, style: RunStyle = {}): TextRun[] {
  return normalizeRuns([makeRun(text, style)]);
}

/**
 * Applies (or removes) one style on the character range [start, end).
 * Offsets are clamped to the text length; a collapsed range is a no-op.
 */
export function applyStyleToRange(
  runs: readonly TextRun[],
  start: number,
  end: number,
  key: RunStyleKey,
  value: boolean,
): TextRun[] {
  const total = runsLength(runs);
  const s = Math.max(0, Math.min(start, end, total));
  const e = Math.min(total, Math.max(start, end));
  if (s >= e) return normalizeRuns(runs);
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const rs = pos;
    const re = pos + r.text.length;
    pos = re;
    if (re <= s || rs >= e) {
      out.push(r);
      continue;
    }
    const a = Math.max(s, rs) - rs;
    const b = Math.min(e, re) - rs;
    if (a > 0) out.push(makeRun(r.text.slice(0, a), r));
    out.push(makeRun(r.text.slice(a, b), { ...r, [key]: value }));
    if (b < r.text.length) out.push(makeRun(r.text.slice(b), r));
  }
  return normalizeRuns(out);
}

/** True if every character in [start, end) has the style (used for toggle state). */
export function rangeHasStyle(
  runs: readonly TextRun[],
  start: number,
  end: number,
  key: RunStyleKey,
): boolean {
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  let pos = 0;
  let seen = false;
  for (const r of runs) {
    const rs = pos;
    const re = pos + r.text.length;
    pos = re;
    if (re <= s || rs >= e) continue;
    seen = true;
    if (!r[key]) return false;
  }
  return seen;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(text: string): string {
  return escapeHtml(text).replace(/&#39;/g, '&apos;');
}

/** Serialises runs to whitelisted, escaped HTML (b, i, u, br only). */
export function runsToHtml(runs: readonly TextRun[]): string {
  return normalizeRuns(runs)
    .map((r) => {
      let html = escapeHtml(r.text).replace(/\r?\n/g, '<br>');
      if (r.underline) html = `<u>${html}</u>`;
      if (r.italic) html = `<i>${html}</i>`;
      if (r.bold) html = `<b>${html}</b>`;
      return html;
    })
    .join('');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

const TAG_RE = /<(!--[\s\S]*?-->|[^>]*>?)/g;
const DROP_CONTENT_TAGS = new Set(['script', 'style', 'template', 'iframe', 'object', 'noscript']);
const BOLD_TAGS = new Set(['b', 'strong']);
const ITALIC_TAGS = new Set(['i', 'em']);
const UNDERLINE_TAGS = new Set(['u']);
const BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']);

/**
 * Imports arbitrary (e.g. pasted) HTML into runs, keeping only bold, italic,
 * underline, and line breaks. Everything else (tags, attributes, scripts,
 * styles) is discarded; text content is entity-decoded, never executed.
 */
export function htmlToRuns(html: string): TextRun[] {
  const out: TextRun[] = [];
  let bold = 0;
  let italic = 0;
  let underline = 0;
  let dropDepth = 0;
  let dropTag = '';
  const emit = (text: string): void => {
    if (text) out.push(makeRun(text, { bold: bold > 0, italic: italic > 0, underline: underline > 0 }));
  };
  const newline = (): void => {
    const last = out[out.length - 1];
    if (out.length > 0 && !(last && last.text.endsWith('\n'))) emit('\n');
  };
  let idx = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (dropDepth === 0) emit(decodeEntities(html.slice(idx, m.index)));
    idx = m.index + m[0].length;
    const body = m[1] ?? '';
    if (body.startsWith('!--')) continue;
    const tm = /^(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(body);
    if (!tm) {
      continue;
    }
    const closing = tm[1] === '/';
    const name = (tm[2] ?? '').toLowerCase();
    const selfClosing = /\/\s*>?$/.test(body);
    if (dropDepth > 0) {
      if (name === dropTag) {
        if (closing) dropDepth--;
        else if (!selfClosing) dropDepth++;
      }
      continue;
    }
    if (DROP_CONTENT_TAGS.has(name)) {
      if (!closing && !selfClosing) {
        dropDepth = 1;
        dropTag = name;
      }
      continue;
    }
    const delta = closing ? -1 : 1;
    if (BOLD_TAGS.has(name)) bold = Math.max(0, bold + delta);
    else if (ITALIC_TAGS.has(name)) italic = Math.max(0, italic + delta);
    else if (UNDERLINE_TAGS.has(name)) underline = Math.max(0, underline + delta);
    else if (name === 'br') emit('\n');
    else if (BLOCK_TAGS.has(name) && closing) newline();
  }
  if (dropDepth === 0) emit(decodeEntities(html.slice(idx)));
  const merged = normalizeRuns(out);
  // Trim a single trailing newline introduced by a closing block tag.
  const last = merged[merged.length - 1];
  if (last && last.text.endsWith('\n') && /<\/(p|div|li|h[1-6]|tr)\s*>\s*$/i.test(html)) {
    last.text = last.text.slice(0, -1);
    return normalizeRuns(merged);
  }
  return merged;
}

/** Encodes SVG markup as a base64-free image data URI usable only as <img src>. */
export function svgToDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

export { STYLE_KEYS };
