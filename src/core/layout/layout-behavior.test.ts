import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { BoardModel } from '../ops/model';
import { UndoHistory } from '../ops/history';
import { DerivedGeometryError, MAX_DERIVED_ITERATIONS, runDerivedGeometryPass } from '../ops/derived-geometry';
import { recomputeAttachedEdges } from '../flow/routing';
import { runLayoutPass } from './run-layout-pass';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { x: 0, y: 0, width: 10, height: 10, rotation: 0, style };
const rect = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'rectangle', ...base, ...extra }) as Element;
const lay = { direction: 'horizontal', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, mainAlign: 'start', crossAlign: 'start' };
const frame = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name: id, ...base, width: 100, height: 50, layout: lay, ...extra }) as Element;
const edge = (id: string, s: string, t: string): Element =>
  ({ id, type: 'edge', ...base, sourceId: s, targetId: t, routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow' }) as unknown as Element;
const doc = (elements: Element[]): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
});
const get = (d: BoardDocument, id: string): Element => d.elements.find((e) => e.id === id)!;

describe('layout behavior (task 16.9)', () => {
  it('reflows when a child is added', () => {
    const d = doc([frame('f', { mainAlign: 'end', layout: { ...lay, mainAlign: 'end' } }), rect('a', { parentId: 'f' })]);
    const one = runLayoutPass(d).doc;
    expect(get(one, 'a').x).toBe(90);
    const added = { ...one, elements: [...one.elements, rect('b', { parentId: 'f', x: 200 })] };
    const two = runLayoutPass(added).doc;
    expect([get(two, 'a').x, get(two, 'b').x]).toEqual([80, 90]);
  });

  it('hugs on the main axis only, leaving the cross axis fixed', () => {
    const r = runLayoutPass(
      doc([
        frame('f', { sizing: { width: 'hug', height: 'fixed' }, layout: { ...lay, gap: 5 } }),
        rect('a', { parentId: 'f' }),
        rect('b', { parentId: 'f', x: 20 }),
      ]),
    ).doc;
    expect([get(r, 'f').width, get(r, 'f').height]).toEqual([25, 50]);
  });

  it('hugs on the cross axis only, leaving the main axis fixed', () => {
    const r = runLayoutPass(
      doc([
        frame('f', { sizing: { width: 'fixed', height: 'hug' } }),
        rect('a', { parentId: 'f', height: 30 }),
        rect('b', { parentId: 'f', x: 20, height: 20 }),
      ]),
    ).doc;
    expect([get(r, 'f').width, get(r, 'f').height]).toEqual([100, 30]);
  });

  it('re-routes attached edges from post-layout geometry', () => {
    const d = doc([
      frame('f'),
      rect('a', { parentId: 'f' }),
      rect('b', { parentId: 'f', x: 80 }),
      edge('e', 'a', 'b'),
    ]);
    const before = recomputeAttachedEdges(d.elements, ['b']).get('e')!;
    const laid = runLayoutPass(d);
    expect(get(laid.doc, 'b').x).toBe(10);
    const after = recomputeAttachedEdges(laid.doc.elements, laid.changedIds).get('e')!;
    expect(after).toBeDefined();
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  });

  it('applies layout on a locked child edit in a transaction, with one undo entry', () => {
    const history = new UndoHistory();
    const model = new BoardModel('/b.openboard', doc([frame('f'), rect('a', { parentId: 'f', locked: true }), rect('b', { parentId: 'f', x: 50 })]), { history });
    model.transact('edit', (tx) => tx.update('a', { width: 30 }));
    expect(get(model.getDocument(), 'b').x).toBe(30);
    expect(history.undo(model)).toBe(true);
    expect(history.canUndo()).toBe(false);
  });

  it('stops at the iteration cap with an iteration-limit error', () => {
    let calls = 0;
    const never = (d: BoardDocument) => {
      calls++;
      return { doc: { ...d }, changedIds: [] as string[] };
    };
    let err: unknown;
    try {
      runDerivedGeometryPass(doc([rect('a')]), [never]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DerivedGeometryError);
    expect((err as DerivedGeometryError).reason).toBe('iteration-limit');
    expect(calls).toBe(MAX_DERIVED_ITERATIONS);
  });

  it('aborts the transaction with layout-failed when the layout cannot be computed', () => {
    const history = new UndoHistory();
    const bad = frame('f', { layout: { direction: 'horizontal' } }); // missing padding -> layout throws
    const model = new BoardModel('/b.openboard', doc([bad, rect('a', { parentId: 'f' }), rect('free', { x: 500 })]), { history });
    const pre = model.getDocument();
    let err: unknown;
    try {
      model.transact('edit', (tx) => tx.update('free', { x: 1 }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DerivedGeometryError);
    expect((err as DerivedGeometryError).reason).toBe('layout-failed');
    expect((err as Error).message).toContain('layout could not be computed');
    expect(model.getDocument()).toEqual(pre);
    expect(history.canUndo()).toBe(false);
  });
});
