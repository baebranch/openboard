import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { newId } from './ids';
import { boundsOf, rotatedBounds, unionBounds, intersects, containsBounds } from './geometry';
import { reorderIds } from './zorder';
import { clamp, ZOOM_RANGE } from './ranges';
import type { ZOrderMode } from './types';

describe('newId', () => {
  it('returns unique UUID v4 strings', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    expect([...ids][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('geometry', () => {
  it('unionBounds of empty is undefined', () => {
    expect(unionBounds([])).toBeUndefined();
  });
  it('unions boxes', () => {
    expect(
      unionBounds([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: -5, width: 5, height: 5 },
      ]),
    ).toEqual({ x: 0, y: -5, width: 25, height: 15 });
  });
  it('rotatedBounds by 90 swaps dimensions about the center', () => {
    const r = rotatedBounds({ x: 0, y: 0, width: 10, height: 20, rotation: 90 });
    expect(r.width).toBeCloseTo(20);
    expect(r.height).toBeCloseTo(10);
    expect(r.x).toBeCloseTo(-5);
    expect(r.y).toBeCloseTo(5);
  });
  it('union contains every input and intersects it', () => {
    const arbB = fc.record({
      x: fc.integer({ min: -1000, max: 1000 }),
      y: fc.integer({ min: -1000, max: 1000 }),
      width: fc.integer({ min: 1, max: 500 }),
      height: fc.integer({ min: 1, max: 500 }),
    });
    fc.assert(
      fc.property(fc.array(arbB, { minLength: 1, maxLength: 20 }), (bs) => {
        const u = unionBounds(bs)!;
        return bs.every((b) => containsBounds(u, boundsOf(b)) && intersects(u, b));
      }),
    );
  });
});

describe('reorderIds', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  it('front / back', () => {
    expect(reorderIds(order, ['b', 'd'], 'front')).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(reorderIds(order, ['b', 'd'], 'back')).toEqual(['b', 'd', 'a', 'c', 'e']);
  });
  it('forward / backward move one step and keep relative order', () => {
    expect(reorderIds(order, ['b', 'c'], 'forward')).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(reorderIds(order, ['c', 'd'], 'backward')).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(reorderIds(order, ['e'], 'forward')).toEqual(order);
    expect(reorderIds(order, ['a'], 'backward')).toEqual(order);
  });
  it('is always a permutation preserving selected relative order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.nat(50), { minLength: 1, maxLength: 20 }),
        fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
        fc.constantFrom<ZOrderMode[]>('front', 'back', 'forward', 'backward'),
        (nums, flags, mode) => {
          const ord = nums.map(String);
          const sel = ord.filter((_, i) => flags[i]);
          const out = reorderIds(ord, sel, mode);
          expect([...out].sort()).toEqual([...ord].sort());
          expect(out.filter((id) => sel.includes(id))).toEqual(ord.filter((id) => sel.includes(id)));
        },
      ),
    );
  });
});

describe('clamp', () => {
  it('clamps zoom to 2%..800%', () => {
    expect(clamp(0.001, ZOOM_RANGE)).toBe(0.02);
    expect(clamp(100, ZOOM_RANGE)).toBe(8);
  });
});
