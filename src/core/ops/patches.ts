import type { BoardDocument } from '../model/types';

/** A path segment: object key or array index. */
export type PathSegment = string | number;

/**
 * A minimal JSON-patch-like operation applied to a `BoardDocument`.
 * - `add`: object key set, or array insert at index (shifting later items).
 * - `replace`: set the value at the path.
 * - `remove`: object key delete, or array splice at index.
 * Applying a list of patches is sequential; inverse lists are in reverse order.
 */
export type Patch =
  | { op: 'add'; path: PathSegment[]; value: unknown }
  | { op: 'replace'; path: PathSegment[]; value: unknown }
  | { op: 'remove'; path: PathSegment[] };

/** One undoable unit. The UndoHistory (task 5.2) stores these. */
export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

/** Hook the history plugs into. `transact` calls `push` exactly once per successful transaction. */
export interface HistorySink {
  push(entry: HistoryEntry): void;
}

/** A change to apply without recording history (used by undo/redo). */
export interface Change {
  patches: Patch[];
}

/** Apply patches immutably (structural sharing along touched paths). */
export function applyPatches(doc: BoardDocument, patches: readonly Patch[]): BoardDocument {
  let cur: unknown = doc;
  for (const p of patches) cur = applyOne(cur, p, 0);
  return cur as BoardDocument;
}

function applyOne(node: unknown, patch: Patch, depth: number): unknown {
  const key = patch.path[depth];
  if (key === undefined) throw new Error('Patch path must not be empty');
  const last = depth === patch.path.length - 1;

  if (Array.isArray(node)) {
    const idx = key as number;
    const copy = node.slice();
    if (last) {
      if (patch.op === 'add') copy.splice(idx, 0, patch.value);
      else if (patch.op === 'remove') copy.splice(idx, 1);
      else copy[idx] = patch.value;
    } else {
      copy[idx] = applyOne(copy[idx], patch, depth + 1);
    }
    return copy;
  }

  const obj = { ...(node as Record<string, unknown>) };
  const k = key as string;
  if (last) {
    if (patch.op === 'remove' || patch.value === undefined) delete obj[k];
    else obj[k] = patch.value;
  } else {
    obj[k] = applyOne(obj[k], patch, depth + 1);
  }
  return obj;
}
