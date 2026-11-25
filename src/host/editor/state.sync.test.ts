import { describe, expect, it } from 'vitest';
import { serialize } from '../../core/format/serializer';
import type { BoardDocument, Element } from '../../core/model/types';
import { syncPass } from '../../core/components/sync';
import { BoardDocumentState, syncOnLoad } from './state';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { x: 0, y: 0, width: 10, height: 10, rotation: 0, style };
const rect = (id: string, extra: Record<string, unknown> = {}): Element => ({ id, type: 'rectangle', ...base, ...extra }) as Element;
const frame = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name: id, ...base, width: 100, height: 50, ...extra }) as Element;
const doc = (elements: Element[]): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
});
const open = (d: BoardDocument) => new BoardDocumentState('mem', { ok: true, doc: d, readOnly: false });

const master = frame('M', { component: 'Card' });
const kid = rect('a', { parentId: 'M', x: 5, y: 5 });

describe('sync on load', () => {
  it('syncs a missing Instance_Child and reports the document modified', () => {
    const s = open(doc([master, kid, frame('I', { instanceOf: 'M' })]));
    expect(s.syncedOnLoad).toBe(true);
    expect(s.getDocument()!.elements.map((e) => e.id)).toContain('I::a');
  });

  it('syncs an extra Instance_Child', () => {
    const synced = syncPass(doc([master, kid, frame('I', { instanceOf: 'M' })])).doc;
    const extra = doc([...synced.elements, rect('I::gone', { parentId: 'I' })]);
    const s = open(extra);
    expect(s.syncedOnLoad).toBe(true);
    expect(s.getDocument()!.elements.map((e) => e.id)).not.toContain('I::gone');
  });

  it('syncs a differing Instance_Child property', () => {
    const synced = syncPass(doc([master, kid, frame('I', { instanceOf: 'M' })])).doc;
    const drifted = doc(synced.elements.map((e) => (e.id === 'I::a' ? ({ ...e, width: 77 } as Element) : e)));
    const s = open(drifted);
    expect(s.syncedOnLoad).toBe(true);
    expect((s.getDocument()!.elements.find((e) => e.id === 'I::a') as Element).width).toBe(10);
  });

  it('leaves an in-sync document unmodified and byte-identical', () => {
    const synced = syncPass(doc([master, kid, frame('I', { instanceOf: 'M' })])).doc;
    const before = serialize(synced);
    const s = open(synced);
    expect(s.syncedOnLoad).toBe(false);
    expect(s.loadSyncError).toBeUndefined();
    expect(s.getDocument()).toBe(synced);
    expect(new TextDecoder().decode(s.toBytes())).toBe(before);
  });

  it('leaves a document with no instances untouched', () => {
    const d = doc([rect('r')]);
    expect(syncOnLoad(d)).toEqual({ doc: d, modified: false });
  });

  it('opens a cycle unsynced with an error naming every master', () => {
    const d = doc([
      frame('M1', { component: 'A' }),
      frame('M2', { component: 'B' }),
      frame('i1', { parentId: 'M1', instanceOf: 'M2' }),
      frame('i2', { parentId: 'M2', instanceOf: 'M1' }),
    ]);
    const s = open(d);
    expect(s.syncedOnLoad).toBe(false);
    expect(s.getDocument()).toBe(d);
    expect(s.loadSyncError?.reason).toBe('component-cycle');
    expect([...s.loadSyncError!.masterIds].sort()).toEqual(['M1', 'M2']);
    expect(s.loadSyncError!.message).toContain('M1');
    expect(s.loadSyncError!.message).toContain('M2');
  });

  it('does not sync read-only documents', () => {
    const d = doc([master, kid, frame('I', { instanceOf: 'M' })]);
    const s = new BoardDocumentState('mem', { ok: true, doc: d, readOnly: true });
    expect(s.syncedOnLoad).toBe(false);
    expect(s.getDocument()).toBe(d);
  });
});
