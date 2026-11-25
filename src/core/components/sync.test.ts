import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { ComponentCycleError, ComponentDepthError, syncPass } from './sync';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { x: 0, y: 0, width: 10, height: 10, rotation: 0, style };
const rect = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'rectangle', ...base, ...extra }) as Element;
const frame = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name: id, ...base, width: 100, height: 50, ...extra }) as Element;
const edge = (id: string, sourceId: string, targetId: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'edge', ...base, sourceId, targetId, routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow', ...extra }) as Element;
const doc = (elements: Element[]): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
});
const ids = (d: BoardDocument): string[] => d.elements.map((e) => e.id);

describe('syncPass', () => {
  const master = frame('M', { component: 'Card', x: 10, y: 20 });
  const a = rect('a', { parentId: 'M', x: 15, y: 25 });
  const b = rect('b', { parentId: 'a', x: 16, y: 26 });

  it('is a no-op for a document with no instances', () => {
    const d = doc([master, a]);
    const r = syncPass(d);
    expect(r.doc).toBe(d);
    expect(r.changedIds).toEqual([]);
  });

  it('expands children with derived ids, parents, and offset positions', () => {
    const r = syncPass(doc([master, a, b, frame('I', { instanceOf: 'M', x: 200, y: 300 })]));
    expect(ids(r.doc)).toEqual(['M', 'a', 'b', 'I', 'I::a', 'I::b']);
    const ia = r.doc.elements.find((e) => e.id === 'I::a')!;
    const ib = r.doc.elements.find((e) => e.id === 'I::b')!;
    expect(ia.parentId).toBe('I');
    expect(ib.parentId).toBe('I::a');
    expect([ia.x, ia.y]).toEqual([205, 305]);
    const inst = r.doc.elements.find((e) => e.id === 'I')!;
    expect([inst.width, inst.height]).toEqual([100, 50]);
  });

  it('is idempotent', () => {
    const once = syncPass(doc([master, a, b, frame('I', { instanceOf: 'M', x: 200, y: 300 })]));
    const twice = syncPass(once.doc);
    expect(twice.changedIds).toEqual([]);
    expect(twice.doc).toBe(once.doc);
  });

  it('applies overrides and the root size override', () => {
    const inst = frame('I', {
      instanceOf: 'M',
      overrides: { a: { fill: '#ff0000', opacity: 50 }, '': { width: 300 } },
    });
    const r = syncPass(doc([master, a, inst]));
    const ia = r.doc.elements.find((e) => e.id === 'I::a')!;
    expect(ia.style.fill).toBe('#ff0000');
    expect(ia.style.opacity).toBe(50);
    const i = r.doc.elements.find((e) => e.id === 'I')!;
    expect([i.width, i.height]).toEqual([300, 50]);
  });

  it('maps an icon override to the icon child name only', () => {
    const icon = { ...rect('ic', { parentId: 'M' }), type: 'icon', name: 'star' } as unknown as Element;
    const r = syncPass(
      doc([master, icon, frame('I', { instanceOf: 'M', overrides: { ic: { icon: 'heart' } } }), frame('J', { instanceOf: 'M', x: 400 })]),
    );
    const get = (id: string) => r.doc.elements.find((e) => e.id === id) as unknown as Record<string, unknown>;
    expect(get('I::ic').name).toBe('heart');
    expect(get('I::ic').icon).toBeUndefined();
    expect(get('J::ic').name).toBe('star');
    expect(get('ic').name).toBe('star');
  });

  it('removes orphaned children with their edges, leaves user children alone', () => {
    const inst = frame('I', { instanceOf: 'M' });
    const synced = syncPass(doc([master, a, b, edge('e', 'a', 'b'), inst])).doc;
    expect(ids(synced)).toContain('I::e');
    const user = rect('user', { parentId: 'I', x: 7 });
    const userEdge = edge('ue', 'user', 'I::b');
    const withUser = { ...synced, elements: [...synced.elements, user, userEdge] };
    const trimmed = {
      ...withUser,
      elements: withUser.elements.filter((e) => e.id !== 'b' && e.id !== 'e'),
    };
    const r = syncPass(trimmed);
    expect(ids(r.doc)).toEqual(['M', 'a', 'I', 'I::a', 'user']);
    expect(r.doc.elements.find((e) => e.id === 'user')).toBe(user);
    expect(r.changedIds).toEqual(expect.arrayContaining(['I::b', 'I::e', 'ue']));
  });

  it('remaps edge endpoints to the Instance_Children', () => {
    const r = syncPass(doc([master, a, b, edge('e', 'a', 'b'), frame('I', { instanceOf: 'M' })]));
    const e = r.doc.elements.find((x) => x.id === 'I::e');
    expect(e && e.type === 'edge' && [e.sourceId, e.targetId]).toEqual(['I::a', 'I::b']);
  });

  it('replaces existing children in place, keeping stacking order', () => {
    const inst = frame('I', { instanceOf: 'M' });
    const synced = syncPass(doc([master, a, b, inst])).doc;
    const user = rect('u');
    // Put a user element between the two children and edit the master.
    const els = synced.elements.slice();
    els.splice(els.findIndex((e) => e.id === 'I::b'), 0, user);
    const edited = els.map((e) => (e.id === 'a' ? { ...e, width: 99 } : e));
    const r = syncPass({ ...synced, elements: edited });
    expect(ids(r.doc)).toEqual(['M', 'a', 'b', 'I', 'I::a', 'u', 'I::b']);
    expect(r.doc.elements.find((e) => e.id === 'I::a')!.width).toBe(99);
  });

  it('restores master stacking order when children are shuffled', () => {
    const synced = syncPass(doc([master, a, b, frame('I', { instanceOf: 'M' })])).doc;
    const els = synced.elements.slice();
    const i = els.findIndex((e) => e.id === 'I::a');
    [els[i], els[i + 1]] = [els[i + 1]!, els[i]!];
    const r = syncPass({ ...synced, elements: els });
    expect(ids(r.doc)).toEqual(['M', 'a', 'b', 'I', 'I::a', 'I::b']);
  });

  it('treats an instance with an unknown master as an ordinary frame', () => {
    const d = doc([frame('I', { instanceOf: 'gone' }), rect('c', { parentId: 'I' })]);
    expect(syncPass(d).doc).toBe(d);
  });

  it('expands nested instances', () => {
    const inner = frame('N', { component: 'Inner', x: 0, y: 0 });
    const ic = rect('ic', { parentId: 'N' });
    const outer = frame('M2', { component: 'Outer', x: 0, y: 0 });
    const nested = frame('n1', { parentId: 'M2', instanceOf: 'N' });
    const r = syncPass(doc([inner, ic, outer, nested, frame('I', { instanceOf: 'M2' })]));
    expect(ids(r.doc)).toEqual(['N', 'ic', 'M2', 'n1', 'n1::ic', 'I', 'I::n1', 'I::n1::ic']);
    expect(syncPass(r.doc).changedIds).toEqual([]);
  });

  it('throws ComponentCycleError naming the masters', () => {
    const m1 = frame('M1', { component: 'A' });
    const inside = frame('x', { parentId: 'M1', instanceOf: 'M1' });
    expect(() => syncPass(doc([m1, inside]))).toThrow(ComponentCycleError);
    const m2 = frame('M2', { component: 'B' });
    const i1 = frame('i1', { parentId: 'M1', instanceOf: 'M2' });
    const i2 = frame('i2', { parentId: 'M2', instanceOf: 'M1' });
    try {
      syncPass(doc([m1, m2, i1, i2]));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ComponentCycleError);
      expect((err as ComponentCycleError).masterIds.sort()).toEqual(['M1', 'M2']);
    }
  });

  it('throws ComponentDepthError for chains longer than 8 levels', () => {
    const build = (levels: number): Element[] => {
      const els: Element[] = [frame('m0', { component: 'c0' })];
      for (let i = 1; i < levels; i++) {
        els.push(frame(`m${i}`, { component: `c${i}` }), frame(`n${i}`, { parentId: `m${i}`, instanceOf: `m${i - 1}` }));
      }
      els.push(frame('top', { instanceOf: `m${levels - 1}` }));
      return els;
    };
    expect(() => syncPass(doc(build(8)))).not.toThrow();
    expect(() => syncPass(doc(build(9)))).toThrow(ComponentDepthError);
  });
});
