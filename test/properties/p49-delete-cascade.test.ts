import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format';
import type { Element } from '../../src/core/model/types';
import { arbBoardDocument } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 49: Deleting elements cascades to edges
// **Validates: Requirements 8.6**

type Ref = Element & { sourceId?: string; targetId?: string; parentId?: string };

const scenarioArb = arbBoardDocument(15)
  .filter((d) => d.elements.length > 0)
  .chain((doc) =>
    fc
      .subarray(
        doc.elements.map((e) => e.id),
        { minLength: 1 },
      )
      .map((ids) => ({ doc, ids })),
  );

describe('Feature: openboard, Property 49: Deleting elements cascades to edges', () => {
  it('deleting elements removes attached edges, detaches children, and one undo restores the document', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ doc, ids }) => {
        const { registry, model, history } = buildFullRegistry({ doc });
        const before = serialize(model.getDocument());
        const undoBefore = history.undoCount();

        // Independent expectation: selection plus fixed-point closure over attached edges.
        const doomed = new Set<string>(ids);
        for (let grew = true; grew; ) {
          grew = false;
          for (const e of doc.elements as Ref[]) {
            if (e.type === 'edge' && !doomed.has(e.id) && (doomed.has(e.sourceId!) || doomed.has(e.targetId!))) {
              doomed.add(e.id);
              grew = true;
            }
          }
        }

        const out = (await registry.invoke('openboard.element.delete', { ids })) as { error?: unknown };
        expect(out.error).toBeUndefined();

        const after = model.getDocument().elements as Ref[];
        const afterIds = new Set(after.map((e) => e.id));

        // Exactly the doomed set is gone; everything else remains, in order.
        expect([...afterIds].sort()).toEqual(doc.elements.filter((e) => !doomed.has(e.id)).map((e) => e.id).sort());
        expect(after.map((e) => e.id)).toEqual(doc.elements.filter((e) => !doomed.has(e.id)).map((e) => e.id));

        for (const e of after) {
          // No dangling edges or parents.
          if (e.type === 'edge') {
            expect(afterIds.has(e.sourceId!)).toBe(true);
            expect(afterIds.has(e.targetId!)).toBe(true);
          }
          if (e.parentId !== undefined) expect(afterIds.has(e.parentId)).toBe(true);
        }

        // Children of deleted frames are detached; other survivors are untouched.
        const originals = new Map((doc.elements as Ref[]).map((e) => [e.id, e]));
        for (const e of after) {
          const orig = originals.get(e.id)!;
          if (orig.parentId !== undefined && doomed.has(orig.parentId)) {
            expect('parentId' in e && e.parentId !== undefined).toBe(false);
          } else {
            expect(e).toEqual(orig);
          }
        }

        // One undo entry; one undo restores byte-identically.
        expect(history.undoCount()).toBe(undoBefore + 1);
        expect(history.undo(model)).toBe(true);
        expect(serialize(model.getDocument())).toBe(before);
        expect(history.undoCount()).toBe(undoBefore);
      }),
      { numRuns: 100 },
    );
  });
});
