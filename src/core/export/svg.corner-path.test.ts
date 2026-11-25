import { describe, expect, it } from 'vitest';
import type { Element } from '../model/types';
import { cornerPath, renderToSvg } from './svg';

const style = {
  fill: 'theme:default',
  stroke: 'theme:default',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 100,
  cornerRadius: 0,
} as const;

const bounds = { x: 0, y: 0, width: 100, height: 60 };
const text = { runs: [{ text: 'a' }], fontFamily: 'sans-serif', fontSize: 16, align: 'left' as const };

const pathD = (tag: string): string => /d="([^"]+)"/.exec(tag)![1]!;

describe('cornerPath', () => {
  it('emits a single closed path', () => {
    const tag = cornerPath(bounds, [10, 10, 10, 10]);
    expect(tag.startsWith('<path d="')).toBe(true);
    const d = pathD(tag);
    expect(d.match(/M /g)).toHaveLength(1);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/ A /g)).toHaveLength(4);
  });

  it('uses square corners and no arcs when all radii are 0', () => {
    const d = pathD(cornerPath(bounds, [0, 0, 0, 0]));
    expect(d).not.toContain('A ');
    expect(d).toBe('M 0 0 L 100 0 L 100 0 L 100 60 L 100 60 L 0 60 L 0 60 L 0 0 L 0 0 Z');
  });

  it('arcs only the corners above 0, in TL, TR, BR, BL order', () => {
    const d = pathD(cornerPath(bounds, [0, 8, 0, 4]));
    expect(d.match(/ A /g)).toHaveLength(2);
    expect(d).toContain('A 8 8 0 0 1 100 8');
    expect(d).toContain('A 4 4 0 0 1 0 56');
  });

  it('treats negative and non-finite radii as square corners', () => {
    const d = pathD(cornerPath(bounds, [-5, Number.NaN, Number.POSITIVE_INFINITY, 0]));
    expect(d).not.toContain('A ');
  });
});

describe('corner path rendering and backward compatibility', () => {
  const render = (el: Element): string => {
    const r = renderToSvg({ elements: [el], assets: [] }, { kind: 'board' });
    expect(r.ok).toBe(true);
    return r.ok ? r.value.svg : '';
  };

  it('renders a flowNode with cornerRadii as a closed arc path', () => {
    const el: Element = {
      id: 'n', x: 0, y: 0, width: 100, height: 60, rotation: 0,
      style: { ...style, cornerRadii: [6, 0, 6, 0] },
      type: 'flowNode', preset: 'process', ...text,
    };
    const svg = render(el);
    const d = pathD(/<path d="[^"]+"/.exec(svg)![0]);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/ A /g)).toHaveLength(2);
  });

  it('renders a rectangle without cornerRadii as before (rect with rx/ry)', () => {
    const el: Element = {
      id: 'r', x: 0, y: 0, width: 100, height: 60, rotation: 0,
      style: { ...style, cornerRadius: 8 },
      type: 'rectangle',
    };
    const svg = render(el);
    expect(svg).toContain('<rect x="0" y="0" width="100" height="60" rx="8" ry="8"');
    expect(svg).not.toContain('<path d="M');
  });

  it('prefers cornerRadii over cornerRadius when both are present', () => {
    const el: Element = {
      id: 'r', x: 0, y: 0, width: 100, height: 60, rotation: 0,
      style: { ...style, cornerRadius: 8, cornerRadii: [0, 0, 0, 0] },
      type: 'rectangle',
    };
    const svg = render(el);
    expect(svg).toContain('<path d="M');
    expect(svg).not.toContain('rx="8"');
  });
});
