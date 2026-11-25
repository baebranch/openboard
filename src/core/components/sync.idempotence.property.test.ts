import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { ComponentCycleError, ComponentDepthError, syncPass } from './sync';

/**
 * Feature: mockup-design-features, Property 22: Sync_Pass idempotence
 * **Validates: Requirements 15.6, 28.3**
 */

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { rotation: 0, style };
const rect = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'rectangle', x, y, width: 10, height: 10, ...base, ...extra }) as Element;
const frame = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name: id, x, y, width: 100, height: 50, ...base, ...extra }) as Element;
const edge = (id: string, sourceId: string, targetId: string): Element =>
  ({ id, type: 'edge', x: 0, y: 0, width: 0, height: 0, ...base, sourceId, targetId, routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow' }) as Element;

const coord = fc.integer({ min: -200, max: 200 });
const overrideArb = fc.record(
  {
    fill: fc.constantFrom('#ff0000', '#00ff00', '#123456'),
    opacity: fc.integer({ min: 0, max: 100 }),
    width: fc.integer({ min: 1, max: 400 }),
  },
  { requiredKeys: [] },
);

interface MasterSpec {
  x: number;
  y: number;
  kids: { x: number; y: number; nestUnder: number | null }[]; // nestUnder: index of earlier kid
  edges: [number, number][];
  nested: { x: number; y: number; of: number }[]; // instances of lower masters
}
interface InstSpec {
  of: number; // may be out of range => unknown master (ordinary frame)
  x: number;
  y: number;
  overrideKid: number;
  override: Record<string, unknown>;
  rootOverride: Record<string, unknown> | null;
  userChild: boolean;
}

const masterSpec = fc.record({
  x: coord,
  y: coord,
  kids: fc.array(fc.record({ x: coord, y: coord, nestUnder: fc.option(fc.nat(5), { nil: null }) }), { maxLength: 4 }),
  edges: fc.array(fc.tuple(fc.nat(5), fc.nat(5)), { maxLength: 2 }),
  nested: fc.array(fc.record({ x: coord, y: coord, of: fc.nat(5) }), { maxLength: 2 }),
});
const instSpec = fc.record({
  of: fc.nat(6),
  x: coord,
  y: coord,
  overrideKid: fc.nat(5),
  override: overrideArb,
  rootOverride: fc.option(fc.record({ width: fc.integer({ min: 1, max: 400 }) }), { nil: null }),
  userChild: fc.boolean(),
});

function build(masters: MasterSpec[], insts: InstSpec[]): BoardDocument {
  const els: Element[] = [];
  masters.forEach((m, mi) => {
    const mid = `M${mi}`;
    els.push(frame(mid, m.x, m.y, { component: `C${mi}` }));
    const kidIds: string[] = [];
    m.kids.forEach((k, ki) => {
      const parent = k.nestUnder !== null && k.nestUnder < ki ? kidIds[k.nestUnder]! : mid;
      const id = `${mid}k${ki}`;
      kidIds.push(id);
      els.push(rect(id, k.x, k.y, { parentId: parent }));
    });
    m.edges.forEach(([s, t], ei) => {
      if (s < kidIds.length && t < kidIds.length) els.push(edge(`${mid}e${ei}`, kidIds[s]!, kidIds[t]!));
    });
    m.nested.forEach((n, ni) => {
      if (mi === 0) return;
      els.push(frame(`${mid}n${ni}`, n.x, n.y, { parentId: mid, instanceOf: `M${n.of % mi}` }));
    });
  });
  insts.forEach((i, ii) => {
    const id = `I${ii}`;
    const target = `M${i.of}`;
    const overrides: Record<string, unknown> = { [`${target}k${i.overrideKid}`]: i.override };
    if (i.rootOverride) overrides[''] = i.rootOverride;
    els.push(frame(id, i.x, i.y, { instanceOf: target, overrides }));
    if (i.userChild) els.push(rect(`${id}u`, 1, 2, { parentId: id }));
  });
  return { schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: els, assets: [], library: [] } as BoardDocument;
}

describe('Property 22: Sync_Pass idempotence', () => {
  it('syncPass(syncPass(doc)) deep-equals syncPass(doc)', () => {
    fc.assert(
      fc.property(
        fc.array(masterSpec, { minLength: 1, maxLength: 4 }),
        fc.array(instSpec, { minLength: 1, maxLength: 4 }),
        (masters, insts) => {
          const d = build(masters, insts);
          const once = syncPass(d).doc;
          const twice = syncPass(once);
          expect(twice.doc).toEqual(once);
          expect(twice.changedIds).toEqual([]);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('is idempotent after a master edit on an already-synced document', () => {
    fc.assert(
      fc.property(
        fc.array(masterSpec, { minLength: 1, maxLength: 3 }),
        fc.array(instSpec, { minLength: 1, maxLength: 3 }),
        coord,
        (masters, insts, dx) => {
          const synced = syncPass(build(masters, insts)).doc;
          const edited: BoardDocument = {
            ...synced,
            elements: synced.elements.map((e) => (e.id === 'M0' ? { ...e, x: e.x + dx } : e)),
          };
          const once = syncPass(edited).doc;
          expect(syncPass(once).doc).toEqual(once);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('throws consistently on a component cycle instead of returning a non-idempotent result', () => {
    const d: BoardDocument = {
      schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, assets: [], library: [],
      elements: [
        frame('A', 0, 0, { component: 'A' }),
        frame('ai', 0, 0, { parentId: 'A', instanceOf: 'B' }),
        frame('B', 0, 0, { component: 'B' }),
        frame('bi', 0, 0, { parentId: 'B', instanceOf: 'A' }),
      ],
    } as BoardDocument;
    expect(() => syncPass(d)).toThrow(ComponentCycleError);
    expect(ComponentDepthError).toBeDefined();
  });
});
