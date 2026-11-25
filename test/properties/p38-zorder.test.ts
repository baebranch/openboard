import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Element } from '../../src/core/model/types';
import { buildFullRegistry, emptyBoardDoc } from '../helpers/registry';

type Mode = 'front' | 'back' | 'forward' | 'backward';

/** Independent oracle: compute final slots for selected ids, fill the rest with unselected in order. */
function oracle(order: string[], sel: Set<string>, mode: Mode): string[] {
  const n = order.length;
  const selIdx = order.map((id, i) => (sel.has(id) ? i : -1)).filter((i) => i >= 0);
  const finalPos = new Map<number, number>(); // old index -> new index
  const taken = new Set<number>();
  if (mode === 'front') selIdx.forEach((old, k) => finalPos.set(old, n - selIdx.length + k));
  else if (mode === 'back') selIdx.forEach((old, k) => finalPos.set(old, k));
  else if (mode === 'forward') {
    for (const old of [...selIdx].reverse()) {
      const to = old + 1 < n && !taken.has(old + 1) ? old + 1 : old;
      finalPos.set(old, to);
      taken.add(to);
    }
  } else {
    for (const old of selIdx) {
      const to = old - 1 >= 0 && !taken.has(old - 1) ? old - 1 : old;
      finalPos.set(old, to);
      taken.add(to);
    }
  }
  const out: (string | undefined)[] = new Array(n).fill(undefined);
  for (const [old, to] of finalPos) out[to] = order[old];
  const rest = order.filter((id) => !sel.has(id));
  let r = 0;
  for (let i = 0; i < n; i++) if (out[i] === undefined) out[i] = rest[r++];
  return out as string[];
}

const scenarioArb = fc.integer({ min: 1, max: 12 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    picks: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
    mode: fc.constantFrom<Mode>('front', 'back', 'forward', 'backward'),
  }),
);

// Feature: openboard, Property 38: Z-order operations
describe('Feature: openboard, Property 38: Z-order operations', () => {
  it('front/back/forward/backward match the oracle and preserve relative orders', async () => {
    // **Validates: Requirements 5.10**
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ n, picks, mode }) => {
        const elements = Array.from({ length: n }, (_, i) => ({
          id: `e${i}`,
          type: 'rectangle',
          x: i * 10,
          y: 0,
          width: 5,
          height: 5,
          rotation: 0,
          style: {},
        })) as unknown as Element[];
        const { registry, model } = buildFullRegistry({ doc: { ...emptyBoardDoc(), elements } });
        const before = elements.map((e) => e.id);
        const sel = new Set(before.filter((_, i) => picks[i]));
        const ids = [...sel].reverse();

        const out = (await registry.invoke('openboard.element.arrange', {
          action: 'zorder',
          mode,
          ids,
        })) as { changed: boolean };
        const after = model.getDocument().elements.map((e) => e.id);

        // permutation
        expect([...after].sort()).toEqual([...before].sort());
        // matches oracle
        const expected = oracle(before, sel, mode);
        expect(after).toEqual(expected);
        // relative order preserved for selected and non-selected
        expect(after.filter((id) => sel.has(id))).toEqual(before.filter((id) => sel.has(id)));
        expect(after.filter((id) => !sel.has(id))).toEqual(before.filter((id) => !sel.has(id)));
        const k = sel.size;
        if (k > 0 && mode === 'front') expect(after.slice(n - k).every((id) => sel.has(id))).toBe(true);
        if (k > 0 && mode === 'back') expect(after.slice(0, k).every((id) => sel.has(id))).toBe(true);
        expect(out.changed).toBe(after.join() !== before.join());
      }),
      { numRuns: 150 },
    );
  });
});
