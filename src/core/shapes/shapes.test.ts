import { describe, expect, it } from 'vitest';
import type { Element, TextElement } from '../model';
import {
  FRAME_PRESETS,
  boundsFromDrag,
  createFrame,
  createFrameFromPreset,
  createShapeFromDrag,
  elementToDeleteOnTextEditExit,
  frameNestingDepth,
  frameNestingProblem,
  moveFramePatches,
  resizeBounds,
  wouldCreateFrameCycle,
} from './shapes';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const rect = (id: string, x: number, y: number, w: number, h: number, parentId?: string): Element => ({
  id, type: 'rectangle', x, y, width: w, height: h, rotation: 0, style, ...(parentId ? { parentId } : {}),
});

describe('drag creation', () => {
  it('matches dragged region in any direction', () => {
    expect(boundsFromDrag({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 40, height: 60 });
    expect(createShapeFromDrag('ellipse', { x: 0, y: 0 }, { x: 30, y: 40 }, 'a').width).toBe(30);
  });
  it('tiny drags give 100x100 centered on release point', () => {
    expect(boundsFromDrag({ x: 100, y: 100 }, { x: 102, y: 200 })).toEqual({ x: 52, y: 150, width: 100, height: 100 });
    expect(boundsFromDrag({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: -45, y: -45, width: 100, height: 100 });
  });
});

describe('resize', () => {
  const b = { x: 0, y: 0, width: 200, height: 100 };
  it('free resize from se', () => {
    expect(resizeBounds(b, 'se', 50, 10)).toEqual({ x: 0, y: 0, width: 250, height: 110 });
  });
  it('shift keeps aspect ratio for corners and edges', () => {
    for (const h of ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] as const) {
      const r = resizeBounds(b, h, 37, -23, true);
      expect(Math.abs(r.width / r.height - 2)).toBeLessThan(0.02);
    }
  });
  it('clamps to minimum size', () => {
    const r = resizeBounds(b, 'se', -1000, -1000, true);
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
    expect(Math.abs(r.width / r.height - 2)).toBeLessThan(0.02);
  });
});

describe('frames', () => {
  const els = [rect('in', 10, 10, 20, 20), rect('part', 90, 90, 50, 50), rect('out', 500, 500, 10, 10)];
  it('adopts only fully-inside elements and moves them with the frame', () => {
    const { frame, adopt } = createFrame({ x: 0, y: 0, width: 100, height: 100 }, els, { id: 'f' });
    expect(adopt).toEqual([{ id: 'in', patch: { parentId: 'f' } }]);
    const all: Element[] = [frame, rect('in', 10, 10, 20, 20, 'f'), els[1]!];
    expect(moveFramePatches('f', all, 5, -3)).toEqual([
      { id: 'f', patch: { x: 5, y: -3 } },
      { id: 'in', patch: { x: 15, y: 7 } },
    ]);
  });
  it('has enough presets', () => {
    expect(FRAME_PRESETS.filter((p) => p.category === 'device').length).toBeGreaterThanOrEqual(5);
    expect(FRAME_PRESETS.filter((p) => p.category === 'social').length).toBeGreaterThanOrEqual(3);
    for (const id of ['phone', 'tablet', 'desktop']) expect(FRAME_PRESETS.some((p) => p.id === id)).toBe(true);
    const made = createFrameFromPreset('phone', { x: 1, y: 2 }, [], 'p');
    expect(made?.frame).toMatchObject({ x: 1, y: 2, width: 390, height: 844, preset: 'phone' });
    expect(createFrameFromPreset('nope', { x: 0, y: 0 }, [])).toBeUndefined();
  });
});

describe('frame nesting guards', () => {
  const fr = (id: string, parentId?: string): Element =>
    ({ ...(rect(id, 0, 0, 10, 10, parentId) as object), type: 'frame' }) as unknown as Element;
  const els = [fr('a'), fr('b', 'a'), fr('c', 'b'), rect('r', 0, 0, 1, 1, 'c')];

  it('computes 1-based depth', () => {
    expect(frameNestingDepth('a', els)).toBe(1);
    expect(frameNestingDepth('c', els)).toBe(3);
  });

  it('detects cycles', () => {
    expect(wouldCreateFrameCycle('a', 'c', els)).toBe(true);
    expect(wouldCreateFrameCycle('a', 'a', els)).toBe(true);
    expect(wouldCreateFrameCycle('c', 'a', els)).toBe(false);
  });

  it('reports non-frame parents and existing cycles', () => {
    expect(frameNestingProblem(els, ['c'])).toBeUndefined();
    expect(frameNestingProblem([...els, rect('x', 0, 0, 1, 1, 'r')], ['x'])).toMatch(/not an existing Frame/);
    expect(frameNestingProblem([fr('p', 'q'), fr('q', 'p')], ['p'])).toMatch(/own ancestor/);
  });
});

describe('text edit exit', () => {
  const text = (t: string): TextElement => ({
    ...(rect('t', 0, 0, 10, 10) as object), id: 't', type: 'text', runs: t ? [{ text: t }] : [{ text: '' }],
    fontFamily: 'x', fontSize: 14, align: 'left',
  } as TextElement);
  it('deletes empty text only', () => {
    expect(elementToDeleteOnTextEditExit(text(''))).toBe('t');
    expect(elementToDeleteOnTextEditExit(text('a'))).toBeUndefined();
    expect(elementToDeleteOnTextEditExit(rect('r', 0, 0, 1, 1))).toBeUndefined();
  });
});
