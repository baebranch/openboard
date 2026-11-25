import { describe, expect, it } from 'vitest';
import type { Element } from '../model/types';
import { renderFrameSvg, slideFrames } from './slides';

const style = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const frame = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name: id, x, y, width: 100, height: 80, rotation: 0, style, ...extra }) as Element;
const rect = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'rectangle', x, y, width: 50, height: 50, rotation: 0, style, ...extra }) as Element;

describe('slideFrames', () => {
  it('orders top-level frames in reading order: rows top to bottom, left to right', () => {
    // Second row is listed first in the document, and the first row is slightly ragged.
    const els = [frame('c', 0, 300), frame('d', 200, 310), frame('b', 220, 12), frame('a', 0, 0)];
    expect(slideFrames(els).map((f) => f.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves out component masters and nested frames', () => {
    const els = [frame('m', 0, 0, { component: 'Button' }), frame('s', 200, 0), frame('n', 210, 10, { parentId: 's' })];
    expect(slideFrames(els).map((f) => f.id)).toEqual(['s']);
    expect(slideFrames(els, { includeMasters: true }).map((f) => f.id)).toEqual(['m', 's']);
  });
});

describe('renderFrameSvg', () => {
  it('cuts the output to the frame box, even when content overflows it', () => {
    const els = [frame('f', 10, 20), rect('inside', 20, 30, { parentId: 'f' }), rect('over', 80, 70, { width: 400, height: 400, parentId: 'f' })];
    const r = renderFrameSvg({ elements: els, assets: [] }, els[0]!);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.value.width, r.value.height]).toEqual([100, 80]);
    expect(r.value.bounds).toEqual({ x: 10, y: 20, width: 100, height: 80 });
    expect(r.value.svg).toContain('viewBox="0 0 100 80"');
    expect(r.value.svg).toContain('data-id="inside"');
  });
});
