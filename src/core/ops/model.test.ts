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
