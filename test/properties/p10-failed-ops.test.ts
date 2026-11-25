import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format/serializer';
import { arbBoardDocument } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';

const RUNS = { numRuns: 100 };

type Op = { tool: string; input?: unknown };

const rect = (id: string, x = 0) => ({ type: 'rectangle', id, x, y: 0, width: 20, height: 20 });

/** Valid operations over fresh ids `zz<i>`; create, update, then delete keep every op valid. */
const validOp = (i: number, kind: number): Op => {
  const id = `zz${i}`;
  if (kind === 0) return { tool: 'openboard.element.create', input: { elements: [rect(id, i)] } };
  return { tool: 'openboard.element.update', input: { ids: ['zz0'], set: { x: i + 1 } } };
};

/** Failing operations: invalid input, unknown tool, missing id, and a handler-level failure. */
const failingOps: Array<(existingId: string | undefined) => Op> = [
  () => ({ tool: 'openboard.element.create', input: { elements: [{ type: 'bogus' }] } }),
  () => ({ tool: 'openboard.no.such.tool', input: {} }),
  () => ({ tool: 'openboard.element.delete', input: { ids: ['missing-id-xyz'] } }),
  () => ({ tool: 'openboard.element.update', input: { ids: ['missing-id-xyz'], set: { x: 1 } } }),
  () => ({ tool: 'openboard.element.update', input: { ids: ['zz0'], set: { width: -5 } } }),
  (existing) => ({
    tool: 'openboard.element.create',
    input: { elements: [rect(existing ?? 'zz0')] },
  }),
];

// Feature: openboard, Property 10: Failed operations leave the document unchanged
describe('Feature: openboard, Property 10: Failed operations leave the document unchanged', () => {
  it('a batch with one failing operation reports its index and changes nothing', async () => {
    // **Validates: Requirements 13.6, 13.7, 10.7, 19.3**
    await fc.assert(
      fc.asyncProperty(
        arbBoardDocument(8),
        fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 1, maxLength: 20 }),
        fc.nat(),
        fc.nat(failingOps.length - 1),
        async (doc, kinds, at, failKind) => {
          const f = buildFullRegistry({ doc, spy: false });
          // Seed zz0 so update-based failures target a real element.
          const seed = await f.registry.invoke('openboard.element.create', { elements: [rect('zz0')] });
          expect((seed as any).error).toBeUndefined();
          const before = serialize(f.model.getDocument());
          const undoBefore = f.history.undoCount();

          const index = at % (kinds.length + 1);
          const ops: Op[] = kinds.map((k, i) => validOp(i + 1, k));
          ops.splice(index, 0, failingOps[failKind]!(doc.elements[0]?.id));
          // Duplicate-id failure must really collide with something present.
          const r = (await f.registry.invoke('openboard.batch', { operations: ops })) as any;

          expect(r.ok).toBe(false);
          expect(r.error.index).toBe(index);
          expect(typeof r.error.reason).toBe('string');
          expect(serialize(f.model.getDocument())).toBe(before);
          expect(f.history.undoCount()).toBe(undoBefore);
        },
      ),
      RUNS,
    );
  });

  it('a plain tool call that fails after earlier writes leaves document and history unchanged', async () => {
    // **Validates: Requirements 13.6, 13.7, 10.7, 19.3**
    await fc.assert(
      fc.asyncProperty(
        arbBoardDocument(8),
        fc.integer({ min: 1, max: 6 }),
        fc.constantFrom('dup', 'badprop', 'badtype'),
        async (doc, validCount, mode) => {
          const f = buildFullRegistry({ doc, spy: false });
          const before = serialize(f.model.getDocument());
          const undoBefore = f.history.undoCount();

          const good = Array.from({ length: validCount }, (_, i) => rect(`zz${i}`, i));
          let bad: Record<string, unknown>;
          if (mode === 'dup') bad = rect('zz0'); // collides with an element created earlier in the same call
          else if (mode === 'badprop') bad = { ...rect('zzbad'), width: -5 };
          else bad = { type: 'bogus' };
          const r = (await f.registry.invoke('openboard.element.create', { elements: [...good, bad] })) as any;

          expect(r.error).toBeDefined();
          expect(serialize(f.model.getDocument())).toBe(before);
          expect(f.history.undoCount()).toBe(undoBefore);

          // A failing update whose first element is valid but whose set contains a bad property.
          const seed = (await f.registry.invoke('openboard.element.create', { elements: [rect('u0'), rect('u1')] })) as any;
          expect(seed.error).toBeUndefined();
          const mid = serialize(f.model.getDocument());
          const undoMid = f.history.undoCount();
          const u = (await f.registry.invoke('openboard.element.update', {
            ids: ['u0', 'u1'],
            set: { x: 5, width: -5 },
          })) as any;
          expect(u.error).toBeDefined();
          expect(serialize(f.model.getDocument())).toBe(mid);
          expect(f.history.undoCount()).toBe(undoMid);
        },
      ),
      RUNS,
    );
  });
});
