import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { measure } from '../text/measure';
import type { LayoutConfig } from './types';
import { runLayoutPass } from './run-layout-pass';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { x: 0, y: 0, width: 10, height: 10, rotation: 0, style };
const rect = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'rectangle', ...base, ...extra }) as Element;
const text = (id: string, content: string, extra: Record<string, unknown> = {}): Element =>
  ({
    id, type: 'text', ...base, runs: [{ text: content }], fontFamily: 'sans', fontSize: 10, align: 'left', ...extra,
  }) as Element;
const cfg = (extra: Partial<LayoutConfig> = {}): LayoutConfig => ({
  direction: 'horizontal', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 },
  mainAlign: 'start', crossAlign: 'start', ...extra,
});
const frame = (id: string, extra: Record<string, unknown> = {}, layout: Partial<LayoutConfig> | null = {}): Element =>
  ({
    id, type: 'frame', name: id, ...base, width: 100, height: 50,
    ...(layout === null ? {} : { layout: cfg(layout) }), ...extra,
  }) as Element;
const doc = (elements: Element[]): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
});
const get = (d: BoardDocument, id: string): Element => d.elements.find((e) => e.id === id)!;
const box = (d: BoardDocument, id: string): number[] => {
  const e = get(d, id);
  return [e.x, e.y, e.width, e.height];
};

describe('runLayoutPass basics', () => {
  it('returns the same document when there is nothing to lay out', () => {
    const d = doc([rect('a'), frame('f', {}, null)]);
    const r = runLayoutPass(d);
    expect(r.doc).toBe(d);
    expect(r.changedIds).toEqual([]);
  });

  it('handles an empty Layout_Frame', () => {
    const d = doc([frame('f')]);
    const r = runLayoutPass(d);
    expect(r.doc).toBe(d);
  });

  it('arranges children of a start-aligned row in absolute coordinates', () => {
    const d = doc([
      frame('f', { x: 100, y: 200 }, { gap: 5, padding: { top: 2, right: 0, bottom: 0, left: 3 } }),
      rect('a', { parentId: 'f', x: 0, y: 0 }),
      rect('b', { parentId: 'f', x: 50, y: 50, width: 20 }),
    ]);
    const r = runLayoutPass(d);
    expect(box(r.doc, 'a')).toEqual([103, 202, 10, 10]);
    expect(box(r.doc, 'b')).toEqual([118, 202, 20, 10]);
    expect(r.changedIds).toEqual(['a', 'b']);
    expect(box(r.doc, 'f')).toEqual([100, 200, 100, 50]);
  });

  it('does not mutate the input document', () => {
    const d = doc([frame('f'), rect('a', { parentId: 'f', x: 40 })]);
    const snapshot = JSON.stringify(d);
    runLayoutPass(d);
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('is idempotent and deterministic', () => {
    const d = doc([
      frame('f', { sizing: { width: 'hug', height: 'hug' } }, { gap: 4, padding: { top: 1, right: 2, bottom: 3, left: 4 } }),
      text('t', 'Hello world', { parentId: 'f', sizing: { width: 'hug', height: 'hug' } }),
      rect('r', { parentId: 'f' }),
    ]);
    const once = runLayoutPass(d);
    const twice = runLayoutPass(once.doc);
    expect(twice.doc).toBe(once.doc);
    expect(twice.changedIds).toEqual([]);
    expect(JSON.stringify(runLayoutPass(d).doc)).toBe(JSON.stringify(once.doc));
  });

  it('leaves unrotated layout unaffected by rotation', () => {
    const a = runLayoutPass(doc([frame('f'), rect('a', { parentId: 'f' }), rect('b', { parentId: 'f', x: 20 })]));
    const b = runLayoutPass(doc([frame('f'), rect('a', { parentId: 'f', rotation: 45 }), rect('b', { parentId: 'f', x: 20, rotation: 90 })]));
    expect(box(a.doc, 'b')).toEqual(box(b.doc, 'b'));
  });
});

describe('placement and ordering', () => {
  it('orders by current main-axis position, not stored order', () => {
    const d = doc([
      frame('f'),
      rect('a', { parentId: 'f', x: 60 }),
      rect('b', { parentId: 'f', x: 0 }),
    ]);
    const r = runLayoutPass(d);
    expect(box(r.doc, 'b')).toEqual([0, 0, 10, 10]);
    expect(box(r.doc, 'a')).toEqual([10, 0, 10, 10]);
  });

  it('spaceBetween with one child places it at the start', () => {
    const r = runLayoutPass(doc([frame('f', {}, { mainAlign: 'spaceBetween' }), rect('a', { parentId: 'f', x: 40 })]));
    expect(box(r.doc, 'a')).toEqual([0, 0, 10, 10]);
  });

  it('spaceBetween with several children pins first and last', () => {
    const r = runLayoutPass(
      doc([
        frame('f', {}, { mainAlign: 'spaceBetween' }),
        rect('a', { parentId: 'f', x: 0 }),
        rect('b', { parentId: 'f', x: 10 }),
        rect('c', { parentId: 'f', x: 20 }),
      ]),
    );
    expect([get(r.doc, 'a').x, get(r.doc, 'b').x, get(r.doc, 'c').x]).toEqual([0, 45, 90]);
  });

  it('places overflowing children from the start edge and keeps the frame size', () => {
    const r = runLayoutPass(
      doc([
        frame('f', { width: 25 }, { mainAlign: 'center', gap: 2 }),
        rect('a', { parentId: 'f', x: 0 }),
        rect('b', { parentId: 'f', x: 10 }),
        rect('c', { parentId: 'f', x: 20 }),
      ]),
    );
    expect([get(r.doc, 'a').x, get(r.doc, 'b').x, get(r.doc, 'c').x]).toEqual([0, 12, 24]);
    expect(box(r.doc, 'f')).toEqual([0, 0, 25, 50]);
  });

  it('aligns on the cross axis', () => {
    const r = runLayoutPass(doc([frame('f', {}, { crossAlign: 'end' }), rect('a', { parentId: 'f' })]));
    expect(box(r.doc, 'a')).toEqual([0, 40, 10, 10]);
  });

  it('works for vertical direction', () => {
    const r = runLayoutPass(
      doc([frame('f', {}, { direction: 'vertical', gap: 3 }), rect('a', { parentId: 'f' }), rect('b', { parentId: 'f', y: 30 })]),
    );
    expect(box(r.doc, 'b')).toEqual([0, 13, 10, 10]);
  });

  it('ignores ignoreLayout children', () => {
    const r = runLayoutPass(
      doc([
        frame('f'),
        rect('a', { parentId: 'f', ignoreLayout: true, x: 33, y: 7 }),
        rect('b', { parentId: 'f', x: 80 }),
      ]),
    );
    expect(box(r.doc, 'a')).toEqual([33, 7, 10, 10]);
    expect(box(r.doc, 'b')).toEqual([0, 0, 10, 10]);
  });

  it('does not touch children of a plain Frame or elements outside frames', () => {
    const d = doc([frame('p', {}, null), rect('a', { parentId: 'p', x: 7 }), rect('free', { x: 9 })]);
    expect(runLayoutPass(d).doc).toBe(d);
  });

  it('skips edge elements', () => {
    const edge = {
      id: 'e', type: 'edge', ...base, parentId: 'f', sourceId: 'a', targetId: 'b', routing: 'straight',
      sourceArrow: 'none', targetArrow: 'arrow',
    } as unknown as Element;
    const r = runLayoutPass(doc([frame('f'), rect('a', { parentId: 'f' }), rect('b', { parentId: 'f', x: 30 }), edge]));
    expect(box(r.doc, 'b')).toEqual([10, 0, 10, 10]);
    expect(get(r.doc, 'e')).toBe(edge);
  });

  it('treats locked elements like unlocked ones', () => {
    const r = runLayoutPass(doc([frame('f', { locked: true }), rect('a', { parentId: 'f', locked: true, x: 50 })]));
    expect(box(r.doc, 'a')).toEqual([0, 0, 10, 10]);
  });
});

describe('sizing', () => {
  it('hugs a frame on both axes (content plus padding, min 1)', () => {
    const r = runLayoutPass(
      doc([
        frame('f', { sizing: { width: 'hug', height: 'hug' } }, { gap: 5, padding: { top: 1, right: 2, bottom: 3, left: 4 } }),
        rect('a', { parentId: 'f', height: 20 }),
        rect('b', { parentId: 'f', x: 30 }),
      ]),
    );
    expect(box(r.doc, 'f')).toEqual([0, 0, 4 + 10 + 5 + 10 + 2, 1 + 20 + 3]);
  });

  it('hugs an empty frame to its padding with a minimum of 1', () => {
    const r = runLayoutPass(doc([frame('f', { sizing: { width: 'hug', height: 'hug' } })]));
    expect(box(r.doc, 'f')).toEqual([0, 0, 1, 1]);
  });

  it('hugs text from the Text_Measurer', () => {
    const m = measure({ text: 'Hello', fontFamily: 'sans', fontSize: 10, availableWidth: Infinity });
    if (!m.ok) throw new Error('measure failed');
    const r = runLayoutPass(doc([text('t', 'Hello', { sizing: { width: 'hug', height: 'hug' } })]));
    const t = get(r.doc, 't');
    expect(t.width).toBe(Math.max(1, Math.round(m.value.widestLine * 100) / 100));
    expect(t.height).toBe(12);
    expect(t.sizing).toEqual({ width: 'hug', height: 'hug' });
  });

  it('keeps the current size when the Text_Measurer fails', () => {
    const r = runLayoutPass(doc([text('t', 'Hello', { fontSize: 0, sizing: { width: 'hug', height: 'hug' } })]));
    expect(box(r.doc, 't')).toEqual([0, 0, 10, 10]);
  });

  it('wraps hug-height text at its fixed width', () => {
    const r = runLayoutPass(
      doc([text('t', 'aaaa bbbb cccc dddd', { width: 30, textWrap: 'wrap', sizing: { width: 'fixed', height: 'hug' } })]),
    );
    const t = get(r.doc, 't');
    expect(t.width).toBe(30);
    expect(t.height).toBeGreaterThan(12);
  });

  it('propagates text growth to hug ancestors', () => {
    const d = doc([
      frame('outer', { sizing: { width: 'hug', height: 'hug' } }, { padding: { top: 5, right: 5, bottom: 5, left: 5 } }),
      frame('inner', { parentId: 'outer', sizing: { width: 'hug', height: 'hug' } }),
      text('t', 'Hi', { parentId: 'inner', sizing: { width: 'hug', height: 'hug' } }),
    ]);
    const a = runLayoutPass(d).doc;
    const edited = {
      ...a,
      elements: a.elements.map((e) => (e.id === 't' ? ({ ...e, runs: [{ text: 'Hi there, friend' }] } as Element) : e)),
    };
    const b = runLayoutPass(edited).doc;
    expect(get(b, 'inner').width).toBe(get(b, 't').width);
    expect(get(b, 'outer').width).toBe(get(b, 'inner').width + 10);
    expect(get(b, 'outer').width).toBeGreaterThan(get(a, 'outer').width);
  });

  it('splits leftover main-axis space among fill children (min 1 each)', () => {
    const r = runLayoutPass(
      doc([
        frame('f', {}, { gap: 10, padding: { top: 0, right: 5, bottom: 0, left: 5 } }),
        rect('a', { parentId: 'f', width: 20 }),
        rect('b', { parentId: 'f', x: 30, sizing: { width: 'fill', height: 'fixed' } }),
        rect('c', { parentId: 'f', x: 60, sizing: { width: 'fill', height: 'fixed' } }),
      ]),
    );
    // inner 90 - fixed 20 - gaps 20 = 50 -> 25 each
    expect(box(r.doc, 'b')).toEqual([35, 0, 25, 10]);
    expect(box(r.doc, 'c')).toEqual([70, 0, 25, 10]);
  });

  it('gives each fill child at least 1 when space runs out', () => {
    const r = runLayoutPass(
      doc([
        frame('f', { width: 10 }),
        rect('a', { parentId: 'f', width: 50 }),
        rect('b', { parentId: 'f', x: 60, sizing: { width: 'fill', height: 'fixed' } }),
      ]),
    );
    expect(get(r.doc, 'b').width).toBe(1);
  });

  it('fills the cross axis with the inner size (min 1)', () => {
    const r = runLayoutPass(
      doc([
        frame('f', {}, { padding: { top: 4, right: 0, bottom: 6, left: 0 } }),
        rect('a', { parentId: 'f', sizing: { width: 'fixed', height: 'fill' } }),
      ]),
    );
    expect(box(r.doc, 'a')).toEqual([0, 4, 10, 40]);
  });

  it('treats fill outside a Layout_Frame as fixed and keeps stored sizing', () => {
    const sizing = { width: 'fill', height: 'fill' };
    const d = doc([frame('p', {}, null), rect('a', { parentId: 'p', sizing }), rect('b', { sizing })]);
    const r = runLayoutPass(d);
    expect(r.doc).toBe(d);
    expect(get(r.doc, 'a').sizing).toEqual(sizing);
  });

  it('treats fill inside a hug frame (same axis) as hug', () => {
    const r = runLayoutPass(
      doc([
        frame('f', { sizing: { width: 'hug', height: 'fixed' } }),
        text('t', 'Hello there', { parentId: 'f', sizing: { width: 'fill', height: 'fixed' } }),
      ]),
    );
    const t = get(r.doc, 't');
    expect(get(r.doc, 'f').width).toBe(t.width);
    expect(t.width).toBeGreaterThan(10);
    expect(t.sizing).toEqual({ width: 'fill', height: 'fixed' });
  });

  it('treats hug on an unsupported element as fixed', () => {
    const d = doc([rect('a', { sizing: { width: 'hug', height: 'hug' } }), frame('p', {}, null, ), rect('b', { parentId: 'p', sizing: { width: 'hug', height: 'hug' } })]);
    expect(runLayoutPass(d).doc).toBe(d);
  });

  it('treats hug on a plain Frame as fixed', () => {
    const d = doc([frame('p', { sizing: { width: 'hug', height: 'hug' } }, null)]);
    expect(runLayoutPass(d).doc).toBe(d);
  });

  it('cascades fill through nested Layout_Frames, outermost first', () => {
    const r = runLayoutPass(
      doc([
        frame('outer', { width: 200, height: 100 }, { padding: { top: 10, right: 10, bottom: 10, left: 10 } }),
        frame('inner', { parentId: 'outer', sizing: { width: 'fill', height: 'fill' } }, { crossAlign: 'center' }),
        rect('a', { parentId: 'inner', sizing: { width: 'fill', height: 'fixed' } }),
      ]),
    );
    expect(box(r.doc, 'inner')).toEqual([10, 10, 180, 80]);
    expect(box(r.doc, 'a')).toEqual([10, 45, 180, 10]);
  });

  it('moves non-arranged descendants with a frame placed by layout', () => {
    const r = runLayoutPass(
      doc([
        frame('f', {}, { padding: { top: 0, right: 0, bottom: 0, left: 20 } }),
        frame('p', { parentId: 'f', x: 0, width: 40 }, null),
        rect('inside', { parentId: 'p', x: 5, y: 5 }),
      ]),
    );
    expect(box(r.doc, 'p')).toEqual([20, 0, 40, 50]);
    expect(box(r.doc, 'inside')).toEqual([25, 5, 10, 10]);
  });

  it('reflows when a child is removed', () => {
    const full = runLayoutPass(
      doc([frame('f', {}, { mainAlign: 'end' }), rect('a', { parentId: 'f' }), rect('b', { parentId: 'f', x: 20 })]),
    ).doc;
    expect(get(full, 'a').x).toBe(80);
    const removed = { ...full, elements: full.elements.filter((e) => e.id !== 'a') };
    expect(get(runLayoutPass(removed).doc, 'b').x).toBe(90);
  });

  it('reflows when the frame is resized (layout frame cascades)', () => {
    const a = runLayoutPass(doc([frame('f', {}, { mainAlign: 'center' }), rect('a', { parentId: 'f' })])).doc;
    expect(get(a, 'a').x).toBe(45);
    const resized = { ...a, elements: a.elements.map((e) => (e.id === 'f' ? ({ ...e, width: 200 } as Element) : e)) };
    expect(get(runLayoutPass(resized).doc, 'a').x).toBe(95);
  });

  it('reports only geometry-changed ids', () => {
    const r = runLayoutPass(doc([frame('f'), rect('a', { parentId: 'f' }), rect('b', { parentId: 'f', x: 10 })]));
    expect(r.changedIds).toEqual([]);
  });
});
