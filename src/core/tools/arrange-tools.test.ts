import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerArrangeTools } from './arrange-tools';

const style = { fill: 'none', stroke: '#000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const rect = (id: string, x: number, y: number, w = 10, h = 10): Element =>
  ({ id, type: 'rectangle', x, y, width: w, height: h, rotation: 0, style }) as unknown as Element;

function setup(elements: Element[]) {
  const doc: BoardDocument = {
    schemaVersion: 1,
    meta: { id: 'b' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements,
    assets: [],
    library: [],
  } as unknown as BoardDocument;
  const history = new UndoHistory();
  const model = new BoardModel('/b.openboard', doc, { history });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerArrangeTools(reg);
  const run = (input: unknown) => reg.invoke('openboard.element.arrange', input) as Promise<any>;
  const el = (id: string) => model.getDocument().elements.find((e) => e.id === id) as any;
  return { model, history, run, el };
}

describe('openboard.element.arrange', () => {
  it('groups and ungroups; group of <2 is a no-op without history', async () => {
    const { run, el, history } = setup([rect('a', 0, 0), rect('b', 5, 5)]);
    expect((await run({ action: 'group', ids: ['a'] })).changed).toBe(false);
    expect(history.undoCount()).toBe(0);
    expect((await run({ action: 'group', ids: ['a', 'b'] })).changed).toBe(true);
    expect(el('a').groupId).toBeDefined();
    expect(el('a').groupId).toBe(el('b').groupId);
    expect(history.undoCount()).toBe(1);
    expect((await run({ action: 'ungroup', ids: ['a'] })).changed).toBe(true);
    expect(el('b').groupId).toBeUndefined();
  });

  it('aligns to selection bounds and distributes evenly', async () => {
    const { run, el } = setup([rect('a', 0, 0, 10, 10), rect('b', 50, 20, 20, 10), rect('c', 100, 5, 10, 10)]);
    await run({ action: 'align', ids: ['a', 'b', 'c'], alignment: 'right' });
    expect([el('a').x, el('b').x, el('c').x]).toEqual([100, 90, 100]);
    await run({ action: 'align', ids: ['a', 'b'], alignment: 'middle' });
    expect([el('a').y, el('b').y]).toEqual([10, 10]);
    const d = setup([rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10), rect('c', 100, 0, 10, 10)]);
    await d.run({ action: 'distribute', ids: ['a', 'b', 'c'], direction: 'horizontal' });
    expect([d.el('a').x, d.el('b').x, d.el('c').x]).toEqual([0, 50, 100]);
    expect((await d.run({ action: 'distribute', ids: ['a', 'b'], direction: 'horizontal' })).changed).toBe(false);
  });

  it('reorders z-order preserving relative order', async () => {
    const { run, model } = setup([rect('a', 0, 0), rect('b', 0, 0), rect('c', 0, 0), rect('d', 0, 0)]);
    await run({ action: 'zorder', ids: ['a', 'c'], mode: 'front' });
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['b', 'd', 'a', 'c']);
    expect((await run({ action: 'zorder', ids: ['a', 'c'], mode: 'front' })).changed).toBe(false);
  });

  it('duplicates, copies, cuts and pastes', async () => {
    const { run, model, history } = setup([rect('a', 0, 0), rect('b', 30, 0)]);
    const dup = await run({ action: 'duplicate', ids: ['a'] });
    expect(dup.ids).toHaveLength(1);
    expect(dup.ids[0]).not.toBe('a');
    expect(model.getDocument().elements).toHaveLength(3);
    const n = history.undoCount();
    const copy = await run({ action: 'copy', ids: ['b'] });
    expect(copy.changed).toBe(false);
    expect(history.undoCount()).toBe(n);
    const cut = await run({ action: 'cut', ids: ['b'] });
    expect(cut.deleted).toEqual(['b']);
    expect(model.getDocument().elements.find((e) => e.id === 'b')).toBeUndefined();
    const pasted = await run({ action: 'paste', clipboard: copy.clipboard, offset: { x: 5, y: 7 } });
    expect(pasted.changed).toBe(true);
    const created = model.getDocument().elements.find((e) => e.id === pasted.ids[0]) as any;
    expect([created.x, created.y]).toEqual([35, 7]);
    const before = history.undoCount();
    expect((await run({ action: 'paste', clipboard: { elements: [] } })).changed).toBe(false);
    expect(history.undoCount()).toBe(before);
  });

  it('nudges by 1 or 10 px and is a no-op when nothing is selected', async () => {
    const { run, el, history } = setup([rect('a', 0, 0)]);
    await run({ action: 'nudge', ids: ['a'], dx: 1, dy: -1 });
    expect([el('a').x, el('a').y]).toEqual([1, -1]);
    await run({ action: 'nudge', ids: ['a'], dx: 1, amount: 10 });
    expect(el('a').x).toBe(11);
    const n = history.undoCount();
    expect((await run({ action: 'nudge', ids: [], dx: 1 })).changed).toBe(false);
    expect(history.undoCount()).toBe(n);
  });

  it('reports unknown ids', async () => {
    const { run } = setup([rect('a', 0, 0)]);
    expect((await run({ action: 'group', ids: ['a', 'zz'] })).error.code).toBe('not_found');
  });
});
