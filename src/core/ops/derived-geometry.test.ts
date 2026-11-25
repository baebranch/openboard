import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { applyPatches } from './patches';
import { BoardModel } from './model';
import { UndoHistory } from './history';
import {
  DerivedGeometryError,
  diffElements,
  needsDerivedPass,
  runDerivedGeometryPass,
  type DerivedPassFn,
} from './derived-geometry';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { x: 0, y: 0, width: 10, height: 10, rotation: 0, style };
const rect = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'rectangle', ...base, ...extra }) as Element;
const frame = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name: id, ...base, width: 100, height: 50, ...extra }) as Element;
const doc = (elements: Element[]): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
});

describe('needsDerivedPass', () => {
  it('is false without instances or layout frames', () => {
    expect(needsDerivedPass(doc([rect('a'), frame('f')]))).toBe(false);
  });
  it('is true with an instance or a layout frame', () => {
    expect(needsDerivedPass(doc([frame('f', { instanceOf: 'M' })]))).toBe(true);
    expect(needsDerivedPass(doc([frame('f', { layout: { direction: 'row' } })]))).toBe(true);
  });
});

const lay = {
  direction: 'horizontal', gap: 10, padding: { top: 0, right: 0, bottom: 0, left: 0 }, mainAlign: 'start', crossAlign: 'start',
};

describe('Layout_Pass registration', () => {
  const lf = frame('lf', { layout: lay, width: 200, height: 50 });
  const a = rect('a', { parentId: 'lf' });
  const b = rect('b', { parentId: 'lf', x: 100 });

  it('reflows siblings in the same transaction as the edit, with one undo entry', () => {
    const history = new UndoHistory();
    const model = new BoardModel('/b.openboard', doc([lf, a, b]), { history, now: () => '2020-01-01T00:00:00.000Z' });
    const pre = model.getDocument();
    model.transact('resize', (tx) => tx.update('a', { width: 40 }));
    const bEl = model.getDocument().elements.find((e) => e.id === 'b')!;
    expect(bEl.x).toBe(50);
    expect(history.undo(model)).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(model.getDocument()).toEqual(pre);
    expect(history.redo(model)).toBe(true);
    expect(model.getDocument().elements.find((e) => e.id === 'b')!.x).toBe(50);
  });

  it('is idempotent and terminates', () => {
    const r = runDerivedGeometryPass(doc([lf, a, b]));
    const again = runDerivedGeometryPass(r.doc);
    expect(again.patches).toEqual([]);
  });

  it('yields zero patches for an already laid-out document', () => {
    const settled = runDerivedGeometryPass(doc([lf, a, b])).doc;
    expect(runDerivedGeometryPass(settled).patches).toEqual([]);
  });
});

describe('runDerivedGeometryPass', () => {
  const master = frame('M', { component: 'Card' });
  const child = rect('a', { parentId: 'M' });
  const start = doc([master, child, frame('I', { instanceOf: 'M', x: 200 })]);

  it('produces zero patches for a document with nothing to derive', () => {
    const d = doc([rect('a'), rect('b')]);
    const r = runDerivedGeometryPass(d);
    expect(r.doc).toBe(d);
    expect(r.patches).toEqual([]);
    expect(r.inversePatches).toEqual([]);
    expect(r.changedIds).toEqual([]);
  });

  it('syncs instances; patches apply forward and inverse patches restore the input', () => {
    const r = runDerivedGeometryPass(start);
    expect(r.doc.elements.map((e) => e.id)).toContain('I::a');
    expect(applyPatches(start, r.patches)).toEqual(r.doc);
    expect(applyPatches(r.doc, r.inversePatches)).toEqual(start);
    expect(r.changedIds).toContain('I::a');
  });

  it('is idempotent', () => {
    const once = runDerivedGeometryPass(start);
    const twice = runDerivedGeometryPass(once.doc);
    expect(twice.patches).toEqual([]);
    expect(twice.changedIds).toEqual([]);
  });

  it('updates locked elements like unlocked ones', () => {
    const d = doc([master, child, frame('I', { instanceOf: 'M', locked: true })]);
    const r = runDerivedGeometryPass(d);
    expect(r.doc.elements.map((e) => e.id)).toContain('I::a');
    const inst = r.doc.elements.find((e) => e.id === 'I')!;
    expect([inst.width, inst.height]).toEqual([100, 50]);
  });

  it('throws DerivedGeometryError(component-cycle) on a cycle without mutating the input', () => {
    const d = doc([
      frame('A', { component: 'A' }),
      frame('iB', { parentId: 'A', instanceOf: 'B' }),
      frame('B', { component: 'B' }),
      frame('iA', { parentId: 'B', instanceOf: 'A' }),
    ]);
    const snapshot = structuredClone(d);
    let err: unknown;
    try {
      runDerivedGeometryPass(d);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DerivedGeometryError);
    expect((err as DerivedGeometryError).reason).toBe('component-cycle');
    expect(d).toEqual(snapshot);
  });

  it('throws iteration-limit when a pass never stabilizes', () => {
    let n = 0;
    const flip: DerivedPassFn = (d) => ({
      doc: { ...d, elements: [{ ...d.elements[0]!, x: ++n } as Element] },
      changedIds: ['a'],
    });
    const d = doc([rect('a')]);
    expect(() => runDerivedGeometryPass(d, [flip])).toThrowError(DerivedGeometryError);
    expect(n).toBe(10);
  });

  it('wraps unexpected pass errors', () => {
    const boom: DerivedPassFn = () => {
      throw new Error('boom');
    };
    try {
      runDerivedGeometryPass(doc([rect('a')]), [boom]);
      expect.unreachable();
    } catch (e) {
      expect((e as DerivedGeometryError).reason).toBe('pass-error');
    }
  });
});

describe('diffElements', () => {
  it('emits per-index replace patches when ids are unchanged', () => {
    const before = [rect('a'), rect('b')];
    const after = [before[0]!, rect('b', { x: 5 })];
    const d = diffElements(before, after);
    expect(d.patches).toEqual([{ op: 'replace', path: ['elements', 1], value: after[1] }]);
    expect(d.inversePatches).toEqual([{ op: 'replace', path: ['elements', 1], value: before[1] }]);
    expect(d.changedIds).toEqual(['b']);
  });

  it('ignores structurally equal elements', () => {
    expect(diffElements([rect('a')], [rect('a')]).patches).toEqual([]);
  });

  it('handles insertion, deletion, and reordering', () => {
    const a = rect('a');
    const b = rect('b');
    expect(diffElements([a], [a, b]).changedIds).toEqual(['b']);
    expect(diffElements([a, b], [a]).changedIds).toEqual(['b']);
    const re = diffElements([a, b], [b, a]);
    expect(re.changedIds.sort()).toEqual(['a', 'b']);
    expect(applyPatches(doc([b, a]), re.inversePatches).elements).toEqual([a, b]);
  });
});
