import { describe, expect, it } from 'vitest';
import { builtinPalette } from '../theme';
import type { Asset, Element } from '../model/types';
import { escapeXml, renderToSvg } from './svg';

const style = {
  fill: 'theme:default',
  stroke: 'theme:default',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 100,
  cornerRadius: 0,
} as const;

const base = (id: string, x = 0, y = 0, width = 100, height = 60) => ({
  id,
  x,
  y,
  width,
  height,
  rotation: 0,
  style: { ...style },
});

const asset: Asset = { id: 'a1', mime: 'image/png', hash: 'h', width: 2, height: 2, data: 'iVBORw0KGgo=' };
const text = { runs: [{ text: 'a<b>&"c', bold: true }], fontFamily: 'sans-serif', fontSize: 16, align: 'left' as const };

const elements: Element[] = [
  { ...base('r'), type: 'rectangle' },
  { ...base('e', 120), type: 'ellipse' },
  { ...base('d', 240), type: 'diamond' },
  { ...base('l', 0, 100), type: 'line' },
  { ...base('ar', 120, 100), type: 'arrow' },
  { ...base('f', 0, 200), type: 'freehand', points: [{ x: 0, y: 200, p: 0.1 }, { x: 20, y: 220, p: 1 }], baseWidth: 4 },
  { ...base('t', 120, 200), type: 'text', ...text },
  { ...base('i', 240, 200), type: 'image', assetId: 'a1' },
  { ...base('fr', 0, 300, 300, 200), type: 'frame', name: 'Fr<1>' },
  { ...base('st', 320, 300), type: 'sticky', ...text },
  { ...base('n1', 0, 520), type: 'flowNode', preset: 'decision', ...text },
  { ...base('n2', 300, 520), type: 'flowNode', preset: 'database', ...text },
  {
    ...base('ed', 0, 0, 0, 0),
    type: 'edge',
    sourceId: 'n1',
    targetId: 'n2',
    routing: 'orthogonal',
    sourceArrow: 'none',
    targetArrow: 'triangle',
    label: 'yes <&>',
  },
];

describe('renderToSvg', () => {
  const doc = { elements, assets: [asset] };

  it('renders every element type, self-contained', () => {
    const r = renderToSvg(doc, { kind: 'board' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = r.value.svg;
    for (const e of elements) expect(svg).toContain(`data-id="${e.id}"`);
    expect(svg).toContain('href="data:image/png;base64,iVBORw0KGgo="');
    expect(svg).not.toMatch(/href="(?!data:)/);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(svg).not.toMatch(/<script|foreignObject/i);
    expect(svg).toContain('a&lt;b&gt;&amp;&quot;c');
    expect(svg).toContain('Fr&lt;1&gt;');
    expect(svg).toContain('yes &lt;&amp;&gt;');
  });

  it('applies padding and backgrounds', () => {
    const els = [elements[0]!];
    const w = renderToSvg(doc, els, { padding: 10 });
    expect(w.ok && w.value.width).toBe(120);
    expect(w.ok && w.value.svg).toContain('fill="#ffffff"');
    const t = renderToSvg(doc, els, { background: 'transparent' });
    expect(t.ok && t.value.svg).not.toContain('fill="#ffffff"');
  });

  it('uses the light palette unless matchTheme is on, resolving theme:default', () => {
    const dark = builtinPalette('dark');
    const off = renderToSvg(doc, [elements[0]!], { background: 'theme', palette: dark });
    expect(off.ok && off.value.svg).toContain('fill="#ffffff"');
    expect(off.ok && off.value.svg).toContain(`stroke="${builtinPalette('light').defaultStroke}"`);
    const on = renderToSvg(doc, [elements[0]!], { background: 'theme', matchTheme: true, palette: dark });
    expect(on.ok && on.value.svg).toContain(`fill="${dark.background}"`);
    expect(on.ok && on.value.svg).toContain(`stroke="${dark.defaultStroke}"`);
    expect(on.ok && on.value.svg).not.toContain('theme:default');
  });

  it('fails on empty scope', () => {
    const r = renderToSvg(doc, []);
    expect(r.ok).toBe(false);
  });

  it('escapes xml', () => {
    expect(escapeXml('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});

describe('per-corner radii', () => {
  const withRadii = (type: 'rectangle' | 'frame' | 'sticky', radii: [number, number, number, number]): Element => {
    const b = base('x', 0, 0, 100, 60);
    const common = { ...b, style: { ...b.style, cornerRadii: radii } };
    if (type === 'rectangle') return { ...common, type };
    if (type === 'frame') return { ...common, type, name: 'F' };
    return { ...common, type, ...text };
  };

  it('emits one closed path with arcs only for non-zero corners (TL,TR,BR,BL)', () => {
    for (const t of ['rectangle', 'frame', 'sticky'] as const) {
      const r = renderToSvg({ elements: [withRadii(t, [10, 0, 5, 0])], assets: [] }, { kind: 'board' });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const d = /<path d="([^"]+)"/.exec(r.value.svg)![1]!;
      expect(d.endsWith('Z')).toBe(true);
      expect(d.match(/ A /g)).toHaveLength(2);
      expect(d).toContain('A 10 10 0 0 1 10 0');
      expect(d).toContain('A 5 5 0 0 1 95 60');
    }
  });

  it('keeps rect output when cornerRadii is absent', () => {
    const r = renderToSvg({ elements: [{ ...base('r'), type: 'rectangle' }], assets: [] }, { kind: 'board' });
    expect(r.ok && r.value.svg).toContain('<rect x="0" y="0" width="100" height="60"');
  });
});

describe('icon rendering (Req 23.4, 23.5, 23.6)', () => {
  const icon = (name: string): Element => ({ ...base('i', 10, 20, 48, 48), type: 'icon', name });
  const render = (name: string): string => {
    const r = renderToSvg({ elements: [icon(name)], assets: [] }, { kind: 'board' });
    if (!r.ok) throw new Error('render failed');
    return r.value.svg;
  };

  it('scales the Icon_Set path with a non-scaling stroke and no external reference', () => {
    const svg = render('activity');
    expect(svg).toContain('d="M22 12h-2.48');
    expect(svg).toContain('translate(10 20) scale(2 2)');
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('href');
  });

  it('draws the placeholder glyph for an unknown name', () => {
    expect(render('no-such-icon')).toContain('d="M5 3h14a2 2 0 0 1 2 2v14');
  });
});

describe('frame clipping (Req 10.2, 10.4, 10.5)', () => {
  const frame = (id: string, clip: boolean, parentId?: string): Element => ({
    ...base(id, 0, 0, 100, 60),
    type: 'frame',
    name: id,
    ...(clip ? { clipContent: true } : {}),
    ...(parentId ? { parentId } : {}),
  });
  const rect = (id: string, parentId: string): Element => ({ ...base(id, 0, 0, 20, 20), type: 'rectangle', parentId });

  it('nests clipPaths and clips each descendant by its nearest clipping ancestor', () => {
    const els = [frame('A', true), frame('B', true, 'A'), rect('R', 'B')];
    const r = renderToSvg({ elements: els, assets: [] }, { kind: 'board' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = r.value.svg;
    expect(svg).toContain('<clipPath id="clipc-B" clip-path="url(#clipc-A)">');
    expect(svg).toContain('<clipPath id="clipc-A">');
    expect(svg).toContain('<g clip-path="url(#clipc-B)"><g data-id="R"');
    expect(svg).toContain('<g clip-path="url(#clipc-A)"><g data-id="B"');
  });

  it('emits no clip markup when no frame clips', () => {
    const r = renderToSvg({ elements: [frame('A', false), rect('R', 'A')], assets: [] }, { kind: 'board' });
    expect(r.ok && r.value.svg).not.toContain('clip');
  });
});

describe('text wrapping (Req 8.4, 8.6, 1.6)', () => {
  const textEl = (runs: { text: string; bold?: boolean; italic?: boolean }[], textWrap?: 'none' | 'wrap'): Element => ({
    ...base('t', 0, 0, 60, 20),
    type: 'text',
    runs,
    fontFamily: 'sans-serif',
    fontSize: 16,
    align: 'left',
    ...(textWrap ? { textWrap } : {}),
  });
  const render = (el: Element) => {
    const r = renderToSvg({ elements: [el], assets: [] }, { kind: 'board' });
    expect(r.ok).toBe(true);
    return r.ok ? r.value.svg : '';
  };
  const lineTexts = (svg: string) =>
    [...svg.matchAll(/<text [^>]*>(.*?)<\/text>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));

  it('keeps newline-only breaking when textWrap is absent or none', () => {
    const runs = [{ text: 'alpha beta gamma delta\nx' }];
    expect(render(textEl(runs, 'none'))).toBe(render(textEl(runs)));
    expect(lineTexts(render(textEl(runs)))).toEqual(['alpha beta gamma delta', 'x']);
  });

  it('wraps at the element width and draws lines past the bottom without clipping', () => {
    const svg = render(textEl([{ text: 'alpha beta gamma delta\nx' }], 'wrap'));
    const lines = lineTexts(svg);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe('alpha beta gamma delta x');
    expect(svg).not.toContain('clip');
  });

  it('preserves run styling across a split run', () => {
    const svg = render(textEl([{ text: 'aaaa bbbb ', bold: true }, { text: 'cccc dddd', italic: true }], 'wrap'));
    const lines = lineTexts(svg);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('aaaa bbbb cccc dddd');
    for (const w of ['aaaa', 'bbbb']) expect(svg).toMatch(new RegExp(`<tspan font-weight="bold">[^<]*${w}`));
    for (const w of ['cccc', 'dddd']) expect(svg).toMatch(new RegExp(`<tspan font-style="italic">[^<]*${w}`));
  });
});
