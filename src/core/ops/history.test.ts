import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from './index';
import type { ElementInput } from './index';
import type { BoardDocument } from '../model/types';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const rect = (id: string): ElementInput => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style });
const emptyDoc = (): BoardDocument => ({ schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [], assets: [], library: [] });

function setup(limit?: number) {
  const history = new UndoHistory(limit);
  const model = new BoardModel('/b.openboard', emptyDoc(), { history, now: () => 'T' });
  return { history, model };
}

describe('UndoHistory', () => {
  it('returns false when empty', () => {
    const { history, model } = setup();
    expect(history.undo(model)).toBe(false);
    expect(history.redo(model)).toBe(false);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('undoes and redoes a transaction', () => {
    const { history, model } = setup();
    const before = model.getDocument();
    model.transact('add', (tx) => void tx.create(rect('a')));
    const after = model.getDocument();
    expect(history.undoCount()).toBe(1);
    expect(history.undo(model)).toBe(true);
    expect(model.getDocument()).toEqual(before);
    expect(history.canRedo()).toBe(true);
    expect(history.redo(model)).toBe(true);
    expect(model.getDocument()).toEqual(after);
    expect(history.redoCount()).toBe(0);
  });

  it('clears redo on new push', () => {
    const { history, model } = setup();
    model.transact('a', (tx) => void tx.create(rect('a')));
    history.undo(model);
    model.transact('b', (tx) => void tx.create(rect('b')));
    expect(history.canRedo()).toBe(false);
  });

  it('evicts oldest beyond limit and never goes below 200', () => {
    const { history, model } = setup(5);
    expect(history.getLimit()).toBe(200);
    for (let i = 0; i < 205; i++) model.transact('t', (tx) => void tx.create(rect(`e${i}`)));
    expect(history.undoCount()).toBe(200);
    expect(new UndoHistory().getLimit()).toBe(500);
  });
});
