import { describe, expect, it } from 'vitest';
import { buildFullRegistry } from '../../../test/helpers/registry';
import { MemorySelectionStore } from './view-tools';
import { BUILTIN_COMPONENTS } from '../library/builtins';

function setup() {
  const f = buildFullRegistry({ spy: false });
  const run = (name: string, input: unknown = {}) => f.registry.invoke(name, input) as Promise<any>;
  const makeRects = async (n: number) => {
    const r = await run('openboard.element.create', {
      elements: Array.from({ length: n }, (_, i) => ({ type: 'rectangle', x: i * 200, y: 0, width: 100, height: 50 })),
    });
    return r.ids as string[];
  };
  return { ...f, run, makeRects };
}

describe('core extra tools', () => {
  it('schema returns element and tool schemas', async () => {
    const { run, registry } = setup();
    const r = await run('openboard.schema');
    expect(Object.keys(r.elements)).toContain('rectangle');
    expect(Object.keys(r.tools).sort()).toEqual(registry.list().sort());
    expect(r.tools['openboard.undo'].inputSchema).toBeDefined();
    expect((await run('openboard.schema', { tool: 'nope' })).error.code).toBe('unknown_tool');
  });

  it('schema lists every Mockup_Field with value type and description', async () => {
    const { run } = setup();
    const r = await run('openboard.schema');
    const names = (t: string) => r.mockupFields[t].map((f: any) => f.name);
    expect(names('frame')).toEqual(expect.arrayContaining(['layout', 'clipContent', 'component', 'instanceOf', 'overrides', 'sizing', 'ignoreLayout']));
    expect(names('icon')).toContain('name');
    expect(names('text')).toContain('fontWeight');
    expect(names('text')).not.toContain('layout');
    for (const type of Object.keys(r.elements)) {
      for (const f of r.mockupFields[type]) {
        expect(f.valueType.length).toBeGreaterThan(0);
        expect(f.description.length).toBeGreaterThan(0);
      }
    }
    expect(r.documentFields.map((f: any) => f.name)).toContain('tokens');
  });

  it('summary counts, bounds and viewport', async () => {
    const { run, makeRects } = setup();
    await makeRects(3);
    const r = await run('openboard.board.summary');
    expect(r.total).toBe(3);
    expect(r.counts.rectangle).toBe(3);
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 500, height: 50 });
    expect(r.ids).toHaveLength(3);
    expect(r.viewport.zoom).toBe(1);
  });

  it('selection get/set and not_found', async () => {
    const { run, makeRects } = setup();
    const ids = await makeRects(2);
    expect((await run('openboard.selection')).ids).toEqual([]);
    expect((await run('openboard.selection', { action: 'set', ids: [ids[1]] })).ids).toEqual([ids[1]]);
    expect((await run('openboard.selection', { action: 'get' })).ids).toEqual([ids[1]]);
    expect((await run('openboard.selection', { action: 'set', ids: ['zzz'] })).error.code).toBe('not_found');
  });

  it('viewport actions do not touch history', async () => {
    const { run, makeRects, history, model } = setup();
    const ids = await makeRects(2);
    const before = history.undoCount();
    expect((await run('openboard.viewport', { action: 'set', x: 10, y: 20, zoom: 2 })).viewport).toEqual({ x: 10, y: 20, zoom: 2 });
    expect((await run('openboard.viewport', { action: 'pan', dx: 5, dy: -5 })).viewport).toEqual({ x: 15, y: 15, zoom: 2 });
    const fit = await run('openboard.viewport', { action: 'zoomToFit' });
    expect(fit.viewport.zoom).toBeGreaterThan(0.02);
    expect(fit.viewport.zoom).toBeLessThanOrEqual(8);
    // zoomToSelection with an empty selection leaves the viewport unchanged
    expect((await run('openboard.viewport', { action: 'zoomToSelection' })).changed).toBe(false);
    await run('openboard.selection', { action: 'set', ids: [ids[0]] });
    expect((await run('openboard.viewport', { action: 'zoomToSelection' })).changed).toBe(true);
    expect(history.undoCount()).toBe(before);
    expect(model.getDocument().viewport.zoom).toBeGreaterThan(0);
    expect((await run('openboard.viewport', { action: 'set' })).error.code).toBe('invalid_input');
  });

  it('undo and redo', async () => {
    const { run, makeRects, model } = setup();
    expect((await run('openboard.undo')).done).toBe(false);
    await makeRects(1);
    const u = await run('openboard.undo');
    expect(u).toMatchObject({ done: true, canUndo: false, canRedo: true });
    expect(model.getDocument().elements).toHaveLength(0);
    expect((await run('openboard.redo')).done).toBe(true);
    expect(model.getDocument().elements).toHaveLength(1);
    expect((await run('openboard.redo')).done).toBe(false);
  });

  it('library save/list/insert including built-ins', async () => {
    const { run, makeRects, model } = setup();
    const ids = await makeRects(2);
    // empty selection and bad names are rejected
    expect((await run('openboard.library.save', { name: 'x' })).error.code).toBe('empty_selection');
    expect((await run('openboard.library.save', { name: '', ids })).error.code).toBe('invalid_input');
    expect((await run('openboard.library.save', { name: 'x'.repeat(101), ids })).error.code).toBe('invalid_input');

    await run('openboard.selection', { action: 'set', ids });
    const saved = await run('openboard.library.save', { name: 'pair' });
    expect(saved.count).toBe(2);
    expect(model.getDocument().library).toHaveLength(1);

    const list = await run('openboard.library.list');
    expect(list.components.filter((c: any) => c.builtin).map((c: any) => c.name)).toEqual(
      BUILTIN_COMPONENTS.map((c) => c.name),
    );
    expect(list.components.some((c: any) => c.id === saved.id && !c.builtin)).toBe(true);

    const ins = await run('openboard.library.insert', { component: 'pair', x: 1000, y: 1000 });
    expect(ins.ids).toHaveLength(2);
    expect(ins.ids.some((id: string) => ids.includes(id))).toBe(false);
    const card = await run('openboard.library.insert', { component: 'card' });
    // The card is a Component_Master: its elements plus one instance (Req 16.6).
    expect(card.ids.length).toBe(BUILTIN_COMPONENTS.find((c) => c.name === 'card')!.elements.length + 1);
    expect((await run('openboard.library.insert', { component: 'missing' })).error.code).toBe('not_found');
    // import tool also resolves built-ins
    expect((await run('openboard.import', { source: 'component', component: 'button' })).ids.length).toBeGreaterThan(0);
  });

  it('inserts the checkbox, toggle, avatar, and badge masters with their tokens (Req 16.11)', async () => {
    for (const name of ['checkbox', 'toggle', 'avatar', 'badge']) {
      const { run, model } = setup();
      const entry = BUILTIN_COMPONENTS.find((c) => c.name === name)!;
      expect(entry.elements[0]!.type).toBe('frame');
      const res = await run('openboard.library.insert', { component: name });
      expect(res.error).toBeUndefined();
      // Master elements plus one instance (Req 16.6).
      expect(res.ids.length).toBe(entry.elements.length + 1);
      const colors = model.getDocument().tokens?.colors ?? {};
      for (const key of Object.keys(entry.tokens?.colors ?? {})) expect(colors).toHaveProperty(key);
    }
  });

  it('built-in kit masters use Auto Layout; changing instance text resizes it in one undo step (Req 16.9, 16.10)', async () => {
    const devices = ['phone', 'tablet', 'browser'];
    for (const c of BUILTIN_COMPONENTS.filter((b) => b.elements[0]!.type === 'frame' && !devices.includes(b.name))) {
      expect((c.elements[0] as any).layout, c.name).toBeDefined();
    }
    const { run, model, history } = setup();
    const res = await run('openboard.library.insert', { component: 'button' });
    const instanceId = res.ids[res.ids.length - 1] as string;
    const widthOf = (id: string) => model.getDocument().elements.find((e) => e.id === id)!.width;
    const master = widthOf('button-root');
    // Children sit inside the master's padding, laid out by the Layout_Pass.
    const lbl = model.getDocument().elements.find((e) => e.id === 'button-label')!;
    const root = model.getDocument().elements.find((e) => e.id === 'button-root')!;
    expect(lbl.x).toBe(root.x + 16);
    expect(widthOf(instanceId)).toBe(master);

    const before = history.undoCount();
    const set = await run('openboard.component.instance.override.set', {
      id: instanceId,
      childId: 'button-label',
      property: 'text',
      value: 'A much longer button caption',
    });
    expect(set.error).toBeUndefined();
    expect(history.undoCount()).toBe(before + 1);
    expect(widthOf(instanceId)).toBeGreaterThan(master);
    await run('openboard.undo');
    expect(widthOf(instanceId)).toBe(master);
  });

  it('library carries tokens: records on save, adds missing on insert, keeps existing values', async () => {
    const { run, makeRects, model, history } = setup();
    const ids = await makeRects(1);
    model.transact('seed', (tx) => {
      tx.createToken('colors', 'brand', '#ff0000');
      tx.createToken('colors', 'unused', '#000000');
    });
    expect((await run('openboard.element.update', { ids, set: { fill: 'token:brand' } })).error).toBeUndefined();
    const saved = await run('openboard.library.save', { name: 'tok', ids });
    expect(model.getDocument().library[0]!.tokens).toEqual({ colors: { brand: '#ff0000' } });

    // Existing value is kept
    model.transact('change', (tx) => tx.updateToken('colors', 'brand', '#00ff00'));
    await run('openboard.library.insert', { component: saved.id });
    expect(model.getDocument().tokens!.colors!['brand']).toBe('#00ff00');

    // Missing token is added, and undo reverts insertion and token together
    model.transact('rm', (tx) => tx.deleteToken('colors', 'brand'));
    const before = history.undoCount();
    await run('openboard.library.insert', { component: saved.id });
    expect(history.undoCount()).toBe(before + 1);
    expect(model.getDocument().tokens!.colors!['brand']).toBe('#ff0000');
    await run('openboard.undo');
    expect(model.getDocument().tokens?.colors?.['brand']).toBeUndefined();
  });

  it('shares an injected selection store', () => {
    const store = new MemorySelectionStore();
    store.set('/b', ['a']);
    expect(store.get('/b')).toEqual(['a']);
  });
});
