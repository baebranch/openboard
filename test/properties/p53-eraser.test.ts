import fc from 'fast-check';
import { describe, it } from 'vitest';
import { eraseIntersecting, type Bounds, type StrokePoint } from '../../src/core/freehand';

type P = { x: number; y: number };

// Independent oracle using exact integer arithmetic (orientation tests).
const orient = (a: P, b: P, c: P): number => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const onSeg = (a: P, b: P, c: P): boolean =>
  Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);

function segsIntersect(p1: P, p2: P, q1: P, q2: P): boolean {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(p1, p2, q1)) return true;
  if (o2 === 0 && onSeg(p1, p2, q2)) return true;
  if (o3 === 0 && onSeg(q1, q2, p1)) return true;
  if (o4 === 0 && onSeg(q1, q2, p2)) return true;
  return false;
}

function insideRect(p: P, r: Bounds): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

function oracleSegmentHits(a: P, b: P, r: Bounds): boolean {
  if (insideRect(a, r) || insideRect(b, r)) return true;
  const c = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  for (let i = 0; i < 4; i++) {
    if (segsIntersect(a, b, c[i]!, c[(i + 1) % 4]!)) return true;
  }
  return false;
}

function oracle(path: readonly P[], r: Bounds): boolean {
  if (path.length === 0) return false;
  if (path.length === 1) return insideRect(path[0]!, r);
  for (let i = 1; i < path.length; i++) if (oracleSegmentHits(path[i - 1]!, path[i]!, r)) return true;
  return false;
}

const coord = fc.integer({ min: -50, max: 50 });
const pointArb: fc.Arbitrary<StrokePoint> = fc.record({ x: coord, y: coord });
const boundsArb: fc.Arbitrary<Bounds> = fc.record({
  x: coord,
  y: coord,
  width: fc.integer({ min: 0, max: 30 }),
  height: fc.integer({ min: 0, max: 30 }),
});

// Feature: openboard, Property 53: Eraser removes exactly intersected elements
describe('Feature: openboard, Property 53: Eraser removes exactly intersected elements', () => {
  it('returns exactly the ids whose bounds intersect the pointer path', () => {
    // **Validates: Requirements 9.6**
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 1, maxLength: 8 }),
        fc.array(boundsArb, { minLength: 0, maxLength: 12 }),
        (path, boundsList) => {
          const elements = boundsList.map((bounds, i) => ({ id: `e${i}`, bounds }));
          const result = eraseIntersecting(path, elements);
          const expected = elements.filter((e) => oracle(path, e.bounds)).map((e) => e.id);
          return result.length === expected.length && expected.every((id) => result.includes(id));
        },
      ),
      { numRuns: 300 },
    );
  });
});
