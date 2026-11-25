import fc from 'fast-check';
import { describe, it } from 'vitest';
import { recomputeAttachedEdges } from '../../src/core/flow';
import type { Element } from '../../src/core/model/types';

const EPS = 1e-6;
const shapes = ['rectangle', 'ellipse', 'diamond'] as const;
const routings = ['straight', 'curved', 'orthogonal'] as const;

const nodeArb = (id: string) =>
  fc
    .record({
      type: fc.constantFrom(...shapes),
      x: fc.integer({ min: -500, max: 500 }),
      y: fc.integer({ min: -500, max: 500 }),
      width: fc.integer({ min: 10, max: 200 }),
      height: fc.integer({ min: 10, max: 200 }),
    })
    .map((r) => ({ id, ...r }) as unknown as Element);

const edgeArb = (id: string, n: number) =>
  fc
    .record({
      sourceId: fc.integer({ min: 0, max: n - 1 }).map((i) => `n${i}`),
      targetId: fc.integer({ min: 0, max: n - 1 }).map((i) => `n${i}`),
      routing: fc.constantFrom(...routings),
    })
    .map((r) => ({ id, type: 'edge', x: 0, y: 0, width: 0, height: 0, ...r }) as unknown as Element);

const scenarioArb = fc
  .integer({ min: 1, max: 5 })
  .chain((n) =>
    fc.record({
      nodes: fc.tuple(...Array.from({ length: n }, (_, i) => nodeArb(`n${i}`))),
      edges: fc.integer({ min: 1, max: 6 }).chain((m) =>
        fc.tuple(...Array.from({ length: m }, (_, i) => edgeArb(`e${i}`, n))),
      ),
      movedIdx: fc.integer({ min: 0, max: n - 1 }),
      dx: fc.integer({ min: -1000, max: 1000 }),
      dy: fc.integer({ min: -1000, max: 1000 }),
    }),
  );

type Pt = { x: number; y: number };

function onOrWithinOutline(el: Element, p: Pt): boolean {
  const hw = el.width / 2;
  const hh = el.height / 2;
  const dx = p.x - (el.x + hw);
  const dy = p.y - (el.y + hh);
  switch (el.type as string) {
    case 'ellipse':
      return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1 + EPS;
    case 'diamond':
      return Math.abs(dx) / hw + Math.abs(dy) / hh <= 1 + EPS;
    default:
      return Math.abs(dx) <= hw + EPS && Math.abs(dy) <= hh + EPS;
  }
}

// Feature: openboard, Property 48: Edge re-routing keeps endpoints attached
describe('Feature: openboard, Property 48: Edge re-routing keeps endpoints attached', () => {
  it('after moving an element every attached edge endpoint lies on/within its outline', () => {
    // **Validates: Requirements 8.4**
    fc.assert(
      fc.property(scenarioArb, ({ nodes, edges, movedIdx, dx, dy }) => {
        const moved = nodes[movedIdx]!;
        const movedNode = { ...moved, x: moved.x + dx, y: moved.y + dy } as Element;
        const after: Element[] = [...nodes.map((n, i) => (i === movedIdx ? movedNode : n)), ...edges];
        const byId = new Map(after.map((e) => [e.id, e]));

        const routes = recomputeAttachedEdges(after, [moved.id]);
        for (const edge of edges) {
          const e = edge as unknown as { id: string; sourceId: string; targetId: string };
          const attached = e.sourceId === moved.id || e.targetId === moved.id;
          if (!attached) {
            if (routes.has(e.id)) return false;
            continue;
          }
          const route = routes.get(e.id);
          if (!route) return false;
          if (e.sourceId === moved.id && !onOrWithinOutline(byId.get(e.sourceId)!, route.start)) return false;
          if (e.targetId === moved.id && !onOrWithinOutline(byId.get(e.targetId)!, route.end)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
