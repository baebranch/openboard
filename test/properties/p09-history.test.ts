import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../../src/core/ops';
import type { BoardDocument } from '../../src/core/model/types';

// Feature: openboard, Property 9: History bookkeeping
// **Validates: Requirements 10.1, 10.4, 10.8**

const emptyDoc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

function setup(limit?: number) {
  const history = new UndoHistory(limit);
  let tick = 0;
  const model = new BoardModel('/b.openboard', emptyDoc(), { history, now: () => `T${++tick}` });
  let counter = 0;
  // Every edit moves the viewport to a distinct x, so the document always changes.
  const edit = () => model.transact('edit', (tx) => tx.setViewport({ x: ++counter, y: 0, zoom: 1 }));
  return { history, model, edit };
}

describe('Feature: openboard, Property 9: History bookkeeping', () => {
  it('each edit adds one entry and changes the doc; a new edit after undo clears redo', () => {
    const opArb = fc.constantFrom('edit', 'undo', 'redo');
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 60 }), (ops) => {
        const { history, model, edit } = setup();
        let undo = 0;
        let redo = 0;
        for (const op of ops) {
          if (op === 'edit') {
            const before = model.getDocument();
            edit();
            undo += 1;
            redo = 0;
            expect(model.getDocument()).not.toEqual(before);
            expect(model.getDocument().meta.modifiedAt).not.toBe(before.meta.modifiedAt);
            expect(history.redoCount()).toBe(0);
          } else if (op === 'undo') {
            const ok = history.undo(model);
            expect(ok).toBe(undo > 0);
            if (ok) {
              undo -= 1;
              redo += 1;
            }
          } else {
            const ok = history.redo(model);
            expect(ok).toBe(redo > 0);
            if (ok) {
              redo -= 1;
              undo += 1;
            }
          }
          expect(history.undoCount()).toBe(undo);
          expect(history.redoCount()).toBe(redo);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('enforces the limit (>= 200) and evicts the oldest entries first', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 230 }), fc.integer({ min: 1, max: 25 }), (requested, extra) => {
        const { history, model, edit } = setup(requested);
        const limit = history.getLimit();
        expect(limit).toBe(Math.max(200, requested));
        const total = limit + extra;
        let afterExtra: BoardDocument | undefined;
        for (let i = 1; i <= total; i++) {
          edit();
          expect(history.undoCount()).toBe(Math.min(i, limit));
          if (i === extra) afterExtra = model.getDocument();
        }
        let undone = 0;
        while (history.undo(model)) undone++;
        expect(undone).toBe(limit);
        expect(history.undoCount()).toBe(0);
        expect(model.getDocument()).toEqual(afterExtra);
      }),
      { numRuns: 100 },
    );
  });

  it('defaults to a limit of 500', () => {
    expect(new UndoHistory().getLimit()).toBe(500);
  });
});
