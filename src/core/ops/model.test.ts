import { describe, expect, it } from 'vitest';
import { BoardModel, SerialQueue, applyPatches, checkInvariants } from './index';
import type { ElementInput, HistoryEntry } from './index';
import type { BoardDocument } from '../model/types';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const rect = (id?: string): ElementInput => ({ ...(id ? { id } : {}), type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style });
const frame = (id: string): ElementInput => ({ id, type: 'frame', name: 'f', x: 0, y: 0, width: 100, height: 100, rotation: 0, style });
const edge = (id: string, s: string, t: string): ElementInput => ({
  id, type: 'edge', sourceId: s, targetId: t, routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow',
  x: 0, y: 0, width: 1, height: 1, rotation: 0, style,
});

function emptyDoc(): BoardDocument {
  return { schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [], assets: [], library: [] };
}

function setup() {
  const entries: HistoryEntry[] = [];
  const model = new BoardModel('/b.openboard', emptyDoc(), { history: { push: (e) => entries.push(e) }, now: () => 'T1' });
  return { model, entries };
}

describe('Tx token surface', () => {
  it('creates, updates, renames, and deletes with exact undo patches', () => {
    const { model, entries } = setup();
    const before = model.getDocument();
    model.transact('tokens', (tx) => {
      tx.createToken('colors', 'brand', '#ff0000');
      tx.createToken('numbers', 'gap', 8);
      tx.updateToken('colors', 'brand', '#00ff00');
      tx.renameToken('colors', 'brand', 'primary');
    });
    expect(model.getDocument().tokens).toEqual({ colors: { primary: '#00ff00' }, numbers: { gap: 8 } });
    model.transact('del', (tx) => {
      tx.deleteToken('colors', 'primary');
      tx.deleteToken('numbers', 'gap');
    });
    expect(model.getDocument().tokens).toBeUndefined();
    const mid = applyPatches(before, entries[0]!.patches);
    expect(applyPatches(mid, entries[0]!.inversePatches)).toEqual(before);
    expect(applyPatches(mid, entries[1]!.patches)).toEqual(model.getDocument());
  });

  it('rejects duplicate names, invalid names, token-reference values, and unknown tokens', () => {
    const { model } = setup();
    model.transact('seed', (tx) => tx.createToken('colors', 'a', '#000000'));
    const before = model.getDocument();
    expect(() => model.transact('x', (tx) => tx.createToken('colors', 'a', '#111111'))).toThrow(/already exists/);
    expect(() => model.transact('x', (tx) => tx.createToken('colors', 'bad name', '#111111'))).toThrow();
    expect(() => model.transact('x', (tx) => tx.createToken('colors', 'b', 'token:a'))).toThrow();
    expect(() => model.transact('x', (tx) => tx.updateToken('colors', 'zzz', '#111111'))).toThrow(/not found/);
    expect(() => model.transact('x', (tx) => tx.renameToken('colors', 'a', 'a b'))).toThrow();
    expect(model.getDocument()).toBe(before);
  });

  it('enforces the per-category limit and the invariant check', () => {
    const { model } = setup();
    model.transact('fill', (tx) => {
      for (let i = 0; i < 500; i++) tx.createToken('numbers', `n${i}`, i);
    });
    expect(() => model.transact('over', (tx) => tx.createToken('numbers', 'extra', 1))).toThrow();
    const bad = { ...emptyDoc(), tokens: { colors: { a: 'token:b' } } } as BoardDocument;
    expect(checkInvariants(bad).length).toBeGreaterThan(0);
  });
});

describe('BoardModel.transact', () => {
  it('pushes exactly one entry whose patches and inverse round-trip', () => {
    const { model, entries } = setup();
    const before = model.getDocument();
    model.transact('add', (tx) => {
      tx.create(rect('a'));
      tx.create(rect('b'));
      tx.setViewport({ x: 5, y: 5, zoom: 2 });
    });
    expect(entries).toHaveLength(1);
    const after = model.getDocument();
    expect(after.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(applyPatches(before, entries[0]!.patches)).toEqual(after);
    expect(applyPatches(after, entries[0]!.inversePatches)).toEqual(before);
  });

  it('rolls back and pushes nothing when fn throws', () => {
    const { model, entries } = setup();
    model.transact('seed', (tx) => void tx.create(rect('a')));
    const before = model.getDocument();
    expect(() =>
      model.transact('bad', (tx) => {
        tx.create(rect('b'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(model.getDocument()).toBe(before);
    expect(entries).toHaveLength(1);
  });

  it('cascades edge removal and inverts it', () => {
    const { model, entries } = setup();
    model.transact('seed', (tx) => {
      tx.create(rect('a'));
      tx.create(rect('b'));
      tx.create(edge('e', 'a', 'b'));
    });
    const before = model.getDocument();
    model.transact('rm', (tx) => tx.remove('a'));
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['b']);
    expect(applyPatches(model.getDocument(), entries[1]!.inversePatches)).toEqual(before);
  });

  it('enforces invariants at commit', () => {
    const { model, entries } = setup();
    expect(() => model.transact('x', (tx) => void tx.create(edge('e', 'nope', 'nope')))).toThrow(/invariant/i);
    expect(() => model.transact('x', (tx) => void tx.create({ ...rect('a'), parentId: 'zzz' }))).toThrow(/invariant/i);
    expect(() =>
      model.transact('x', (tx) => void tx.create({ id: 'i', type: 'image', assetId: 'missing', x: 0, y: 0, width: 1, height: 1, rotation: 0, style })),
    ).toThrow(/invariant/i);
    expect(() =>
      model.transact('x', (tx) => {
        tx.create(rect('a'));
        tx.create(rect('a'));
      }),
    ).toThrow(/already exists/);
    expect(model.getDocument().elements).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it('allows parent frames, detaches children when frame removed, and reorders', () => {
    const { model, entries } = setup();
    model.transact('seed', (tx) => {
      tx.create(frame('f'));
      tx.create({ ...rect('a'), parentId: 'f' });
      tx.create(rect('b'));
    });
    model.transact('reorder', (tx) => tx.reorder(['a'], 'front'));
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['f', 'b', 'a']);
    const before = model.getDocument();
    model.transact('rm', (tx) => tx.remove('f'));
    expect(model.getDocument().elements.find((e) => e.id === 'a')?.parentId).toBeUndefined();
    expect(applyPatches(model.getDocument(), entries[2]!.inversePatches)).toEqual(before);
  });

  it('deleting a frame clears parentId of direct children only, in one undo entry', () => {
    const { model, entries } = setup();
    model.transact('seed', (tx) => {
      tx.create(frame('outer'));
      tx.create({ ...frame('mid'), parentId: 'outer' });
      tx.create({ ...rect('leaf'), parentId: 'mid' });
    });
    const before = model.getDocument();
    const count = entries.length;
    model.transact('rm', (tx) => tx.remove('outer'));
    const els = model.getDocument().elements;
    expect(els.map((e) => e.id)).toEqual(['mid', 'leaf']);
    expect(els.find((e) => e.id === 'mid')?.parentId).toBeUndefined();
    expect(els.find((e) => e.id === 'leaf')?.parentId).toBe('mid');
    expect(entries).toHaveLength(count + 1);
    expect(applyPatches(model.getDocument(), entries[count]!.inversePatches)).toEqual(before);
  });

  it('dedupes assets by hash and validates library names', () => {
    const { model } = setup();
    const a = { mime: 'image/png', hash: 'h', width: 1, height: 1, data: '' } as const;
    model.transact('assets', (tx) => {
      const id1 = tx.addAsset(a);
      expect(tx.addAsset(a)).toBe(id1);
    });
    expect(model.getDocument().assets).toHaveLength(1);
    expect(checkInvariants(model.getDocument())).toEqual([]);
    expect(() => model.transact('lib', (tx) => void tx.addLibraryComponent({ name: '', elements: [rect('x') as never] }))).toThrow();
    expect(model.getDocument().library).toHaveLength(0);
  });

  it('rejects nested transactions and use of a closed tx', () => {
    const { model } = setup();
    expect(() => model.transact('o', () => model.transact('i', () => undefined))).toThrow(/Nested/);
    let leaked: Parameters<Parameters<typeof model.transact>[1]>[0] | undefined;
    model.transact('x', (tx) => void (leaked = tx));
    expect(() => leaked!.create(rect())).toThrow(/closed/);
  });
});

describe('SerialQueue', () => {
  it('runs tasks in arrival order and survives rejections', async () => {
    const q = new SerialQueue();
    const log: number[] = [];
    const p1 = q.run(async () => {
      await new Promise((r) => setTimeout(r, 10));
      log.push(1);
    });
    const p2 = q.run(() => {
      log.push(2);
      throw new Error('x');
    });
    const p3 = q.run(() => void log.push(3));
    await expect(p2).rejects.toThrow('x');
    await Promise.all([p1, p3]);
    expect(log).toEqual([1, 2, 3]);
  });
});

describe('transact runs the Derived_Geometry_Pass', () => {
  const master = (): ElementInput => ({ ...frame('M'), component: 'Card' }) as ElementInput;
  const inst = (id: string, of: string): ElementInput => ({ ...frame(id), x: 300, instanceOf: of }) as ElementInput;

  it('appends derived patches after the edit and restores exactly on undo; apply never re-runs the pass', () => {
    const { model, entries } = setup();
    model.transact('seed', (tx) => {
      tx.create(master());
      tx.create({ ...rect('a'), parentId: 'M' } as ElementInput);
    });
    const before = model.getDocument();
    model.transact('instantiate', (tx) => tx.create(inst('I', 'M')));
    const after = model.getDocument();
    expect(after.elements.map((e) => e.id)).toContain('I::a');
    expect(model.takeLastDerivedIds()).toContain('I::a');
    expect(model.takeLastDerivedIds()).toEqual([]);

    const entry = entries[1]!;
    // Edit patches first, then derived ones.
    expect(entry.patches[0]).toMatchObject({ op: 'add', path: ['elements', 2] });
    expect(applyPatches(before, entry.patches)).toEqual(after);
    expect(applyPatches(after, entry.inversePatches)).toEqual(before);

    // Undo/redo through apply reproduce the states without re-deriving.
    model.apply({ patches: entry.inversePatches });
    expect(model.getDocument()).toEqual(before);
    model.apply({ patches: entry.patches });
    expect(model.getDocument()).toEqual(after);
  });

  it('adds no extra patches when there is nothing to derive', () => {
    const { model, entries } = setup();
    model.transact('add', (tx) => tx.create(rect('a')));
    expect(entries[0]!.patches.map((p) => p.op)).toEqual(['add', 'replace']);
    expect(model.takeLastDerivedIds()).toEqual([]);
  });

  it('aborts the whole transaction on a pass error', () => {
    const { model, entries } = setup();
    model.transact('seed', (tx) => {
      tx.create({ ...frame('A'), component: 'A' } as ElementInput);
      tx.create({ ...frame('B'), component: 'B' } as ElementInput);
    });
    const before = model.getDocument();
    const events: unknown[] = [];
    model.onDidChange((e) => events.push(e));
    expect(() =>
      model.transact('cycle', (tx) => {
        tx.create({ ...inst('iB', 'B'), parentId: 'A' } as ElementInput);
        tx.create({ ...inst('iA', 'A'), parentId: 'B' } as ElementInput);
      }),
    ).toThrow(/Derived geometry failed|cycle/i);
    expect(model.getDocument()).toBe(before);
    expect(entries).toHaveLength(1);
    expect(events).toEqual([]);
  });
});

describe('Instance_Child guard and override capture', () => {
  const seeded = () => {
    const { model, entries } = setup();
    model.transact('seed', (tx) => {
      tx.create({ ...frame('M'), component: 'Card' } as ElementInput);
      tx.create({ ...rect('a'), parentId: 'M' } as ElementInput);
      tx.create({ ...frame('I'), x: 300, instanceOf: 'M' } as ElementInput);
    });
    return { model, entries };
  };
  const get = (m: BoardModel, id: string) => m.getDocument().elements.find((e) => e.id === id) as never as Record<string, any>;

  it('rejects moves, deletes, reparenting and non-overridable edits with a detach message', () => {
    const { model, entries } = seeded();
    const before = model.getDocument();
    for (const fn of [
      (tx: Parameters<Parameters<BoardModel['transact']>[1]>[0]) => tx.update('I::a', { x: 5 }),
      (tx: Parameters<Parameters<BoardModel['transact']>[1]>[0]) => tx.update('I::a', { width: 5 }),
      (tx: Parameters<Parameters<BoardModel['transact']>[1]>[0]) => tx.update('I::a', { parentId: undefined }),
      (tx: Parameters<Parameters<BoardModel['transact']>[1]>[0]) => tx.update('I::a', { style: { strokeWidth: 9 } }),
      (tx: Parameters<Parameters<BoardModel['transact']>[1]>[0]) => tx.remove('I::a'),
    ]) {
      expect(() => model.transact('x', fn)).toThrow(/must be detached/);
    }
    expect(model.getDocument()).toBe(before);
    expect(entries).toHaveLength(1);
  });

  it('turns an overridable edit into an Override in the same undo entry', () => {
    const { model, entries } = seeded();
    model.transact('x', (tx) => tx.update('I::a', { style: { fill: '#ff0000' } }));
    expect(entries).toHaveLength(2);
    expect(get(model, 'I').overrides).toEqual({ a: { fill: '#ff0000' } });
    expect(get(model, 'I::a').style.fill).toBe('#ff0000');
  });

  it('captures an icon `name` edit of an Instance_Child as an icon Override, leaving master and other instances', () => {
    const { model } = setup();
    model.transact('seed', (tx) => {
      tx.create({ ...frame('M'), component: 'Card' } as ElementInput);
      tx.create({ ...rect('a'), type: 'icon', name: 'star', parentId: 'M' } as unknown as ElementInput);
      tx.create({ ...frame('I'), x: 300, instanceOf: 'M' } as ElementInput);
      tx.create({ ...frame('J'), x: 600, instanceOf: 'M' } as ElementInput);
    });
    model.transact('x', (tx) => tx.update('I::a', { name: 'heart' } as never));
    expect(get(model, 'I').overrides).toEqual({ a: { icon: 'heart' } });
    expect(get(model, 'I::a').name).toBe('heart');
    expect(get(model, 'I::a').icon).toBeUndefined();
    expect(get(model, 'a').name).toBe('star');
    expect(get(model, 'J::a').name).toBe('star');
  });

  it('stores an instance root size as an Override under the empty key', () => {
    const { model } = seeded();
    model.transact('x', (tx) => tx.update('I', { width: 40 }));
    expect(get(model, 'I').overrides).toEqual({ '': { width: 40 } });
    expect(get(model, 'I').width).toBe(40);
  });

  it('deleting an instance removes its Instance_Children', () => {
    const { model } = seeded();
    model.transact('x', (tx) => tx.remove('I'));
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['M', 'a']);
  });

  it('reports a frame that is both master and instance', () => {
    const doc = emptyDoc();
    doc.elements.push({ ...frame('F'), component: 'C', instanceOf: 'X' } as never);
    expect(checkInvariants(doc).join()).toMatch(/both a Component_Master and a Component_Instance/);
  });
});
