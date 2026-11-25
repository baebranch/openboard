import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { uniqueComponentName, validateComponentName } from '../components/names';
import { DefaultToolRegistry } from './registry';
import { registerComponentTools } from './component-tools';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const rect = (id: string, x: number, y: number, extra: object = {}): Element =>
  ({ id, type: 'rectangle', x, y, width: 10, height: 20, rotation: 0, style, ...extra }) as Element;
const frame = (id: string, extra: object = {}): Element =>
  ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 100, rotation: 0, style, name: 'Frame', ...extra }) as Element;

function setup(elements: Element[]) {
  const doc: BoardDocument = {
    schemaVersion: 1,
    meta: { id: 'b' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements,
    assets: [],
    library: [],
  };
  const history = new UndoHistory();
  const model = new BoardModel('/b.openboard', doc, { history });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerComponentTools(reg);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  return { model, run, history };
}
const snap = (m: BoardModel): string => JSON.stringify(m.getDocument());

describe('component names', () => {
  it('trims, bounds, and de-duplicates names', () => {
    expect(validateComponentName('  Btn  ')).toEqual({ ok: true, name: 'Btn' });
    expect(validateComponentName('   ')).toMatchObject({ ok: false, code: 'invalid_name' });
    expect(validateComponentName('x'.repeat(101))).toMatchObject({ ok: false, code: 'invalid_name' });
    expect(validateComponentName('Btn', ['Btn'])).toMatchObject({ ok: false, code: 'duplicate_name' });
    expect(validateComponentName('btn', ['Btn'])).toMatchObject({ ok: true });
    expect(uniqueComponentName('Btn', ['Btn', 'Btn 2'])).toBe('Btn 3');
    const long = 'a'.repeat(100);
    const out = uniqueComponentName(long, [long]);
    expect(out).toHaveLength(100);
    expect(out.endsWith(' 2')).toBe(true);
  });
});

describe('component tools', () => {
  it('marks a single Frame as a master in one undo step', async () => {
    const { run, model, history } = setup([frame('f')]);
    const before = snap(model);
    const r = await run('openboard.component.create', { ids: ['f'], name: '  Card ' });
    expect(r).toMatchObject({ id: 'f', name: 'Card', wrapped: false });
    expect((model.getDocument().elements[0] as any).component).toBe('Card');
    expect(history.undo(model)).toBe(true);
    expect(snap(model)).toBe(before);
  });

  it('wraps non-Frame elements in a new master Frame at the union bounds', async () => {
    const { run, model, history } = setup([rect('a', 10, 10), rect('b', 50, 40)]);
    const before = snap(model);
    const r = await run('openboard.component.create', { ids: ['a', 'b'], name: 'Pair' });
    expect(r.wrapped).toBe(true);
    const doc = model.getDocument();
    const f = doc.elements.find((e) => e.id === r.id) as any;
    expect(f).toMatchObject({ type: 'frame', x: 10, y: 10, width: 50, height: 50, component: 'Pair' });
    expect(doc.elements.filter((e) => e.parentId === r.id).map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(doc.elements[0]?.id).toBe(r.id);
    expect(history.undo(model)).toBe(true);
    expect(snap(model)).toBe(before);
  });

  it('rejects invalid create requests without changing the document or history', async () => {
    const { run, model, history } = setup([
      frame('f'),
      frame('g'),
      frame('m', { component: 'Taken' }),
      frame('i', { instanceOf: 'm' }),
      rect('r', 0, 0),
    ]);
    const before = snap(model);
    const code = async (input: unknown): Promise<string> => (await run('openboard.component.create', input)).error.code;
    expect(await code({ ids: ['f'], name: '   ' })).toBe('invalid_name');
    expect(await code({ ids: ['f'], name: 'x'.repeat(101) })).toBe('invalid_name');
    expect(await code({ ids: ['f'], name: 'Taken' })).toBe('duplicate_name');
    expect(await code({ ids: ['nope'], name: 'N' })).toBe('not_found');
    expect(await code({ ids: ['f', 'g'], name: 'N' })).toBe('invalid_selection');
    expect(await code({ ids: ['f', 'r'], name: 'N' })).toBe('invalid_selection');
    expect(await code({ ids: ['m'], name: 'N' })).toBe('already_component');
    expect(await code({ ids: ['i'], name: 'N' })).toBe('instance_cannot_be_master');
    expect(snap(model)).toBe(before);
    expect(history.undo(model)).toBe(false);
  });

  it('lists masters sorted by name with instance counts', async () => {
    const { run } = setup([
      frame('b', { component: 'Beta' }),
      frame('a', { component: 'Alpha' }),
      frame('i1', { instanceOf: 'a' }),
      frame('i2', { instanceOf: 'a' }),
      frame('f'),
    ]);
    const r = await run('openboard.component.list', {});
    expect(r.components.map((c: any) => [c.name, c.instances])).toEqual([
      ['Alpha', 2],
      ['Beta', 0],
    ]);
  });

  it('removes a component marker, detaches its instances, and undoes as one step', async () => {
    const { run, model, history } = setup([
      frame('m', { component: 'Card' }),
      frame('i', { instanceOf: 'm', overrides: { c: { opacity: 50 } } }),
      rect('i::c', 0, 0, { parentId: 'i' }),
    ]);
    const before = snap(model);
    const r = await run('openboard.component.remove', { id: 'm' });
    expect(r.detached).toEqual(['i']);
    const els = model.getDocument().elements as any[];
    expect(els[0].component).toBeUndefined();
    expect(els[1].instanceOf).toBeUndefined();
    expect(els[1].overrides).toBeUndefined();
    expect(els[2].id).toBe('i::c');
    expect(history.undo(model)).toBe(true);
    expect(snap(model)).toBe(before);
  });

  it('rejects remove on a non-master or missing element', async () => {
    const { run, model } = setup([frame('f'), rect('r', 0, 0)]);
    const before = snap(model);
    expect((await run('openboard.component.remove', { id: 'f' })).error.code).toBe('not_a_component');
    expect((await run('openboard.component.remove', { id: 'r' })).error.code).toBe('not_a_component');
    expect((await run('openboard.component.remove', { id: 'zz' })).error.code).toBe('not_found');
    expect(snap(model)).toBe(before);
  });
});
