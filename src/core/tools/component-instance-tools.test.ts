import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerComponentTools } from './component-tools';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const rect = (id: string, extra: object = {}): Element =>
  ({ id, type: 'rectangle', x: 10, y: 10, width: 10, height: 20, rotation: 0, style, ...extra }) as Element;
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
  const get = (id: string) => model.getDocument().elements.find((e) => e.id === id) as any;
  return { model, run, history, get };
}
const snap = (m: BoardModel): string => JSON.stringify(m.getDocument());
const master = () => [frame('M', { component: 'Card' }), rect('r', { parentId: 'M' })];

describe('component instance tools', () => {
  it('creates an instance with derived children as one undo step', async () => {
    const { run, model, history, get } = setup(master());
    const before = snap(model);
    const r = await run('openboard.component.instance.create', { master: 'M', x: 300, y: 0 });
    expect(r.error).toBeUndefined();
    expect(get(r.id).instanceOf).toBe('M');
    expect(get(`${r.id}::r`).x).toBe(310);
    expect(history.undo(model)).toBe(true);
    expect(snap(model)).toBe(before);
  });

  it('rejects a non-master and a cycle without changes', async () => {
    const { run, model, history } = setup([...master(), frame('plain')]);
    const before = snap(model);
    expect((await run('openboard.component.instance.create', { master: 'plain' })).error.code).toBe('not_a_component');
    const cyc = await run('openboard.component.instance.create', { master: 'M', parentId: 'M' });
    expect(cyc.error.message).toMatch(/cycle/);
    expect(snap(model)).toBe(before);
    expect(history.undo(model)).toBe(false);
  });

  it('sets and resets overrides', async () => {
    const { run, model, history, get } = setup(master());
    const { id } = await run('openboard.component.instance.create', { master: 'M', x: 300, y: 0 });
    const set = await run('openboard.component.instance.override.set', { id: `${id}::r`, property: 'fill', value: '#ff0000' });
    expect(set.error).toBeUndefined();
    expect(get(`${id}::r`).style.fill).toBe('#ff0000');
    expect(get(id).overrides).toEqual({ r: { fill: '#ff0000' } });
    const root = await run('openboard.component.instance.override.set', { id, property: 'width', value: 150 });
    expect(root.error).toBeUndefined();
    expect(get(id).width).toBe(150);
    // The root accepts style overrides (fill, stroke, opacity, imageFill) but not text-only ones.
    expect((await run('openboard.component.instance.override.set', { id, property: 'text', value: 'x' })).error).toBeDefined();
    expect((await run('openboard.component.instance.override.set', { id, property: 'visible', value: false })).error).toBeDefined();
    expect((await run('openboard.component.instance.override.set', { id: `${id}::r`, property: 'fontWeight', value: 450 })).error).toBeDefined();

    expect((await run('openboard.component.instance.override.reset', { id: `${id}::r`, property: 'fill' })).removed).toBe(1);
    expect(get(`${id}::r`).style.fill).toBe('theme:default');
    const stamp = snap(model);
    const none = await run('openboard.component.instance.override.reset', { id: `${id}::r` });
    expect(none).toMatchObject({ removed: 0 });
    expect(snap(model)).toBe(stamp);
    await run('openboard.component.instance.override.reset', { id });
    expect(get(id).overrides).toBeUndefined();
    expect(get(id).width).toBe(100);
    expect(history.undo(model)).toBe(true);
  });

  it('detaches an instance and rejects a non-instance', async () => {
    const { run, get } = setup([...master(), frame('plain')]);
    const { id } = await run('openboard.component.instance.create', { master: 'M', x: 300, y: 0 });
    const d = await run('openboard.component.instance.detach', { id });
    expect(d).toMatchObject({ id, children: 1 });
    expect(get(id).instanceOf).toBeUndefined();
    expect(get(`${id}::r`)).toBeDefined();
    expect((await run('openboard.component.instance.detach', { id: 'plain' })).error.code).toBe('not_an_instance');
  });
});
