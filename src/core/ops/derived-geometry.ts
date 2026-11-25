/**
 * Derived_Geometry_Pass: the Sync_Pass followed by the Layout_Pass, run by
 * `BoardModel.transact` after the edit callback and before the invariant check.
 * Pure: no vscode, DOM, or I/O. Locked elements are treated like unlocked ones.
 */
import type { BoardDocument, Element, ElementId } from '../model/types';
import { ComponentCycleError, ComponentDepthError, syncPass } from '../components/sync';
import { runLayoutPass } from '../layout/run-layout-pass';
import type { Patch } from './patches';

/** Hard cap on combined pass iterations (Req 18.6). */
export const MAX_DERIVED_ITERATIONS = 10;

export type DerivedGeometryFailure = 'component-cycle' | 'component-depth' | 'iteration-limit' | 'pass-error' | 'layout-failed';

export class DerivedGeometryError extends Error {
  readonly reason: DerivedGeometryFailure;
  readonly detail: string[];
  constructor(reason: DerivedGeometryFailure, detail: string[], message?: string) {
    super(message ?? `Derived geometry failed (${reason})${detail.length > 0 ? `: ${detail.join(', ')}` : ''}`);
    this.name = 'DerivedGeometryError';
    this.reason = reason;
    this.detail = detail;
  }
}

export interface DerivedGeometryResult {
  doc: BoardDocument;
  patches: Patch[];
  /** Apply to `doc` to restore the input document (already in reverse order). */
  inversePatches: Patch[];
  /** Ids of elements whose geometry/content differs from the input document. */
  changedIds: ElementId[];
}

/** One pass over a document. Must return the same `doc` reference when nothing changed. */
export type DerivedPassFn = (doc: BoardDocument) => { doc: BoardDocument; changedIds: ElementId[] };

/** Layout_Pass whose failure aborts the transaction with a "layout could not be computed" error. */
const layoutPass: DerivedPassFn = (doc) => {
  try {
    return runLayoutPass(doc);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DerivedGeometryError('layout-failed', [msg], `The layout could not be computed: ${msg}`);
  }
};

/** Passes run in order within each iteration: Sync_Pass, then Layout_Pass. */
export const DEFAULT_PASSES: readonly DerivedPassFn[] = [syncPass, layoutPass];

/** Cheap check so documents without instances or layout frames skip the pass entirely. */
export function needsDerivedPass(doc: BoardDocument): boolean {
  return doc.elements.some((e) => e.type === 'frame' && (e.instanceOf !== undefined || e.layout !== undefined));
}

type Rec = Record<string, unknown>;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as Rec).filter((k) => (a as Rec)[k] !== undefined);
  const kb = Object.keys(b as Rec).filter((k) => (b as Rec)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Rec)[k], (b as Rec)[k]));
}

export interface ElementsDiff {
  patches: Patch[];
  inversePatches: Patch[];
  changedIds: ElementId[];
}

/**
 * Compare two element lists and emit patches turning `before` into `after`.
 * When the id sequence is unchanged, emits one `replace` per changed index (the shape
 * `Draft.update` produces). Otherwise (insert, delete, reorder) emits one whole-list
 * `replace`, as `Draft.reorder` does.
 */
export function diffElements(before: readonly Element[], after: readonly Element[]): ElementsDiff {
  if (before === after) return { patches: [], inversePatches: [], changedIds: [] };
  const sameIds = before.length === after.length && before.every((e, i) => e.id === after[i]!.id);
  const patches: Patch[] = [];
  const inverse: Patch[] = [];
  const changed: ElementId[] = [];

  if (sameIds) {
    for (let i = 0; i < before.length; i++) {
      const b = before[i]!;
      const a = after[i]!;
      if (b === a || deepEqual(b, a)) continue;
      patches.push({ op: 'replace', path: ['elements', i], value: a });
      inverse.push({ op: 'replace', path: ['elements', i], value: b });
      changed.push(a.id);
    }
    return { patches, inversePatches: inverse.reverse(), changedIds: changed };
  }

  const beforeById = new Map<ElementId, Element>();
  for (const e of before) beforeById.set(e.id, e);
  const afterIds = new Set<ElementId>();
  for (const a of after) {
    afterIds.add(a.id);
    const b = beforeById.get(a.id);
    if (b === undefined || !deepEqual(b, a)) changed.push(a.id);
  }
  for (const b of before) if (!afterIds.has(b.id)) changed.push(b.id);
  if (before.length === after.length && changed.length === 0) {
    // Same elements in a different order: stacking order is a change too.
    for (let i = 0; i < before.length; i++) if (before[i]!.id !== after[i]!.id) changed.push(after[i]!.id);
  }
  return {
    patches: [{ op: 'replace', path: ['elements'], value: after.slice() }],
    inversePatches: [{ op: 'replace', path: ['elements'], value: before.slice() }],
    changedIds: changed,
  };
}

function wrap(err: unknown): DerivedGeometryError {
  if (err instanceof DerivedGeometryError) return err;
  if (err instanceof ComponentCycleError) return new DerivedGeometryError('component-cycle', err.masterIds, err.message);
  if (err instanceof ComponentDepthError) return new DerivedGeometryError('component-depth', err.masterIds, err.message);
  const msg = err instanceof Error ? err.message : String(err);
  return new DerivedGeometryError('pass-error', [msg], `Derived geometry failed: ${msg}`);
}

/**
 * Run the passes repeatedly until none changes anything. Never mutates `doc`.
 * Throws `DerivedGeometryError` on a pass failure or when the 10-iteration cap is hit.
 */
export function runDerivedGeometryPass(
  doc: BoardDocument,
  passes: readonly DerivedPassFn[] = DEFAULT_PASSES,
): DerivedGeometryResult {
  let cur = doc;
  const lastChanged = new Set<ElementId>();
  for (let i = 0; i < MAX_DERIVED_ITERATIONS; i++) {
    let anyChange = false;
    lastChanged.clear();
    try {
      for (const pass of passes) {
        const r = pass(cur);
        if (r.changedIds.length > 0 || r.doc !== cur) anyChange = true;
        for (const id of r.changedIds) lastChanged.add(id);
        cur = r.doc;
      }
    } catch (err) {
      throw wrap(err);
    }
    if (!anyChange) {
      const d = diffElements(doc.elements, cur.elements);
      return { doc: cur === doc ? doc : cur, patches: d.patches, inversePatches: d.inversePatches, changedIds: d.changedIds };
    }
  }
  throw new DerivedGeometryError('iteration-limit', [...lastChanged].sort());
}
