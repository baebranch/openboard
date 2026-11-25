import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { renderToSvg } from '../../src/core/export/svg';
import type { BoardDocument, Element } from '../../src/core/model/types';
import { arbBoardDocument } from '../arbitraries';

// Feature: openboard, Property 58: SVG export is self-contained
// **Validates: Requirements 12.7**
describe('Feature: openboard, Property 58: SVG export is self-contained', () => {
  const opts = { numRuns: 100 };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ALLOWED_TAGS = new Set([
    'svg', 'g', 'rect', 'ellipse', 'polygon', 'polyline', 'path', 'line', 'circle', 'text', 'tspan', 'image',
  ]);
  const ENTITY = /&(?:amp|lt|gt|quot|#39);/g;

  interface Tag {
    name: string;
    attrs: Array<[string, string]>;
  }

  /** Minimal XML tokenizer: throws on anything malformed; checks nesting balance. */
  function tokenize(xml: string): Tag[] {
    const tags: Tag[] = [];
    const stack: string[] = [];
    const checkText = (t: string): void => {
      if (t.includes('<') || t.includes('>')) throw new Error(`raw markup char in text: ${t}`);
      if (/&/.test(t.replace(ENTITY, ''))) throw new Error(`bare ampersand in text: ${t}`);
    };
    let i = 0;
    while (i < xml.length) {
      if (xml[i] !== '<') {
        const j = xml.indexOf('<', i);
        const end = j === -1 ? xml.length : j;
        checkText(xml.slice(i, end));
        i = end;
        continue;
      }
      const close = /^<\/([A-Za-z][\w:-]*)>/.exec(xml.slice(i, i + 40));
      if (close) {
        if (stack.pop() !== close[1]) throw new Error(`unbalanced close </${close[1]}>`);
        i += close[0].length;
        continue;
      }
      const open = /^<([A-Za-z][\w:-]*)/.exec(xml.slice(i, i + 40));
      if (!open) throw new Error(`bad tag at ${i}`);
      const name = open[1]!;
      i += open[0].length;
      const attrs: Array<[string, string]> = [];
      const attrRe = /^\s+([A-Za-z_][\w:.-]*)="([^"<>]*)"/;
      for (;;) {
        const rest = xml.slice(i);
        const m = attrRe.exec(rest);
        if (!m) break;
        if (/&/.test(m[2]!.replace(ENTITY, ''))) throw new Error(`bad entity in attr ${m[1]}`);
        attrs.push([m[1]!, m[2]!]);
        i += m[0].length;
      }
      const end = /^\s*(\/?)>/.exec(xml.slice(i, i + 20));
      if (!end) throw new Error(`unterminated tag <${name} near ${i}`);
      i += end[0].length;
      tags.push({ name, attrs });
      if (!end[1]) stack.push(name);
    }
    if (stack.length) throw new Error(`unclosed: ${stack.join(',')}`);
    return tags;
  }

  function assertSelfContained(svg: string): void {
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    const tags = tokenize(svg);
    expect(tags[0]!.name).toBe('svg');
    for (const t of tags) {
      expect(ALLOWED_TAGS.has(t.name)).toBe(true);
      for (const [k, v] of t.attrs) {
        expect(k.toLowerCase().startsWith('on')).toBe(false);
        if (k === 'xmlns') {
          expect(v).toBe(SVG_NS);
        } else if (k === 'href' || k === 'xlink:href' || k === 'src') {
          expect(v.startsWith('#') || v.startsWith('data:')).toBe(true);
          if (t.name === 'image') expect(v).toMatch(/^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]*$/);
        } else {
          expect(v).not.toMatch(/https?:|url\(\s*['"]?(?!#)/i);
        }
      }
    }
  }

  const HOSTILE = '</text><script>alert(1)</script><foreignObject onload="x()"/>"\' & &lt; ]]>';

  function poison(doc: BoardDocument, extra: string): BoardDocument {
    const elements = doc.elements.map((el): Element => {
      const e = { ...el } as Record<string, unknown>;
      if (Array.isArray(e.runs)) e.runs = (e.runs as Array<{ text: string }>).map((r) => ({ ...r, text: r.text + extra + HOSTILE }));
      if (e.type === 'frame') e.name = String(e.name) + extra + HOSTILE;
      if (e.type === 'edge') e.label = (typeof e.label === 'string' ? e.label : '') + extra + HOSTILE;
      return e as unknown as Element;
    });
    return { ...doc, elements };
  }

  it('output is well-formed with no scripts, handlers, or external references', () => {
    fc.assert(
      fc.property(arbBoardDocument(8), fc.constantFrom('white', 'transparent', 'theme'), fc.boolean(), (doc, background, matchTheme) => {
        const r = renderToSvg(doc, { kind: 'board' }, { background, matchTheme });
        if (!r.ok) {
          expect(doc.elements.length).toBe(0);
          return;
        }
        assertSelfContained(r.value.svg);
      }),
      opts,
    );
  });

  it('escapes hostile text so no markup is injected', () => {
    fc.assert(
      fc.property(arbBoardDocument(8), fc.string({ maxLength: 20 }), (doc, extra) => {
        const r = renderToSvg(poison(doc, extra), { kind: 'board' });
        if (!r.ok) return;
        assertSelfContained(r.value.svg);
        const hasText = doc.elements.some((e) => 'runs' in e || e.type === 'frame' || e.type === 'edge');
        if (hasText) expect(r.value.svg).toContain('&lt;script&gt;');
      }),
      opts,
    );
  });
});
