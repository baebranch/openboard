import type { BoardModel } from './model';
import type { HistoryEntry, HistorySink } from './patches';

export const DEFAULT_HISTORY_LIMIT = 500;
export const MIN_HISTORY_LIMIT = 200;

/** Linear undo/redo stack of patch entries. */
export class UndoHistory implements HistorySink {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly limit: number;

  /** `limit` is clamped to at least 200 entries. */
  constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
    const n = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_HISTORY_LIMIT;
    this.limit = Math.max(MIN_HISTORY_LIMIT, n);
  }

  push(entry: HistoryEntry): void {
    this.redoStack = [];
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
  }

  undo(model: BoardModel): boolean {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return false;
    model.apply({ patches: entry.inversePatches });
    this.undoStack.pop();
    this.redoStack.push(entry);
    return true;
  }

  redo(model: BoardModel): boolean {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) return false;
    model.apply({ patches: entry.patches });
    this.redoStack.pop();
    this.undoStack.push(entry);
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoCount(): number {
    return this.undoStack.length;
  }

  redoCount(): number {
    return this.redoStack.length;
  }

  getLimit(): number {
    return this.limit;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
