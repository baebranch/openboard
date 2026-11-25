import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../src/core/model/types';
import { needsDerivedPass, runDerivedGeometryPass } from '../src/core/ops/derived-geometry';
import { buildFullRegistry } from './helpers/registry';

// Task 17.3 / Requirement 19.11: a drop into a Layout_Frame (move + reorder + reflow)
// is one Undo_History entry, through the real tool registry, and undo restores exactly.
const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { x: 0, y: 0, width: 20, height: 20, rotation: 0, style };
const rect = (id: string, extra: Record<string, unknown> = {}): Element => ({ id, type: 'rectangle', ...base, ...extra }) as Element;
const layout = { direction: 'horizontal', gap: 10, padding: { top: 5, right: 5, bottom: 5, left: 5 }, mainAlign: 'start', crossAlign: 'start' };
const frame: Element = { id: 'f', type: 'frame', name: 'f', ...base, x: 100, y: 100, width: 300, height: 60, layout } as unknown as Element;
const doc = (elements: Element[]): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
});

describe('derived pass on documents without instances or layouts (Req 18)', () => {
  it('needs no pass and yields zero patches', () => {
    for (const d of [doc([]), doc([rect('a'), { ...frame, layout: undefined } as Element])]) {
      expect(needsDerivedPass(d)).toBe(false);
      expect(runDerivedGeometryPass(d).patches).toEqual([]);
    }
  });
});

describe('drop into a Layout_Frame through the tool registry', () => {
  it('moves, reorders, and reflows as one undo entry with exact undo', async () => {
    const env = buildFullRegistry({
      doc: doc([frame, rect('a', { parentId: 'f', x: 105, y: 105 }), rect('b', { parentId: 'f', x: 135, y: 105 }), rect('c', { x: 0, y: 300 })]),
    });
    const before = JSON.stringify(env.model.getDocument());
    const undoBefore = env.history.undoCount();

    const res = (await env.registry.invoke('openboard.element.update', { ids: ['c'], set: { parentId: 'f', x: 120, y: 110 } })) as { error?: unknown };
    expect(res.error).toBeUndefined();
    expect(env.history.undoCount()).toBe(undoBefore + 1);

    const after = env.model.getDocument();
    const byId = new Map(after.elements.map((e) => [e.id, e]));
    expect(byId.get('c')?.parentId).toBe('f');
    // Reflowed: every child sits at its computed slot (padding 5 + gap 10, width 20).
    const xs = ['a', 'b', 'c'].map((id) => byId.get(id)!.x);
    expect(new Set(xs).size).toBe(3);
    for (const id of ['a', 'b', 'c']) expect(byId.get(id)!.y).toBe(105);
    const sorted = [...xs].sort((p, q) => p - q);
    expect(sorted).toEqual([105, 135, 165]);

    expect(env.history.undo(env.model)).toBe(true);
    expect(JSON.stringify(env.model.getDocument())).toBe(before);
    expect(env.history.undoCount()).toBe(undoBefore);
  });
});
