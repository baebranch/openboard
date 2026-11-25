import { describe, expect, it } from 'vitest';
import type { Element } from '../model/types';
import { cullToViewport, hitTest, marqueeBounds, marqueeSelect } from './selection';

const el = (id: string, x: number, y: number, w: number, h: number, locked = false) =>
  ({ id, x, y, width: w, height: h, locked }) as unknown as Element;

describe('marqueeSelect', () => {
  const els = [el('a', 0, 0, 10, 10), el('b', 100, 100, 10, 10), el('c', 5, 5, 10, 10, true)];
  it('requires at least 1px overlap and skips locked', () => {
    expect(marqueeSelect(els, { x: 9, y: 9, width: 50, height: 50 })).toEqual(['a']);
    expect(marqueeSelect(els, { x: 9.5, y: 9.5, width: 50, height: 50 })).toEqual([]);
  });
  it('shift unions with previous', () => {
    expect(marqueeSelect(els, { x: 0, y: 0, width: 5, height: 5 }, ['b'], true)).toEqual(['b', 'a']);
  });
  it('normalizes drag corners', () => {
    expect(marqueeBounds({ x: 10, y: 10 }, { x: 0, y: 4 })).toEqual({ x: 0, y: 4, width: 10, height: 6 });
  });
});

describe('hitTest and culling', () => {
  it('returns topmost hit', () => {
    expect(hitTest([el('a', 0, 0, 10, 10), el('b', 0, 0, 10, 10)], { x: 5, y: 5 })).toBe('b');
    expect(hitTest([el('a', 0, 0, 10, 10)], { x: 50, y: 5 })).toBeUndefined();
  });
  it('ignores hits outside a clipping frame and falls through (Req 10.3)', () => {
    const frame = { ...el('f', 0, 0, 100, 100), type: 'frame', clipContent: true } as unknown as Element;
    const bg = el('bg', 0, 0, 300, 300);
    const child = { ...el('c', 50, 50, 100, 100), parentId: 'f' } as unknown as Element;
    const els = [bg, frame, child];
    expect(hitTest(els, { x: 80, y: 80 })).toBe('c');
    expect(hitTest(els, { x: 120, y: 120 })).toBe('bg');
    const open = { ...frame, clipContent: false } as unknown as Element;
    expect(hitTest([bg, open, child], { x: 120, y: 120 })).toBe('c');
  });
  it('keeps elements within 256px margin', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const s = { width: 800, height: 600 };
    const out = cullToViewport([el('in', 1000, 0, 10, 10), el('out', 1100, 0, 10, 10)], v, s);
    expect(out.map((e) => e.id)).toEqual(['in']);
  });
});
