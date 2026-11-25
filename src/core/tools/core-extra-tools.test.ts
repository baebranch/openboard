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
    expect(card.ids.length).toBe(BUILTIN_COMPONENTS.find((c) => c.name === 'card')!.elements.length);
    expect((await run('openboard.library.insert', { component: 'missing' })).error.code).toBe('not_found');
    // import tool also resolves built-ins
    expect((await run('openboard.import', { source: 'component', component: 'button' })).ids.length).toBeGreaterThan(0);
  });

  it('shares an injected selection store', () => {
    const store = new MemorySelectionStore();
    store.set('/b', ['a']);
    expect(store.get('/b')).toEqual(['a']);
  });
});
