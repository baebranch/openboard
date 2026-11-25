import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { autoLayout, LAYOUT_DIRECTIONS, type LayoutEdge, type LayoutNode } from '../../src/core/layout';
import { BoardModel, UndoHistory } from '../../src/core/ops';
import type { BoardDocument } from '../../src/core/model/types';

// Feature: openboard, Property 50: Auto layout
// **Validates: Requirements 8.8, 8.9, 8.10**

const NUM_RUNS = 100;
const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;

const nodesArb = (min: number, max: number) =>
  fc.integer({ min, max }).chain((n) =>
    fc.tuple(
      ...Array.from({ length: n }, (_, i) =>
        fc.record({
          id: fc.constant(`n${i}`),
          x: fc.integer({ min: -500, max: 500 }),
          y: fc.integer({ min: -500, max: 500 }),
          width: fc.integer({ min: 10, max: 200 }),
          height: fc.integer({ min: 10, max: 200 }),
        }),
      ),
    ),
  ) as fc.Arbitrary<LayoutNode[]>;

const edgesArb = (n: number, acyclic: boolean) =>
  fc
    .array(fc.tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 })), { maxLength: 12 })
    .map((pairs) =>
      pairs
        .filter(([s, t]) => s !== t)
        .map(([s, t]): LayoutEdge => {
          const [a, b] = acyclic && s > t ? [t, s] : [s, t];
          return { sourceId: `n${a}`, targetId: `n${b}` };
        }),
    );

const scenarioArb = (acyclic: boolean) =>
  nodesArb(2, 8).chain((nodes) =>
    fc.record({
      nodes: fc.constant(nodes),
      edges: edgesArb(nodes.length, acyclic),
      direction: fc.constantFrom(...LAYOUT_DIRECTIONS),
    }),
  );

const center = (n: LayoutNode, p: { x: number; y: number }) => ({ x: p.x + n.width / 2, y: p.y + n.height / 2 });

/** Does `from` reach `to` following edges? */
function reaches(edges: readonly LayoutEdge[], from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const v = stack.pop()!;
    for (const e of edges) {
      if (e.sourceId !== v || seen.has(e.targetId)) continue;
      if (e.targetId === to) return true;
      seen.add(e.targetId);
      stack.push(e.targetId);
    }
  }
  return false;
}

function checkDirection(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  direction: (typeof LAYOUT_DIRECTIONS)[number],
  pos: Map<string, { x: number; y: number }>,
  onlyAcyclic: boolean,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const axis = direction === 'TB' || direction === 'BT' ? 'y' : 'x';
  const sign = direction === 'TB' || direction === 'LR' ? 1 : -1;
  for (const e of edges) {
    const s = byId.get(e.sourceId)!;
    const t = byId.get(e.targetId)!;
    const delta = (center(t, pos.get(t.id)!)[axis] - center(s, pos.get(s.id)!)[axis]) * sign;
    if (delta > 0) continue;
    // A mis-pointing edge must close a cycle (target reaches source).
    expect(onlyAcyclic).toBe(false);
    expect(reaches(edges, e.targetId, e.sourceId)).toBe(true);
  }
}

describe('Feature: openboard, Property 50: Auto layout', () => {
  it('produces no overlapping node bounds', () => {
    fc.assert(
      fc.property(scenarioArb(false), ({ nodes, edges, direction }) => {
        const r = autoLayout(nodes, edges, direction);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i]!;
            const b = nodes[j]!;
            const pa = r.value.get(a.id)!;
            const pb = r.value.get(b.id)!;
            const overlap = pa.x < pb.x + b.width && pb.x < pa.x + a.width && pa.y < pb.y + b.height && pb.y < pa.y + a.height;
            expect(overlap).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('points every edge in the chosen direction for acyclic graphs', () => {
    fc.assert(
      fc.property(scenarioArb(true), ({ nodes, edges, direction }) => {
        const r = autoLayout(nodes, edges, direction);
        expect(r.ok).toBe(true);
        if (r.ok) checkDirection(nodes, edges, direction, r.value, true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('points every non-cycle-closing edge in the chosen direction for arbitrary graphs', () => {
    fc.assert(
      fc.property(scenarioArb(false), ({ nodes, edges, direction }) => {
        const r = autoLayout(nodes, edges, direction);
        expect(r.ok).toBe(true);
        if (r.ok) checkDirection(nodes, edges, direction, r.value, false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns an error and leaves positions unchanged with fewer than two nodes', () => {
    fc.assert(
      fc.property(nodesArb(0, 1), fc.constantFrom(...LAYOUT_DIRECTIONS), (nodes, direction) => {
        const before = JSON.stringify(nodes);
        const r = autoLayout(nodes, [], direction);
        expect(r.ok).toBe(false);
        expect(JSON.stringify(nodes)).toBe(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is restored in full by a single undo after one transaction', () => {
    fc.assert(
      fc.property(scenarioArb(false), ({ nodes, edges, direction }) => {
        const doc: BoardDocument = {
          schemaVersion: 1,
          meta: { id: 'b' },
          viewport: { x: 0, y: 0, zoom: 1 },
          elements: [],
          assets: [],
          library: [],
        } as unknown as BoardDocument;
        const history = new UndoHistory();
        const model = new BoardModel('/b.openboard', doc, { history, now: () => 'T' });
        model.transact('setup', (tx) => {
          for (const n of nodes) {
            tx.create({ id: n.id, type: 'rectangle', x: n.x, y: n.y, width: n.width, height: n.height, rotation: 0, style });
          }
        });
        const positions = () => model.getDocument().elements.map((e) => [e.id, e.x, e.y]);
        const before = positions();
        const r = autoLayout(nodes, edges, direction);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const undoCount = history.undoCount();
        model.transact('auto layout', (tx) => {
          for (const [id, p] of r.value) tx.update(id, { x: p.x, y: p.y });
        });
        expect(history.undoCount()).toBe(undoCount + 1);
        expect(history.undo(model)).toBe(true);
        expect(positions()).toEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
