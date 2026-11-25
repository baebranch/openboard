/**
 * Pure helpers for Library entries saved from Component_Masters (Req 16.1 to 16.4, 16.12 to 16.14).
 * No vscode, DOM, or I/O.
 */
import type { Element, ElementId, LibraryComponent } from '../model/types';
import { scanTokenReferences } from '../tokens/references';

function isMaster(e: Element): boolean {
  return e.type === 'frame' && e.component !== undefined;
}

/** Ids of `rootId` and every element below it through `parentId`. */
export function subtreeIds(all: readonly Element[], rootId: ElementId): Set<ElementId> {
  const out = new Set<ElementId>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of all) {
      if (e.parentId !== undefined && out.has(e.parentId) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
    }
  }
  return out;
}

export interface MasterClosure {
  /** Chosen ids plus the subtrees of every chosen master and every master they depend on. */
  ids: Set<ElementId>;
  /** Master ids referenced by an instance but absent from the document. */
  missing: ElementId[];
}

/**
 * Expands a selection for saving: a chosen master brings its whole subtree, and every instance in
 * the result brings its master (and that master's subtree), recursively.
 */
export function expandMasterClosure(all: readonly Element[], chosen: ReadonlySet<ElementId>): MasterClosure {
  const byId = new Map(all.map((e) => [e.id, e]));
  const ids = new Set<ElementId>(chosen);
  const missing = new Set<ElementId>();
  const queue: ElementId[] = [...chosen];
  const addTree = (rootId: ElementId): void => {
    for (const id of subtreeIds(all, rootId)) {
      if (!ids.has(id)) {
        ids.add(id);
        queue.push(id);
      }
    }
  };
  while (queue.length > 0) {
    const e = byId.get(queue.pop() as ElementId);
    if (!e || e.type !== 'frame') continue;
    if (e.component !== undefined) addTree(e.id);
    if (e.instanceOf !== undefined) {
      const master = byId.get(e.instanceOf);
      if (!master || !isMaster(master)) missing.add(e.instanceOf);
      else addTree(master.id);
    }
  }
  return { ids, missing: [...missing] };
}

/** True when the entry was saved from at least one Component_Master. */
export function isComponentEntry(entry: Pick<LibraryComponent, 'elements'>): boolean {
  return entry.elements.some(isMaster);
}

/** The master that Library insertion instantiates: the first root-level master of the entry. */
export function primaryMaster(entry: Pick<LibraryComponent, 'elements'>): Element | undefined {
  return entry.elements.find((e) => isMaster(e) && e.parentId === undefined) ?? entry.elements.find(isMaster);
}

/**
 * Describes why a component entry cannot be inserted, or undefined when it is consistent: every
 * instance must reference a master that the entry contains, and every Token reference must have a
 * recorded value in the entry.
 */
export function entryProblem(entry: LibraryComponent): string | undefined {
  if (!Array.isArray(entry.elements) || entry.elements.length === 0) return 'The Library entry has no elements.';
  const masters = new Set(entry.elements.filter(isMaster).map((e) => e.id));
  for (const e of entry.elements) {
    if (e.type === 'frame' && e.instanceOf !== undefined && !masters.has(e.instanceOf)) {
      return `The Library entry references the master "${e.instanceOf}" that it does not contain.`;
    }
  }
  for (const ref of scanTokenReferences(entry.elements)) {
    const bucket = entry.tokens?.[ref.category] as Record<string, unknown> | undefined;
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, ref.name)) {
      return `The Library entry references the Token "${ref.name}" that it does not contain.`;
    }
  }
  return undefined;
}
