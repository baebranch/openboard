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
