import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { syncPass } from './sync';

/**
 * Feature: mockup-design-features, Property 21: Sync_Pass model-based correctness
 * **Validates: Requirements 14.2, 14.3, 15.2, 15.3, 15.5, 15.14**
 */

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const rect = (id: string, extra: Record<string, unknown>): Element =>
  ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style, ...extra }) as Element;
const frame = (id: string, extra: Record<string, unknown>): Element =>
  ({ id, type: 'frame', name: id, x: 0, y: 0, width: 100, height: 50, rotation: 0, style, ...extra }) as Element;
const edge = (id: string, sourceId: string, targetId: string): Element =>
  ({ id, type: 'edge', x: 0, y: 0, width: 0, height: 0, rotation: 0, style, sourceId, targetId, routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow' }) as Element;
const mkDoc = (elements: Element[]): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
});

interface Scenario {
  master: Element;
  descendants: Element[];
  instances: Element[];
  users: Element[];
}

const coord = fc.integer({ min: -500, max: 500 });
const color = fc.constantFrom('#ff0000', '#00ff00', '#0000ff', 'theme:accent');

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    mx: coord,
    my: coord,
    // each child's parent: index into earlier children, or -1 for the master
    shape: fc.array(fc.record({ parent: fc.integer({ min: -1, max: 20 }), x: coord, y: coord }), { minLength: 1, maxLength: 8 }),
    edgePairs: fc.array(fc.tuple(fc.nat(20), fc.nat(20)), { maxLength: 3 }),
    insts: fc.array(
      fc.record({
        x: coord,
        y: coord,
        ov: fc.array(
          fc.record({
            target: fc.nat(20),
            fill: fc.option(color, { nil: undefined }),
            stroke: fc.option(color, { nil: undefined }),
            opacity: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
          }),
          { maxLength: 4 },
        ),
        users: fc.integer({ min: 0, max: 2 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })
  .map(({ mx, my, shape, edgePairs, insts }) => {
    const master = frame('M', { component: 'Card', x: mx, y: my });
    const kids: Element[] = shape.map((s, i) => {
      const parent = s.parent < 0 || s.parent >= i ? 'M' : `c${s.parent}`;
      return rect(`c${i}`, { parentId: parent, x: s.x, y: s.y });
    });
    const n = kids.length;
    const edges = edgePairs
      .filter(([a, b]) => a % n !== b % n)
      .map(([a, b], i) => edge(`e${i}`, `c${a % n}`, `c${b % n}`));
    const descendants = [...kids, ...edges];
    const instances: Element[] = [];
    const users: Element[] = [];
    insts.forEach((s, k) => {
      const overrides: Record<string, Record<string, unknown>> = {};
      for (const o of s.ov) {
        const key = `c${o.target % n}`;
        const v: Record<string, unknown> = {};
        if (o.fill !== undefined) v.fill = o.fill;
        if (o.stroke !== undefined) v.stroke = o.stroke;
        if (o.opacity !== undefined) v.opacity = o.opacity;
        overrides[key] = v;
      }
      const id = `I${k}`;
      instances.push(frame(id, { instanceOf: 'M', x: s.x, y: s.y, overrides }));
      for (let u = 0; u < s.users; u++) users.push(rect(`${id}u${u}`, { parentId: id, x: u * 3 + 1 }));
    });
    return { master, descendants, instances, users };
  });

/** Reference expand: ids, parents, offsets, overrides and edge remapping straight from the master. */
function expand(sc: Scenario, inst: Element, current: Element[]): Element[] {
  const f = inst as Element & { overrides?: Record<string, { fill?: string; stroke?: string; opacity?: number }> };
  const dx = inst.x - sc.master.x;
  const dy = inst.y - sc.master.y;
  const map = (id: string): string => (id === 'M' ? inst.id : `${inst.id}::${id}`);
  return current.map((d) => {
    const o = f.overrides?.[d.id] ?? {};
    const s = { ...d.style, ...(o.fill !== undefined && { fill: o.fill }), ...(o.stroke !== undefined && { stroke: o.stroke }), ...(o.opacity !== undefined && { opacity: o.opacity }) };
    const out: Record<string, unknown> = { ...d, id: map(d.id), x: d.x + dx, y: d.y + dy, style: s };
    if (d.parentId !== undefined) out.parentId = map(d.parentId);
    if (d.type === 'edge') {
      out.sourceId = map(d.sourceId);
      out.targetId = map(d.targetId);
    }
    return out as unknown as Element;
  });
}

const norm = (e: Element): unknown => JSON.parse(JSON.stringify(e));

function check(sc: Scenario, masterKids: Element[], elements: Element[], result: BoardDocument): void {
  for (const inst of sc.instances) {
    const expected = expand(sc, inst, masterKids);
    const actual = result.elements.filter((e) => e.id.startsWith(`${inst.id}::`));
    expect(actual.map(norm)).toEqual(expected.map(norm));
  }
  // User_Children are untouched (same references, same relative order).
  const userIn = elements.filter((e) => sc.users.includes(e));
  const userOut = result.elements.filter((e) => sc.users.some((u) => u.id === e.id));
  expect(userOut.length).toBe(userIn.length);
  userOut.forEach((e, i) => expect(e).toBe(userIn[i]));
}

describe('Property 21: Sync_Pass model-based correctness', () => {
  it('matches the reference expansion, including after the master changes', () => {
    fc.assert(
      fc.property(scenario, color, (sc, newFill) => {
        const elements = [sc.master, ...sc.descendants, ...sc.instances, ...sc.users];
        const first = syncPass(mkDoc(elements));
        check(sc, sc.descendants, elements, first.doc);

        // Edit the master's first child, then re-sync an already expanded document.
        const edited = sc.descendants.map((d, i) =>
          i === 0 ? ({ ...d, style: { ...d.style, fill: newFill } } as Element) : d,
        );
        const next = first.doc.elements.map((e) => edited.find((d) => d.id === e.id) ?? e);
        const second = syncPass(mkDoc(next));
        check(sc, edited, next, second.doc);
      }),
      { numRuns: 100 },
    );
  });
});
