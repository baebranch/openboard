/**
 * Sync_Pass: regenerates the Instance_Children of every Component_Instance from its
 * Component_Master and Overrides. Pure: no vscode, DOM, or I/O.
 */
import type { BoardDocument, Element, ElementId, FrameElement } from '../model/types';
import { ROOT_OVERRIDE_KEY, type Override } from './types';

/** Longest allowed chain of nested Component_Instances (outermost to innermost). */
export const MAX_INSTANCE_DEPTH = 8;

/** Separator between an instance id and a master child id in an Instance_Child id. */
const SEP = '::';

export class ComponentCycleError extends Error {
  readonly masterIds: ElementId[];
  constructor(masterIds: ElementId[]) {
    super(`This would create a component cycle through: ${masterIds.join(', ')}`);
    this.name = 'ComponentCycleError';
    this.masterIds = masterIds;
  }
}

export class ComponentDepthError extends Error {
  readonly masterIds: ElementId[];
  constructor(masterIds: ElementId[]) {
    super(
      `Component instances can be nested at most ${MAX_INSTANCE_DEPTH} levels deep (masters: ${masterIds.join(', ')})`,
    );
    this.name = 'ComponentDepthError';
    this.masterIds = masterIds;
  }
}

export interface SyncResult {
  doc: BoardDocument;
  /** Ids created, replaced, moved in stacking order, or deleted by the pass. */
  changedIds: ElementId[];
}

/** Deterministic Instance_Child id. */
export function instanceChildId(instanceId: ElementId, masterChildId: ElementId): ElementId {
  return `${instanceId}${SEP}${masterChildId}`;
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

function isMaster(e: Element | undefined): e is FrameElement {
  return e !== undefined && e.type === 'frame' && e.component !== undefined;
}

function isInstance(e: Element): e is FrameElement {
  return e.type === 'frame' && e.instanceOf !== undefined;
}

/** True when `id` is derived from (a descendant of the id namespace of) the instance `ownerId`. */
function inNamespace(id: ElementId, ownerId: ElementId): boolean {
  return id.startsWith(ownerId + SEP);
}

/**
 * Ordered (document order) descendants of `master` that an instance copies. Instance_Children
 * of nested instances are skipped: they are regenerated from the nested instance's own master.
 */
function descendantsOf(master: Element, elements: readonly Element[], children: Map<ElementId, Element[]>): Element[] {
  const set = new Set<ElementId>();
  const visit = (node: Element): void => {
    for (const c of children.get(node.id) ?? []) {
      if (node.type === 'frame' && node.instanceOf !== undefined && inNamespace(c.id, node.id)) continue;
      if (set.has(c.id)) continue;
      set.add(c.id);
      visit(c);
    }
  };
  visit(master);
  // Edges that live inside the master by connection rather than by parent.
  const out: Element[] = [];
  for (const e of elements) {
    if (e.id === master.id) continue;
    if (set.has(e.id)) {
      out.push(e);
    } else if (e.type === 'edge') {
      const inside = (id: ElementId): boolean => set.has(id) || id === master.id;
      if (inside(e.sourceId) && inside(e.targetId) && !(e.sourceId === master.id && e.targetId === master.id)) {
        out.push(e);
      }
    }
  }
  return out;
}

function buildChildrenIndex(elements: readonly Element[]): Map<ElementId, Element[]> {
  const idx = new Map<ElementId, Element[]>();
  for (const e of elements) {
    if (e.parentId === undefined) continue;
    const list = idx.get(e.parentId);
    if (list) list.push(e);
    else idx.set(e.parentId, [e]);
  }
  return idx;
}

/** Validate the master-reference graph; throw on a cycle or a chain over the depth limit. */
function checkGraph(elements: readonly Element[], children: Map<ElementId, Element[]>): void {
  const byId = new Map<ElementId, Element>();
  for (const e of elements) byId.set(e.id, e);
  const levelOf = new Map<ElementId, number>();

  // Levels of nesting contained in a master (1 = the master holds no instances).
  const masterLevel = (masterId: ElementId, path: ElementId[]): number => {
    const cached = levelOf.get(masterId);
    if (cached !== undefined) return cached;
    const master = byId.get(masterId);
    if (!isMaster(master)) return 0;
    const at = path.indexOf(masterId);
    if (at >= 0) throw new ComponentCycleError(path.slice(at));
    const next = [...path, masterId];
    let deepest = 0;
    for (const d of descendantsOf(master, elements, children)) {
      if (d.type === 'frame' && d.instanceOf !== undefined) {
        deepest = Math.max(deepest, masterLevel(d.instanceOf, next));
      }
    }
    const level = deepest + 1;
    if (level > MAX_INSTANCE_DEPTH) throw new ComponentDepthError(next);
    levelOf.set(masterId, level);
    return level;
  };

  for (const e of elements) {
    if (!isInstance(e)) continue;
    const m = byId.get(e.instanceOf as ElementId);
    if (!isMaster(m)) continue;
    // Also throws when the instance sits inside the master it instantiates (a cycle).
    masterLevel(m.id, []);
  }
}

function applyOverride(c: Rec, o: Override): void {
  if (o.text !== undefined) {
    if (Array.isArray(c.runs)) {
      const first = (c.runs as Rec[])[0] ?? {};
      c.runs = [{ ...first, text: o.text }];
    } else if (c.type === 'edge') {
      c.label = o.text;
    }
  }
  const style = c.style as Rec;
  if (o.fill !== undefined) style.fill = o.fill;
  if (o.stroke !== undefined) style.stroke = o.stroke;
  if (o.opacity !== undefined) style.opacity = o.opacity;
  if (o.imageFill !== undefined) style.imageFill = structuredClone(o.imageFill);
  if (o.visible === false) style.opacity = 0;
  if (o.textColor !== undefined) c.textColor = o.textColor;
  if (o.fontWeight !== undefined) c.fontWeight = o.fontWeight;
  // Icon elements store the glyph in `name` (Req 14.4, 23.9).
  if (o.icon !== undefined && c.type === 'icon') c.name = o.icon;
}

function isLayoutFrame(e: Element | undefined): e is FrameElement & { layout: NonNullable<FrameElement['layout']> } {
  return e !== undefined && e.type === 'frame' && e.layout !== undefined;
}

/**
 * True when the Layout_Pass, not the master, decides `axis` of `e`: a `hug` Layout_Frame or
 * Text_Bearing_Element, or a `fill` element arranged by a Layout_Frame.
 */
function layoutOwnsAxis(e: Element, axis: 'width' | 'height', arranged: boolean): boolean {
  const m = e.sizing?.[axis];
  if (m === 'hug') return isLayoutFrame(e) || e.type === 'text' || e.type === 'sticky' || e.type === 'flowNode';
  return m === 'fill' && arranged;
}

/** Sizing of an instance of a Layout_Frame master: the master's, with overridden root axes `fixed`. */
function rootSizing(master: FrameElement, root: Override | undefined): FrameElement['sizing'] {
  const s = master.sizing;
  if (root?.width === undefined && root?.height === undefined) return s === undefined ? undefined : { ...s };
  return {
    width: root.width !== undefined ? 'fixed' : (s?.width ?? 'fixed'),
    height: root.height !== undefined ? 'fixed' : (s?.height ?? 'fixed'),
  };
}

/**
 * Expands one master descendant into an Instance_Child. Geometry follows the master, offset by
 * where the child's parent sits in the instance. Geometry the Layout_Pass owns (the position of an
 * arranged child, and hug or fill axes) keeps the current Instance_Child value, so an Override that
 * changes content (such as text) can resize and re-arrange the instance without the two passes
 * undoing each other.
 */
function buildChild(
  inst: FrameElement,
  master: FrameElement,
  d: Element,
  byId: ReadonlyMap<ElementId, Element>,
  built: ReadonlyMap<ElementId, Element>,
): Element {
  const c = structuredClone(d) as unknown as Rec;
  const prefixed = (id: ElementId): ElementId => instanceChildId(inst.id, id);
  const mapRef = (id: ElementId): ElementId => (id === master.id ? inst.id : prefixed(id));
  c.id = prefixed(d.id);
  if (d.parentId === undefined) delete c.parentId;
  else c.parentId = mapRef(d.parentId);
  c.x = d.x + (inst.x - master.x);
  c.y = d.y + (inst.y - master.y);
  const masterParent = d.parentId !== undefined ? byId.get(d.parentId) : undefined;
  if (d.type !== 'edge' && masterParent !== undefined && masterParent.id !== master.id) {
    const id = prefixed(masterParent.id);
    const counterpart = built.get(id) ?? byId.get(id);
    if (counterpart !== undefined) {
      c.x = counterpart.x + (d.x - masterParent.x);
      c.y = counterpart.y + (d.y - masterParent.y);
    }
  }
  const existing = byId.get(c.id as ElementId);
  if (existing !== undefined && existing.type === d.type && d.type !== 'edge') {
    const arranged = isLayoutFrame(masterParent) && d.ignoreLayout !== true;
    if (arranged) {
      c.x = existing.x;
      c.y = existing.y;
    }
    if (layoutOwnsAxis(d, 'width', arranged)) c.width = existing.width;
    if (layoutOwnsAxis(d, 'height', arranged)) c.height = existing.height;
  }
  delete c.component;
  if (typeof c.groupId === 'string') c.groupId = prefixed(c.groupId);
  if (d.type === 'edge') {
    c.sourceId = mapRef(d.sourceId);
    c.targetId = mapRef(d.targetId);
  }
  const o = inst.overrides?.[d.id];
  if (o) applyOverride(c, o);
  // A hidden master child hides everything beneath it, so its descendants stay invisible too.
  if (o?.visible !== false && hiddenAbove(inst, master, d, byId)) (c.style as Rec).opacity = 0;
  return c as unknown as Element;
}

/** True when an ancestor of `d` inside the master carries a `visible: false` Override on `inst`. */
function hiddenAbove(inst: FrameElement, master: FrameElement, d: Element, byId: ReadonlyMap<ElementId, Element>): boolean {
  if (inst.overrides === undefined) return false;
  const seen = new Set<ElementId>();
  let pid = d.parentId;
  while (pid !== undefined && pid !== master.id && !seen.has(pid)) {
    seen.add(pid);
    if (inst.overrides[pid]?.visible === false) return true;
    pid = byId.get(pid)?.parentId;
  }
  return false;
}

/** Root keys of an instance's own style that follow the master (all style except `extra`). */
function rootStyle(inst: FrameElement, master: FrameElement, root: Override | undefined): FrameElement['style'] {
  if (master.style === undefined) return inst.style;
  const style = structuredClone(master.style) as unknown as Rec;
  if (inst.style?.extra !== undefined) style.extra = inst.style.extra;
  else delete style.extra;
  if (root?.fill !== undefined) style.fill = root.fill;
  if (root?.stroke !== undefined) style.stroke = root.stroke;
  if (root?.opacity !== undefined) style.opacity = root.opacity;
  if (root?.imageFill !== undefined) style.imageFill = structuredClone(root.imageFill);
  return style as unknown as FrameElement['style'];
}

/** Ids that belong to `inst` but are no longer produced by the expansion. */
function isOrphan(id: ElementId, instId: ElementId, expected: Set<ElementId>): boolean {
  if (!inNamespace(id, instId)) return false;
  const rest = id.slice(instId.length + SEP.length);
  const cut = rest.indexOf(SEP);
  if (cut < 0) return !expected.has(id);
  return !expected.has(instId + SEP + rest.slice(0, cut));
}

export function syncPass(doc: BoardDocument): SyncResult {
  let els: Element[] = doc.elements.slice();
  const changed = new Set<ElementId>();
  const changedOrder: ElementId[] = [];
  const mark = (id: ElementId): void => {
    if (!changed.has(id)) {
      changed.add(id);
      changedOrder.push(id);
    }
  };

  checkGraph(els, buildChildrenIndex(els));

  // Nested instances appear one level per round; the depth limit bounds the rounds.
  for (let round = 0; round <= MAX_INSTANCE_DEPTH + 1; round++) {
    const byId = new Map<ElementId, Element>();
    for (const e of els) byId.set(e.id, e);
    const children = buildChildrenIndex(els);
    const instances = els.filter(isInstance).filter((i) => isMaster(byId.get(i.instanceOf as ElementId)));
    const before = changedOrder.length;
    let roundChanged = false;

    for (const instSnapshot of instances) {
      const master = byId.get(instSnapshot.instanceOf as ElementId) as FrameElement;
      const instIdx = els.findIndex((e) => e.id === instSnapshot.id);
      if (instIdx < 0) continue; // deleted earlier in this round
      let inst = els[instIdx] as FrameElement;

      // Root size. An instance of a Layout_Frame master is itself a Layout_Frame with the master's
      // layout and sizing; a root size Override fixes that axis. Axes the Layout_Pass resolves
      // (hug, or fill inside an arranging parent) keep the instance's current size.
      const root = inst.overrides?.[ROOT_OVERRIDE_KEY];
      let next: FrameElement = inst;
      if (master.layout !== undefined) {
        const sizing = rootSizing(master, root);
        if (!deepEqual(inst.layout, master.layout) || !deepEqual(inst.sizing, sizing)) {
          next = { ...next, layout: structuredClone(master.layout), sizing };
          if (sizing === undefined) delete (next as Partial<FrameElement>).sizing;
        }
      }
      // Root style (fill, stroke, radii, opacity ...) follows the master unless a root Override sets it.
      // A nested instance (itself an Instance_Child) takes its style from the outer expansion instead,
      // which copies the already-synced instance inside the outer master plus the outer Overrides, so
      // the two never fight over the same fields.
      if (!inst.id.includes(SEP)) {
        const style = rootStyle(inst, master, root);
        if (!deepEqual(inst.style, style)) next = { ...next, style };
      }
      const parent = inst.parentId !== undefined ? byId.get(inst.parentId) : undefined;
      const arranged = isLayoutFrame(parent) && inst.ignoreLayout !== true;
      const owned = (axis: 'width' | 'height'): boolean =>
        master.layout !== undefined && root?.[axis] === undefined && layoutOwnsAxis(master, axis, arranged);
      const width = owned('width') ? inst.width : (root?.width ?? master.width);
      const height = owned('height') ? inst.height : (root?.height ?? master.height);
      if (next.width !== width || next.height !== height) next = { ...next, width, height };
      if (next !== inst) {
        inst = next;
        els[instIdx] = inst;
        mark(inst.id);
        roundChanged = true;
      }

      const desc = descendantsOf(master, els, children).filter((d) => d.id !== inst.id);
      const built = new Map<ElementId, Element>();
      const expansion = desc.map((d) => {
        const child = buildChild(inst, master, d, byId, built);
        built.set(child.id, child);
        return child;
      });
      const expected = new Set(expansion.map((e) => e.id));

      // Delete orphaned Instance_Children and the Edges attached to them.
      const orphanIds = new Set<ElementId>();
      for (const e of els) if (isOrphan(e.id, inst.id, expected)) orphanIds.add(e.id);
      if (orphanIds.size > 0) {
        els = els.filter((e) => {
          const drop = orphanIds.has(e.id) || (e.type === 'edge' && (orphanIds.has(e.sourceId) || orphanIds.has(e.targetId)));
          if (drop) mark(e.id);
          return !drop;
        });
        roundChanged = true;
      }

      // Replace in place or insert missing children.
      const final: Element[] = [];
      let prevId: ElementId = inst.id;
      for (const next of expansion) {
        const at = els.findIndex((e) => e.id === next.id);
        if (at >= 0) {
          const keep = deepEqual(els[at], next) ? els[at]! : next;
          if (keep !== els[at]) {
            els[at] = keep;
            mark(next.id);
            roundChanged = true;
          }
          final.push(keep);
        } else {
          const after = els.findIndex((e) => e.id === prevId);
          els.splice(after + 1, 0, next);
          mark(next.id);
          roundChanged = true;
          final.push(next);
        }
        prevId = next.id;
      }

      // Keep the master's relative stacking order across the slots the children occupy.
      const slots: number[] = [];
      els.forEach((e, i) => {
        if (expected.has(e.id)) slots.push(i);
      });
      slots.sort((a, b) => a - b);
      slots.forEach((slot, j) => {
        const want = final[j]!;
        if (els[slot]!.id !== want.id) {
          els[slot] = want;
          mark(want.id);
          roundChanged = true;
        }
      });
    }

    if (!roundChanged && changedOrder.length === before) break;
  }

  if (changedOrder.length === 0) return { doc, changedIds: [] };
  // Ids that were created and later deleted again need not be reported as changes.
  return { doc: { ...doc, elements: els }, changedIds: changedOrder };
}
