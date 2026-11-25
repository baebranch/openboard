import { describe, expect, it } from 'vitest';
import { buildFullRegistry } from '../../../test/helpers/registry';

function setup() {
  const f = buildFullRegistry({ spy: false });
  const run = (name: string, input: unknown = {}) => f.registry.invoke(name, input) as Promise<any>;
  return { ...f, run };
}

/** A rectangle at the origin, wrapped as a master named `name`; returns the master id. */
async function makeMaster(run: ReturnType<typeof setup>['run'], name: string, x = 0): Promise<string> {
  const r = await run('openboard.element.create', {
    elements: [{ type: 'rectangle', x, y: 0, width: 100, height: 50 }],
  });
  const m = await run('openboard.component.create', { ids: r.ids, name });
  expect(m.error).toBeUndefined();
  return m.id as string;
}

async function clearAll(run: ReturnType<typeof setup>['run'], model: ReturnType<typeof setup>['model']): Promise<void> {
  await run('openboard.element.delete', { ids: model.getDocument().elements.map((e) => e.id) });
}

describe('library integration with components', () => {
  it('saves a master with the masters its instances depend on', async () => {
    const { run, model } = setup();
    const inner = await makeMaster(run, 'Inner');
    const outerRect = (await run('openboard.element.create', { elements: [{ type: 'rectangle', x: 500, y: 0, width: 80, height: 40 }] })).ids;
    const outer = (await run('openboard.component.create', { ids: outerRect, name: 'Outer' })).id as string;
    expect((await run('openboard.component.instance.create', { master: inner, parentId: outer, x: 500, y: 0 })).error).toBeUndefined();

    const saved = await run('openboard.library.save', { name: 'Outer entry', ids: [outer] });
    expect(saved.error).toBeUndefined();
    const entry = model.getDocument().library.find((c) => c.id === saved.id)!;
    const masters = entry.elements.filter((e) => e.type === 'frame' && e.component !== undefined).map((e) => (e as any).component);
    expect(masters.sort()).toEqual(['Inner', 'Outer']);
  });

  it('inserts master clear of content plus an instance, then only an instance', async () => {
    const { run, model, history } = setup();
    const master = await makeMaster(run, 'Btn');
    await run('openboard.library.save', { name: 'Btn entry', ids: [master] });
    const entryId = model.getDocument().library[0]!.id;
    // Remove the local master so the document has none created from the entry.
    await run('openboard.component.remove', { id: master });
    await clearAll(run, model);

    await run('openboard.element.create', { elements: [{ type: 'rectangle', x: 0, y: 0, width: 400, height: 300 }] });
    const before = history.undoCount();
    const first = await run('openboard.library.insert', { component: entryId });
    expect(first.error).toBeUndefined();
    expect(history.undoCount()).toBe(before + 1);
    const els = model.getDocument().elements;
    const masters = els.filter((e) => e.type === 'frame' && e.component !== undefined);
    const instances = els.filter((e) => e.type === 'frame' && e.instanceOf !== undefined && !e.id.includes('::'));
    expect(masters).toHaveLength(1);
    expect(instances).toHaveLength(1);
    expect(masters[0]!.x).toBeGreaterThanOrEqual(400 + 100);

    const second = await run('openboard.library.insert', { component: entryId });
    expect(second.error).toBeUndefined();
    const after = model.getDocument().elements;
    expect(after.filter((e) => e.type === 'frame' && e.component !== undefined)).toHaveLength(1);
    expect(after.filter((e) => e.type === 'frame' && e.instanceOf !== undefined && !e.id.includes('::'))).toHaveLength(2);
  });

  it('later Library edits leave inserted masters unchanged', async () => {
    const { run, model } = setup();
    const master = await makeMaster(run, 'Card');
    await run('openboard.library.save', { name: 'Card entry', ids: [master] });
    const entryId = model.getDocument().library[0]!.id;
    await run('openboard.component.remove', { id: master });
    await clearAll(run, model);
    await run('openboard.library.insert', { component: entryId });
    const snapshot = JSON.stringify(model.getDocument().elements);
    model.transact('edit', (tx) => tx.removeLibraryComponent(entryId));
    expect(JSON.stringify(model.getDocument().elements)).toBe(snapshot);
  });

  it('fails without change or history entry for an inconsistent entry', async () => {
    const { run, model, history } = setup();
    const master = await makeMaster(run, 'Broken');
    await run('openboard.library.save', { name: 'Broken entry', ids: [master] });
    const entryId = model.getDocument().library[0]!.id;
    await run('openboard.component.remove', { id: master });
    await clearAll(run, model);
    // Corrupt the entry: its master references a Token the entry does not contain.
    model.transact('corrupt', (tx) => {
      const entry = tx.doc.library[0]!;
      tx.removeLibraryComponent(entryId);
      const elements = entry.elements.map((e) => ({ ...e, style: { ...e.style, fill: 'token:ghost' } }));
      tx.addLibraryComponent({ ...entry, elements: elements as typeof entry.elements });
    });
    const id = model.getDocument().library[0]!.id;
    const before = JSON.stringify(model.getDocument());
    const undo = history.undoCount();
    const r = await run('openboard.library.insert', { component: id });
    expect(r.error.code).toBe('invalid_library_entry');
    expect(JSON.stringify(model.getDocument())).toBe(before);
    expect(history.undoCount()).toBe(undo);
  });

  it('reports a failed device preset insertion and leaves the document unchanged (Req 24.9)', async () => {
    const { run, model, history } = setup();
    const ins = await run('openboard.library.insert', { component: 'phone' });
    expect(ins.error).toBeUndefined();
    const master = model.getDocument().elements.find((e) => e.type === 'frame' && e.component !== undefined)!.id;
    await run('openboard.library.save', { name: 'Phone copy', ids: [master] });
    await clearAll(run, model);
    model.transact('corrupt', (tx) => {
      const entry = tx.doc.library[0]!;
      tx.removeLibraryComponent(entry.id);
      const elements = entry.elements.map((e) => ({ ...e, style: { ...e.style, fill: 'token:ghost' } }));
      tx.addLibraryComponent({ ...entry, elements: elements as typeof entry.elements });
    });
    const id = model.getDocument().library[0]!.id;
    const before = JSON.stringify(model.getDocument());
    const undo = history.undoCount();
    const r = await run('openboard.library.insert', { component: id });
    expect(r.error.message).toMatch(/^Insertion failed/);
    expect(JSON.stringify(model.getDocument())).toBe(before);
    expect(history.undoCount()).toBe(undo);
    expect(model.getDocument().elements).toHaveLength(0);
  });

  it('inserts plain-element entries as before', async () => {
    const { run, model } = setup();
    const ids = (await run('openboard.element.create', { elements: [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] })).ids;
    const saved = await run('openboard.library.save', { name: 'plain', ids });
    const r = await run('openboard.library.insert', { component: saved.id, x: 300, y: 300 });
    expect(r.ids).toHaveLength(1);
    expect(model.getDocument().elements.some((e) => e.type === 'frame' && e.component !== undefined)).toBe(false);
  });
});
