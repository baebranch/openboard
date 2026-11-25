import { describe, expect, it } from 'vitest';
import { buildFullRegistry } from '../../../test/helpers/registry';

/** Unit tests for Library integration of component masters (Req 16.1, 16.2, 16.3, 16.13, 16.14). */

function setup() {
  const f = buildFullRegistry({ spy: false });
  const run = (name: string, input: unknown = {}) => f.registry.invoke(name, input) as Promise<any>;
  return { ...f, run };
}
type S = ReturnType<typeof setup>;

async function makeMaster(s: S, name: string, style?: Record<string, unknown>, x = 0): Promise<string> {
  const r = await s.run('openboard.element.create', {
    elements: [{ type: 'rectangle', x, y: 0, width: 100, height: 50, ...(style ? { style } : {}) }],
  });
  expect(r.error).toBeUndefined();
  const m = await s.run('openboard.component.create', { ids: r.ids, name });
  expect(m.error).toBeUndefined();
  return m.id as string;
}

/** Saves the master as a Library entry, then clears the document so insertion starts from scratch. */
async function saveAndClear(s: S, master: string, name: string): Promise<string> {
  const saved = await s.run('openboard.library.save', { name, ids: [master] });
  expect(saved.error).toBeUndefined();
  await s.run('openboard.element.delete', { ids: s.model.getDocument().elements.map((e) => e.id) });
  return saved.id as string;
}

const masters = (s: S) => s.model.getDocument().elements.filter((e) => e.type === 'frame' && e.component !== undefined);
const instances = (s: S) =>
  s.model.getDocument().elements.filter((e) => e.type === 'frame' && e.instanceOf !== undefined && !e.id.includes('::'));

describe('Library integration: first and repeat insert', () => {
  it('first insert into an empty board creates one master and one instance in one history entry', async () => {
    const s = setup();
    const master = await makeMaster(s, 'Btn');
    const entry = await saveAndClear(s, master, 'Btn entry');
    await s.run('openboard.component.remove', { id: master }).catch(() => undefined);
    const before = s.history.undoCount();
    const r = await s.run('openboard.library.insert', { component: entry });
    expect(r.error).toBeUndefined();
    expect(s.history.undoCount()).toBe(before + 1);
    expect(masters(s)).toHaveLength(1);
    expect(instances(s)).toHaveLength(1);
    expect((instances(s)[0] as any).instanceOf).toBe(masters(s)[0]!.id);
  });

  it('places the instance center at the viewport center', async () => {
    const s = setup();
    const master = await makeMaster(s, 'Btn');
    const entry = await saveAndClear(s, master, 'Btn entry');
    s.model.transact('viewport', (tx) => tx.setViewport({ x: -200, y: -100, zoom: 2 }));
    const r = await s.run('openboard.library.insert', { component: entry });
    expect(r.error).toBeUndefined();
    const inst = instances(s)[0]!;
    // Moving the viewport moves where the next instance lands, by (dx / zoom).
    s.model.transact('viewport', (tx) => tx.setViewport({ x: -200, y: -100, zoom: 1 }));
    await s.run('openboard.library.insert', { component: entry });
    const [a, b] = instances(s);
    expect(a!.id).toBe(inst.id);
    // Same center formula: x = (W/2 - view.x)/zoom - w/2; zoom 2 -> zoom 1 with same view.x changes x.
    expect(b!.x).not.toBe(a!.x);
  });

  it('repeat insert adds only an instance, one history entry each, without another master', async () => {
    const s = setup();
    const master = await makeMaster(s, 'Btn');
    const entry = await saveAndClear(s, master, 'Btn entry');
    await s.run('openboard.library.insert', { component: entry });
    const masterCount = masters(s).length;
    const before = s.history.undoCount();
    const r = await s.run('openboard.library.insert', { component: entry });
    expect(r.error).toBeUndefined();
    expect(r.ids).toHaveLength(1);
    expect(s.history.undoCount()).toBe(before + 1);
    expect(masters(s)).toHaveLength(masterCount);
    expect(instances(s)).toHaveLength(2);
  });

  it('undo of the first insert removes the master and the instance together', async () => {
    const s = setup();
    const master = await makeMaster(s, 'Btn');
    const entry = await saveAndClear(s, master, 'Btn entry');
    await s.run('openboard.library.insert', { component: entry });
    s.history.undo(s.model);
    expect(masters(s)).toHaveLength(0);
    expect(instances(s)).toHaveLength(0);
  });
});

describe('Library integration: nested master dependencies', () => {
  async function nested(s: S) {
    const inner = await makeMaster(s, 'Inner');
    const outerRect = (await s.run('openboard.element.create', { elements: [{ type: 'rectangle', x: 500, y: 0, width: 80, height: 40 }] })).ids;
    const outer = (await s.run('openboard.component.create', { ids: outerRect, name: 'Outer' })).id as string;
    const made = await s.run('openboard.component.instance.create', { master: inner, parentId: outer, x: 500, y: 0 });
    expect(made.error).toBeUndefined();
    return { inner, outer };
  }

  it('inserting the outer entry creates both masters and a single outer instance', async () => {
    const s = setup();
    const { outer } = await nested(s);
    const entry = await saveAndClear(s, outer, 'Outer entry');
    const r = await s.run('openboard.library.insert', { component: entry });
    expect(r.error).toBeUndefined();
    expect(masters(s).map((m) => (m as any).component).sort()).toEqual(['Inner', 'Outer']);
    const outerMaster = masters(s).find((m) => (m as any).component === 'Outer')!;
    expect(instances(s).filter((i) => (i as any).instanceOf === outerMaster.id)).toHaveLength(1);
    // The nested instance sits inside the outer master and points at the inner master.
    const innerMaster = masters(s).find((m) => (m as any).component === 'Inner')!;
    const nestedInst = s.model
      .getDocument()
      .elements.find((e) => e.type === 'frame' && e.instanceOf === innerMaster.id && e.parentId === outerMaster.id);
    expect(nestedInst).toBeDefined();
  });

  it('the saved entry holds the inner master and the outer master, and nothing else is required', async () => {
    const s = setup();
    const { outer } = await nested(s);
    const saved = await s.run('openboard.library.save', { name: 'Both', ids: [outer] });
    const entry = s.model.getDocument().library.find((c) => c.id === saved.id)!;
    const names = entry.elements.filter((e) => e.type === 'frame' && e.component !== undefined).map((e) => (e as any).component);
    expect(names.sort()).toEqual(['Inner', 'Outer']);
  });

  it('a second insert reuses the masters', async () => {
    const s = setup();
    const { outer } = await nested(s);
    const entry = await saveAndClear(s, outer, 'Outer entry');
    await s.run('openboard.library.insert', { component: entry });
    await s.run('openboard.library.insert', { component: entry });
    expect(masters(s)).toHaveLength(2);
  });
});

describe('Library integration: token carry-over', () => {
  async function tokenMaster(s: S) {
    const c = await s.run('openboard.token.create', { category: 'colors', name: 'brand', value: '#112233' });
    expect(c.error).toBeUndefined();
    const master = await makeMaster(s, 'Tok', { fill: 'token:brand' });
    return master;
  }

  it('save records the referenced tokens only', async () => {
    const s = setup();
    await s.run('openboard.token.create', { category: 'colors', name: 'unused', value: '#000000' });
    const master = await tokenMaster(s);
    const saved = await s.run('openboard.library.save', { name: 'Tok entry', ids: [master] });
    const entry = s.model.getDocument().library.find((c) => c.id === saved.id)!;
    expect(entry.tokens?.colors).toEqual({ brand: '#112233' });
  });

  it('insert re-creates a missing token in the same history entry', async () => {
    const s = setup();
    const master = await tokenMaster(s);
    const entry = await saveAndClear(s, master, 'Tok entry');
    s.model.transact('drop token', (tx) => tx.deleteToken('colors', 'brand'));
    expect(s.model.getDocument().tokens?.colors?.brand).toBeUndefined();
    const before = s.history.undoCount();
    const r = await s.run('openboard.library.insert', { component: entry });
    expect(r.error).toBeUndefined();
    expect(s.model.getDocument().tokens?.colors?.brand).toBe('#112233');
    expect(s.history.undoCount()).toBe(before + 1);
    s.history.undo(s.model);
    expect(s.model.getDocument().tokens?.colors?.brand).toBeUndefined();
  });

  it('insert keeps the value of a token the board already has', async () => {
    const s = setup();
    const master = await tokenMaster(s);
    const entry = await saveAndClear(s, master, 'Tok entry');
    s.model.transact('change', (tx) => tx.updateToken('colors', 'brand', '#abcdef'));
    const r = await s.run('openboard.library.insert', { component: entry });
    expect(r.error).toBeUndefined();
    expect(s.model.getDocument().tokens?.colors?.brand).toBe('#abcdef');
  });
});

describe('Library integration: failures leave no partial state', () => {
  it('insert of an unknown entry fails with no change and no history entry', async () => {
    const s = setup();
    await makeMaster(s, 'Btn');
    const doc = JSON.stringify(s.model.getDocument());
    const undo = s.history.undoCount();
    const r = await s.run('openboard.library.insert', { component: 'does-not-exist' });
    expect(r.error).toBeDefined();
    expect(JSON.stringify(s.model.getDocument())).toBe(doc);
    expect(s.history.undoCount()).toBe(undo);
  });

  it('insert of an entry whose instance references a master it lacks fails cleanly', async () => {
    const s = setup();
    const inner = await makeMaster(s, 'Inner');
    const outerRect = (await s.run('openboard.element.create', { elements: [{ type: 'rectangle', x: 500, y: 0, width: 80, height: 40 }] })).ids;
    const outer = (await s.run('openboard.component.create', { ids: outerRect, name: 'Outer' })).id as string;
    await s.run('openboard.component.instance.create', { master: inner, parentId: outer, x: 500, y: 0 });
    const saved = await s.run('openboard.library.save', { name: 'Outer entry', ids: [outer] });
    await s.run('openboard.element.delete', { ids: s.model.getDocument().elements.map((e) => e.id) });
    // Strip the inner master from the entry.
    s.model.transact('corrupt', (tx) => {
      const entry = tx.doc.library.find((c) => c.id === saved.id)!;
      const innerMaster = entry.elements.find((e) => e.type === 'frame' && e.component === 'Inner')!;
      tx.removeLibraryComponent(saved.id);
      const kept = entry.elements.filter((e) => e.id !== innerMaster.id && e.parentId !== innerMaster.id);
      tx.addLibraryComponent({ ...entry, elements: kept });
    });
    const id = s.model.getDocument().library[0]!.id;
    const doc = JSON.stringify(s.model.getDocument());
    const undo = s.history.undoCount();
    const r = await s.run('openboard.library.insert', { component: id });
    expect(r.error.code).toBe('invalid_library_entry');
    expect(JSON.stringify(s.model.getDocument())).toBe(doc);
    expect(s.history.undoCount()).toBe(undo);
  });

  it('save with an unknown element id leaves the Library and document unchanged', async () => {
    const s = setup();
    const master = await makeMaster(s, 'Btn');
    const doc = JSON.stringify(s.model.getDocument());
    const undo = s.history.undoCount();
    const r = await s.run('openboard.library.save', { name: 'x', ids: [master, 'nope'] });
    expect(r.error).toBeDefined();
    expect(s.model.getDocument().library).toHaveLength(0);
    expect(JSON.stringify(s.model.getDocument())).toBe(doc);
    expect(s.history.undoCount()).toBe(undo);
  });

  it('save with an invalid name adds no partial entry', async () => {
    const s = setup();
    const master = await makeMaster(s, 'Btn');
    const doc = JSON.stringify(s.model.getDocument());
    const undo = s.history.undoCount();
    const r = await s.run('openboard.library.save', { name: '', ids: [master] });
    expect(r.error).toBeDefined();
    expect(s.model.getDocument().library).toHaveLength(0);
    expect(JSON.stringify(s.model.getDocument())).toBe(doc);
    expect(s.history.undoCount()).toBe(undo);
  });
});
