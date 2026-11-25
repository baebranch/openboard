import { LIBRARY_NAME_LENGTH, inRange } from '../model/ranges';
import { newId } from '../model/ids';
import { reorderElements } from '../model/zorder';
import type {
  Asset,
  AssetId,
  BoardDocument,
  BoardMeta,
  BoardSettings,
  EdgeProps,
  Element,
  ElementBase,
  ElementId,
  ElementStyle,
  FlowNodeProps,
  FrameProps,
  FreehandProps,
  ImageProps,
  LibraryComponent,
  TextProps,
  Viewport,
  ZOrderMode,
} from '../model/types';
import { InvariantError, checkInvariants } from './invariants';
import { applyPatches } from './patches';
import type { Change, HistoryEntry, HistorySink, Patch } from './patches';
import { SerialQueue } from './serial-queue';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Element to create. `id` is generated when omitted. */
export type ElementInput = DistributiveOmit<Element, 'id'> & { id?: ElementId };

/** Fields of an element that `update` may change. `id` and `type` are immutable. `undefined` deletes an optional field. */
export type ElementPatch = Partial<
  Omit<ElementBase, 'id' | 'type' | 'style'> &
    TextProps &
    ImageProps &
    FreehandProps &
    FlowNodeProps &
    FrameProps &
    EdgeProps
> & { style?: Partial<ElementStyle> };

export type AssetInput = Omit<Asset, 'id'> & { id?: AssetId };
export type LibraryComponentInput = Omit<LibraryComponent, 'id'> & { id?: string };

/** The only mutation surface for a board. */
export interface Tx {
  create(el: ElementInput): Element;
  update(id: ElementId, patch: ElementPatch): void;
  /** Removes the element and every edge attached to it. Children of a removed frame are detached. */
  remove(id: ElementId): void;
  reorder(ids: ElementId[], mode: ZOrderMode): void;
  setViewport(v: Viewport): void;
  /** Stores the asset once: an existing asset with the same hash is reused and its id returned. */
  addAsset(a: AssetInput): AssetId;
  removeAsset(id: AssetId): void;
  addLibraryComponent(c: LibraryComponentInput): LibraryComponent;
  removeLibraryComponent(id: string): void;
  setMeta(patch: Partial<BoardMeta>): void;
  setSettings(settings: BoardSettings | undefined): void;
  /** Read-only view of the document as staged so far. */
  readonly doc: BoardDocument;
}

export interface ChangeEvent {
  /**
   * - `transact`: a committed edit (content change + one undo entry).
   * - `apply`: content change without an undo entry (undo/redo, scope rollback).
   * - `scoped`: content change inside an open scope; its undo entry is deferred to the scope commit.
   * - `scope-commit`: the scope's single merged undo entry was recorded; the content was already
   *   announced by the `scoped` events, so `patches` is informational only.
   */
  kind: 'transact' | 'apply' | 'scoped' | 'scope-commit';
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface BoardModelOptions {
  history?: HistorySink;
  /** ISO timestamp source for `meta.modifiedAt`. */
  now?: () => string;
}

/** History sink that discards entries; replaced by the UndoHistory (task 5.2). */
export const nullHistory: HistorySink = { push: () => undefined };

export class BoardModel {
  readonly path: string;
  readonly serialQueue = new SerialQueue();
  /** Pluggable history. `transact` pushes exactly one entry per successful call. */
  history: HistorySink;

  private doc: BoardDocument;
  private active = false;
  private scope: { label: string; entries: HistoryEntry[] } | undefined;
  private readonly now: () => string;
  private readonly listeners = new Set<(e: ChangeEvent) => void>();

  constructor(path: string, doc: BoardDocument, options: BoardModelOptions = {}) {
    this.path = path;
    this.doc = doc;
    this.history = options.history ?? nullHistory;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  getDocument(): BoardDocument {
    return this.doc;
  }

  /** Replace the whole document (e.g. reload from disk). Does not touch history. */
  reset(doc: BoardDocument): void {
    this.doc = doc;
  }

  onDidChange(listener: (e: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Internal: apply patches without recording history (undo/redo). */
  apply(change: Change): void {
    if (this.active) throw new Error('Cannot apply a change during a transaction');
    this.doc = applyPatches(this.doc, change.patches);
    this.emit({ kind: 'apply', label: '', patches: change.patches, inversePatches: [] });
  }

  /**
   * Run `fn` against a staged draft. On success the draft is committed atomically and exactly one
   * history entry is pushed. If `fn` throws, an invariant fails, or the history rejects the entry,
   * the document and history are unchanged.
   */
  transact<T>(label: string, fn: (tx: Tx) => T): T {
    if (this.active) throw new Error('Nested transactions are not supported');
    this.active = true;
    try {
      const draft = new Draft(this.doc, this.now);
      let result: T;
      try {
        result = fn(draft);
      } finally {
        draft.close();
      }
      const { doc, patches, inversePatches } = draft.finish();
      const problems = checkInvariants(doc);
      if (problems.length > 0) throw new InvariantError(problems);
      // A transaction that changed nothing is not an edit: no history entry, no change event.
      if (patches.length === 0) return result;
      const entry: HistoryEntry = { label, patches, inversePatches };
      if (this.scope) {
        this.scope.entries.push(entry);
        this.doc = doc;
        this.emit({ kind: 'scoped', label, patches, inversePatches });
        return result;
      }
      this.history.push(entry);
      this.doc = doc;
      this.emit({ kind: 'transact', label, patches, inversePatches });
      return result;
    } finally {
      this.active = false;
    }
  }

  /** True while a scope is open. */
  get hasScope(): boolean {
    return this.scope !== undefined;
  }

  /**
   * Opens a scope: until `commitScope`/`rollbackScope`, every successful `transact` is applied to
   * the document immediately (so later reads see it and views update live) but its undo entry is
   * held back. Used to make a multi-call script one atomic, single-undo unit. Scopes do not nest.
   * Any transaction on this model while the scope is open (including from another caller) joins it.
   */
  beginScope(label: string): void {
    if (this.active) throw new Error('Cannot open a scope during a transaction');
    if (this.scope) throw new Error('A scope is already open');
    this.scope = { label, entries: [] };
  }

  /** Closes the scope, recording ONE undo entry that merges everything done in it. */
  commitScope(): void {
    const scope = this.scope;
    if (!scope) return;
    this.scope = undefined;
    if (scope.entries.length === 0) return;
    const first = scope.entries[0] as HistoryEntry;
    const entry: HistoryEntry =
      scope.entries.length === 1
        ? { ...first, label: scope.label }
        : {
            label: scope.label,
            patches: scope.entries.flatMap((e) => e.patches),
            inversePatches: scope.entries
              .slice()
              .reverse()
              .flatMap((e) => e.inversePatches),
          };
    this.history.push(entry);
    this.emit({ kind: 'scope-commit', label: scope.label, patches: entry.patches, inversePatches: entry.inversePatches });
  }

  /** Closes the scope and restores the document to its state at `beginScope`; no history entry. */
  rollbackScope(): void {
    const scope = this.scope;
    if (!scope) return;
    this.scope = undefined;
    if (scope.entries.length === 0) return;
    const inverse = scope.entries
      .slice()
      .reverse()
      .flatMap((e) => e.inversePatches);
    this.doc = applyPatches(this.doc, inverse);
    this.emit({ kind: 'apply', label: '', patches: inverse, inversePatches: [] });
  }

  private emit(e: ChangeEvent): void {
    for (const l of [...this.listeners]) l(e);
  }
}

class Draft implements Tx {
  private meta: BoardMeta;
  private viewport: Viewport;
  private settings: BoardSettings | undefined;
  private elements: Element[];
  private assets: Asset[];
  private library: LibraryComponent[];
  private ownEls = false;
  private ownAssets = false;
  private ownLib = false;
  private index: Map<ElementId, number> | undefined;
  private closed = false;
  private readonly patches: Patch[] = [];
  private readonly inverse: Patch[] = [];
  private readonly base: BoardDocument;

  constructor(
    base: BoardDocument,
    private readonly now: () => string,
  ) {
    this.base = base;
    this.meta = base.meta;
    this.viewport = base.viewport;
    this.settings = base.settings;
    this.elements = base.elements;
    this.assets = base.assets;
    this.library = base.library;
  }

  get doc(): BoardDocument {
    return this.build();
  }

  close(): void {
    this.closed = true;
  }

  finish(): { doc: BoardDocument; patches: Patch[]; inversePatches: Patch[] } {
    this.closed = false;
    if (this.patches.length > 0) {
      const stamp = this.now();
      if (this.meta.modifiedAt !== stamp) this.setMeta({ modifiedAt: stamp });
    }
    this.closed = true;
    return { doc: this.build(), patches: this.patches, inversePatches: this.inverse.slice().reverse() };
  }

  // --- elements -----------------------------------------------------------

  create(input: ElementInput): Element {
    this.assertOpen();
    const el = { ...input, id: input.id ?? newId() } as Element;
    if (this.indexOf(el.id) !== undefined) throw new Error(`Element id already exists: ${el.id}`);
    const els = this.mutableElements();
    const i = els.length;
    els.push(el);
    this.index?.set(el.id, i);
    this.record({ op: 'add', path: ['elements', i], value: el }, { op: 'remove', path: ['elements', i] });
    return el;
  }

  update(id: ElementId, patch: ElementPatch): void {
    this.assertOpen();
    const i = this.requireIndex(id);
    const old = this.elements[i] as Element;
    const next: Record<string, unknown> = { ...old };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'id' || key === 'type') {
        if (value !== undefined && value !== (old as unknown as Record<string, unknown>)[key]) {
          throw new Error(`Element ${key} is immutable`);
        }
      } else if (key === 'style') {
        next.style = { ...old.style, ...(value as Partial<ElementStyle>) };
      } else if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    const el = next as unknown as Element;
    this.mutableElements()[i] = el;
    this.record({ op: 'replace', path: ['elements', i], value: el }, { op: 'replace', path: ['elements', i], value: old });
  }

  remove(id: ElementId): void {
    this.assertOpen();
    this.requireIndex(id);
    // Fixed point: the element, every edge attached to a removed element.
    const doomed = new Set<ElementId>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const el of this.elements) {
        if (el.type === 'edge' && !doomed.has(el.id) && (doomed.has(el.sourceId) || doomed.has(el.targetId))) {
          doomed.add(el.id);
          grew = true;
        }
      }
    }
    // Detach surviving children of removed frames.
    const els = this.mutableElements();
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as Element;
      if (el.parentId !== undefined && doomed.has(el.parentId) && !doomed.has(el.id)) {
        const { parentId: _drop, ...rest } = el;
        void _drop;
        const next = rest as Element;
        els[i] = next;
        this.record({ op: 'replace', path: ['elements', i], value: next }, { op: 'replace', path: ['elements', i], value: el });
      }
    }
    // Remove from the back so earlier indices stay valid.
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i] as Element;
      if (!doomed.has(el.id)) continue;
      els.splice(i, 1);
      this.record({ op: 'remove', path: ['elements', i] }, { op: 'add', path: ['elements', i], value: el });
    }
    this.index = undefined;
  }

  reorder(ids: ElementId[], mode: ZOrderMode): void {
    this.assertOpen();
    for (const id of ids) this.requireIndex(id);
    const before = this.elements;
    const after = reorderElements(before, ids, mode);
    if (after.every((el, i) => el === before[i])) return;
    this.elements = after.slice();
    this.ownEls = true;
    this.index = undefined;
    this.record(
      { op: 'replace', path: ['elements'], value: after.slice() },
      { op: 'replace', path: ['elements'], value: before.slice() },
    );
  }

  // --- document fields ----------------------------------------------------

  setViewport(v: Viewport): void {
    this.assertOpen();
    const old = this.viewport;
    this.viewport = { x: v.x, y: v.y, zoom: v.zoom };
    this.record(
      { op: 'replace', path: ['viewport'], value: this.viewport },
      { op: 'replace', path: ['viewport'], value: old },
    );
  }

  addAsset(input: AssetInput): AssetId {
    this.assertOpen();
    const dup = this.assets.find((a) => a.hash === input.hash);
    if (dup) return dup.id;
    const id = input.id ?? newId();
    if (this.assets.some((a) => a.id === id)) throw new Error(`Asset id already exists: ${id}`);
    const asset: Asset = { ...input, id };
    const list = this.mutableAssets();
    const i = list.length;
    list.push(asset);
    this.record({ op: 'add', path: ['assets', i], value: asset }, { op: 'remove', path: ['assets', i] });
    return id;
  }

  removeAsset(id: AssetId): void {
    this.assertOpen();
    const i = this.assets.findIndex((a) => a.id === id);
    if (i < 0) throw new Error(`Asset not found: ${id}`);
    const old = this.assets[i] as Asset;
    this.mutableAssets().splice(i, 1);
    this.record({ op: 'remove', path: ['assets', i] }, { op: 'add', path: ['assets', i], value: old });
  }

  addLibraryComponent(input: LibraryComponentInput): LibraryComponent {
    this.assertOpen();
    if (!inRange(input.name.length, LIBRARY_NAME_LENGTH)) {
      throw new Error(`Library component name must be ${LIBRARY_NAME_LENGTH.min} to ${LIBRARY_NAME_LENGTH.max} characters`);
    }
    if (input.elements.length === 0) throw new Error('Library component must contain at least one element');
    const id = input.id ?? newId();
    if (this.library.some((c) => c.id === id)) throw new Error(`Library component id already exists: ${id}`);
    const comp: LibraryComponent = { ...input, id };
    const list = this.mutableLibrary();
    const i = list.length;
    list.push(comp);
    this.record({ op: 'add', path: ['library', i], value: comp }, { op: 'remove', path: ['library', i] });
    return comp;
  }

  removeLibraryComponent(id: string): void {
    this.assertOpen();
    const i = this.library.findIndex((c) => c.id === id);
    if (i < 0) throw new Error(`Library component not found: ${id}`);
    const old = this.library[i] as LibraryComponent;
    this.mutableLibrary().splice(i, 1);
    this.record({ op: 'remove', path: ['library', i] }, { op: 'add', path: ['library', i], value: old });
  }

  setMeta(patch: Partial<BoardMeta>): void {
    this.assertOpen();
    const old = this.meta;
    const next: Record<string, unknown> = { ...old };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    if (typeof next.id !== 'string') throw new Error('meta.id is required');
    this.meta = next as unknown as BoardMeta;
    this.record({ op: 'replace', path: ['meta'], value: this.meta }, { op: 'replace', path: ['meta'], value: old });
  }

  setSettings(settings: BoardSettings | undefined): void {
    this.assertOpen();
    const old = this.settings;
    this.settings = settings;
    const fwd: Patch =
      settings === undefined
        ? { op: 'remove', path: ['settings'] }
        : { op: old === undefined ? 'add' : 'replace', path: ['settings'], value: settings };
    const inv: Patch =
      old === undefined
        ? { op: 'remove', path: ['settings'] }
        : { op: settings === undefined ? 'add' : 'replace', path: ['settings'], value: old };
    this.record(fwd, inv);
  }

  // --- internals ----------------------------------------------------------

  private build(): BoardDocument {
    const doc: BoardDocument = {
      ...this.base,
      meta: this.meta,
      viewport: this.viewport,
      elements: this.elements,
      assets: this.assets,
      library: this.library,
    };
    if (this.settings === undefined) delete doc.settings;
    else doc.settings = this.settings;
    return doc;
  }

  private record(patch: Patch, inverse: Patch): void {
    this.patches.push(patch);
    this.inverse.push(inverse);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Transaction is closed');
  }

  private mutableElements(): Element[] {
    if (!this.ownEls) {
      this.elements = this.elements.slice();
      this.ownEls = true;
    }
    return this.elements;
  }

  private mutableAssets(): Asset[] {
    if (!this.ownAssets) {
      this.assets = this.assets.slice();
      this.ownAssets = true;
    }
    return this.assets;
  }

  private mutableLibrary(): LibraryComponent[] {
    if (!this.ownLib) {
      this.library = this.library.slice();
      this.ownLib = true;
    }
    return this.library;
  }

  private indexOf(id: ElementId): number | undefined {
    if (!this.index) {
      this.index = new Map();
      this.elements.forEach((el, i) => this.index?.set(el.id, i));
    }
    return this.index.get(id);
  }

  private requireIndex(id: ElementId): number {
    const i = this.indexOf(id);
    if (i === undefined) throw new Error(`Element not found: ${id}`);
    return i;
  }
}
