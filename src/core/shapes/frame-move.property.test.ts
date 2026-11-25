import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Element } from '../model';
import { moveFramePatches } from './shapes';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;

/** A random forest of frames/rectangles; each element's parent is an earlier frame or none. */
const forestArb = fc
  .array(
    fc.record({
      isFrame: fc.boolean(),
      parentPick: fc.nat(),
      x: fc.integer({ min: -1000, max: 1000 }),
      y: fc.integer({ min: -1000, max: 1000 }),
    }),
    { minLength: 1, maxLength: 25 },
  )
  .map((specs) => {
    const els: Element[] = [];
    const frames: string[] = [];
    specs.forEach((s, i) => {
      const id = `e${i}`;
      const parentId = frames.length > 0 && s.parentPick % (frames.length + 1) > 0 ? frames[(s.parentPick % (frames.length + 1)) - 1] : undefined;
      els.push({
        id,
        type: s.isFrame ? 'frame' : 'rectangle',
        x: s.x,
        y: s.y,
        width: 50,
        height: 50,
        rotation: 0,
        style,
        ...(s.isFrame ? { name: id } : {}),
        ...(parentId ? { parentId } : {}),
      } as Element);
      if (s.isFrame) frames.push(id);
    });
    return els;
  });

describe('Property 30: Frame move cascade', () => {
  it('shifts every descendant by exactly the delta and leaves non-descendants untouched', () => {
    // **Validates: Requirements 21.7**
    fc.assert(
      fc.property(
        forestArb,
        fc.nat(),
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -500, max: 500 }),
        (els, pick, dx, dy) => {
          const frames = els.filter((e) => e.type === 'frame');
          fc.pre(frames.length > 0);
          const frame = frames[pick % frames.length]!;
          const byId = new Map(els.map((e) => [e.id, e]));
          const isDescendant = (e: Element): boolean => {
            for (let p = e.parentId; p !== undefined; p = byId.get(p)?.parentId) if (p === frame.id) return true;
            return false;
          };
          const expected = new Set(els.filter((e) => e.id === frame.id || isDescendant(e)).map((e) => e.id));

          const patches = moveFramePatches(frame.id, els, dx, dy);
          expect(new Set(patches.map((p) => p.id))).toEqual(expected);
          expect(patches.length).toBe(expected.size);
          for (const p of patches) {
            const orig = byId.get(p.id)!;
            expect(p.patch).toEqual({ x: orig.x + dx, y: orig.y + dy });
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
