import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BoardModel } from '../../src/core/ops/model';
import { UndoHistory } from '../../src/core/ops/history';
import type { Tx } from '../../src/core/ops/model';
import type { BoardDocument } from '../../src/core/model/types';
import { arbBoardDocument, arbEditSequence } from '../arbitraries';
import type { EditOp } from '../arbitraries';

/** Applies one abstract op as a single transaction. Returns true when it committed. */
function applyOp(model: BoardModel, op: EditOp): boolean {
  const els = model.getDocument().elements;
  const target = (): string | undefined => (els.length === 0 ? undefined : els[(op as { target: number }).target % els.length]!.id);
  try {
    model.transact(op.kind, (tx: Tx) => {
      if (op.kind === 'add') {
        tx.create(op.element);
        return;
      }
      const id = target();
      if (id === undefined) throw new Error('no target');
      switch (op.kind) {
        case 'move': {
          const el = els.find((e) => e.id === id)!;
          tx.update(id, { x: el.x + op.dx, y: el.y + op.dy });
          break;
        }
        case 'resize':
          tx.update(id, { width: op.width, height: op.height });
          break;
        case 'rotate':
          tx.update(id, { rotation: op.rotation });
          break;
        case 'setOpacity':
          tx.update(id, { style: { opacity: op.opacity } });
          break;
        case 'toggleLock': {
          const el = els.find((e) => e.id === id)!;
          tx.update(id, { locked: !el.locked });
          break;
        }
        case 'delete':
          tx.remove(id);
          break;
        case 'reorder':
          tx.reorder([id], op.mode);
          break;
      }
    });
    return true;
  } catch {
    // Invalid op (no target, duplicate id, invariant violation): transaction rolled back.
    return false;
  }
}

function makeModel(doc: BoardDocument) {
  let tick = 0;
  const history = new UndoHistory();
  const model = new BoardModel('board.board', doc, {
    history,
    now: () => new Date(Date.UTC(2024, 0, 1, 0, 0, 0) + ++tick * 1000).toISOString(),
  });
  return { model, history };
}

// Feature: openboard, Property 8: Undo and redo are inverses
// **Validates: Requirements 10.2, 10.3, 10.9, 19.4**
describe('Feature: openboard, Property 8: Undo and redo are inverses', () => {
  it('n undos restore the original document and n redos restore the final document', () => {
    fc.assert(
      fc.property(arbBoardDocument(30), arbEditSequence(30), (doc, ops) => {
        const original = structuredClone(doc);
        const { model, history } = makeModel(structuredClone(doc));

        // Empty history: undo/redo are no-ops returning false.
        expect(history.undo(model)).toBe(false);
        expect(history.redo(model)).toBe(false);
        expect(model.getDocument()).toEqual(original);

        let n = 0;
        for (const op of ops) {
          // Empty (zero-patch) transactions push no history entry, so count only real edits.
          const before = history.undoCount();
          applyOp(model, op);
          if (history.undoCount() > before) n++;
        }
        const final = structuredClone(model.getDocument());
        expect(history.undoCount()).toBe(n);

        // Nothing to redo after fresh edits.
        expect(history.redo(model)).toBe(false);
        expect(model.getDocument()).toEqual(final);

        for (let i = 0; i < n; i++) expect(history.undo(model)).toBe(true);
        expect(model.getDocument()).toEqual(original);

        // Undo past the beginning is a no-op.
        expect(history.undo(model)).toBe(false);
        expect(model.getDocument()).toEqual(original);

        for (let i = 0; i < n; i++) expect(history.redo(model)).toBe(true);
        expect(model.getDocument()).toEqual(final);
        expect(history.redo(model)).toBe(false);
        expect(model.getDocument()).toEqual(final);
      }),
      { numRuns: 100 },
    );
  });
});
