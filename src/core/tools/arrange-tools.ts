/**
 * `openboard.element.arrange` (Req 5.6 - 5.10, 5.13): group, ungroup, align, distribute, z-order,
 * duplicate, copy, cut, paste and nudge behind one `action` discriminator.
 * The handler is synchronous and mutates only through the transaction it is given. When its
 * preconditions fail it changes nothing, returns `changed: false`, and the (patch-less)
 * transaction records no history entry.
 */
import { newId, round2, unionBounds } from '../model';
import type { Element, ElementId, ZOrderMode } from '../model';
import type { ElementInput, ElementPatch, Tx } from '../ops';
import { s } from '../schema/builder';
import { planComponentClone, remapComponentFields } from '../components/remap';
import { descendantsOf, frameNestingProblem } from '../shapes';
import type { DefaultToolRegistry, ToolContext, ToolDefinition } from './registry';

export const ARRANGE_ACTIONS = [
  'group',
  'ungroup',
  'align',
  'distribute',
  'zorder',
  'duplicate',
  'copy',
  'cut',
  'paste',
  'nudge',
  'moveIntoFrame',
  'moveOutOfFrame',
] as const;
export type ArrangeAction = (typeof ARRANGE_ACTIONS)[number];

const ALIGNMENTS = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
const DISTRIBUTIONS = ['horizontal', 'vertical'] as const;
const ZORDER_MODES = ['front', 'back', 'forward', 'backward'] as const;
const NUDGE_AMOUNTS = [1, 10] as const;

/** Offset applied to duplicated elements so they do not sit exactly on the originals. */
export const DUPLICATE_OFFSET = 20;

export interface Clipboard {
  elements: Element[];
}

export interface ArrangeInput {
  board?: string;
  action: ArrangeAction;
  ids?: string[];
  alignment?: (typeof ALIGNMENTS)[number];
  direction?: (typeof DISTRIBUTIONS)[number];
  mode?: ZOrderMode;
  clipboard?: Clipboard;
  /** Paste offset. */
  offset?: { x?: number; y?: number };
  dx?: number;
  dy?: number;
  /** Pixels per nudge step: 1 or 10 (default 1). */
  amount?: 1 | 10;
  /** Target Frame for `moveIntoFrame`. */
  targetId?: string;
}

export interface ArrangeOutput {
  changed: boolean;
  ids: string[];
  clipboard?: Clipboard;
  deleted?: string[];
}

class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function needTx(ctx: ToolContext): Tx {
  if (!ctx.tx) throw new ToolFailure('no_board', 'No board is available for this tool');
  return ctx.tx;
}

const clone = <T>(v: T): T => structuredClone(v);

function selected(tx: Tx, ids: readonly string[] | undefined): Element[] {
  const wanted = new Set(ids ?? []);
  if (wanted.size === 0) return [];
  const known = new Set(tx.doc.elements.map((e) => e.id));
  const missing = [...wanted].filter((id) => !known.has(id));
  if (missing.length > 0) throw new ToolFailure('not_found', `Element not found: ${missing.join(', ')}`);
  return tx.doc.elements.filter((e) => wanted.has(e.id));
}

function need<K extends keyof ArrangeInput>(input: ArrangeInput, key: K): NonNullable<ArrangeInput[K]> {
  const v = input[key];
  if (v === undefined || v === null) {
    throw new ToolFailure('invalid_input', `"${String(key)}" is required for action "${input.action}"`);
  }
  return v as NonNullable<ArrangeInput[K]>;
}

/** Moves elements to new x/y, skipping those already there. Returns the number moved. */
function moveTo(tx: Tx, targets: Map<ElementId, { x?: number; y?: number }>): number {
  let moved = 0;
  for (const el of tx.doc.elements.filter((e) => targets.has(e.id))) {
    const t = targets.get(el.id) as { x?: number; y?: number };
    const patch: ElementPatch = {};
    if (t.x !== undefined && round2(t.x) !== el.x) patch.x = round2(t.x);
    if (t.y !== undefined && round2(t.y) !== el.y) patch.y = round2(t.y);
    if (Object.keys(patch).length === 0) continue;
    tx.update(el.id, patch);
    moved++;
  }
  return moved;
}

function result(changed: boolean, ids: readonly string[], extra: Partial<ArrangeOutput> = {}): ArrangeOutput {
  return { changed, ids: [...ids], ...extra };
}

// --- actions ------------------------------------------------------------------------------------

function group(tx: Tx, picked: Element[]): ArrangeOutput {
  const ids = picked.map((e) => e.id);
  if (picked.length < 2) return result(false, ids);
  const groupId = newId();
  for (const el of picked) tx.update(el.id, { groupId });
  return result(true, ids);
}

function ungroup(tx: Tx, picked: Element[]): ArrangeOutput {
  const groups = new Set(picked.map((e) => e.groupId).filter((g): g is string => g !== undefined));
  if (groups.size === 0) return result(false, picked.map((e) => e.id));
  const members = tx.doc.elements.filter((e) => e.groupId !== undefined && groups.has(e.groupId));
  for (const el of members) tx.update(el.id, { groupId: undefined });
  return result(true, members.map((e) => e.id));
}

function align(tx: Tx, picked: Element[], how: NonNullable<ArrangeInput['alignment']>): ArrangeOutput {
  const ids = picked.map((e) => e.id);
  if (picked.length < 2) return result(false, ids);
  const b = unionBounds(picked) as NonNullable<ReturnType<typeof unionBounds>>;
  const targets = new Map<ElementId, { x?: number; y?: number }>();
  for (const el of picked) {
    switch (how) {
      case 'left':
        targets.set(el.id, { x: b.x });
        break;
      case 'center':
        targets.set(el.id, { x: b.x + (b.width - el.width) / 2 });
        break;
      case 'right':
        targets.set(el.id, { x: b.x + b.width - el.width });
        break;
      case 'top':
        targets.set(el.id, { y: b.y });
        break;
      case 'middle':
        targets.set(el.id, { y: b.y + (b.height - el.height) / 2 });
        break;
      case 'bottom':
        targets.set(el.id, { y: b.y + b.height - el.height });
        break;
    }
  }
  return result(moveTo(tx, targets) > 0, ids);
}

function distribute(tx: Tx, picked: Element[], dir: NonNullable<ArrangeInput['direction']>): ArrangeOutput {
  const ids = picked.map((e) => e.id);
  if (picked.length < 3) return result(false, ids);
  const horizontal = dir === 'horizontal';
  const pos = (e: Element) => (horizontal ? e.x : e.y);
  const size = (e: Element) => (horizontal ? e.width : e.height);
  const sorted = [...picked].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0] as Element;
  const last = sorted[sorted.length - 1] as Element;
  const span = pos(last) + size(last) - pos(first);
  const total = sorted.reduce((sum, e) => sum + size(e), 0);
  const gap = (span - total) / (sorted.length - 1);
  const targets = new Map<ElementId, { x?: number; y?: number }>();
  let cursor = pos(first) + size(first) + gap;
  for (const el of sorted.slice(1, -1)) {
    targets.set(el.id, horizontal ? { x: cursor } : { y: cursor });
    cursor += size(el) + gap;
  }
  return result(moveTo(tx, targets) > 0, ids);
}

function zorder(tx: Tx, picked: Element[], mode: ZOrderMode): ArrangeOutput {
  const ids = picked.map((e) => e.id);
  if (picked.length === 0) return result(false, ids);
  const before = tx.doc.elements.map((e) => e.id).join('\u0000');
  tx.reorder(ids, mode);
  const after = tx.doc.elements.map((e) => e.id).join('\u0000');
  return result(before !== after, ids);
}

/** Elements to copy: the selection plus edges whose both endpoints are in the selection. */
function copySet(tx: Tx, picked: Element[]): Element[] {
  const ids = new Set(picked.map((e) => e.id));
  const wanted = new Set(ids);
  for (const el of tx.doc.elements) {
    if (el.type === 'edge' && ids.has(el.sourceId) && ids.has(el.targetId)) wanted.add(el.id);
  }
  return tx.doc.elements.filter((e) => wanted.has(e.id)).map(clone);
}

/** Creates fresh-id copies of `source`, shifted by (dx, dy). Skips edges with a dangling endpoint. */
function instantiate(tx: Tx, source: readonly Element[], dx: number, dy: number): string[] {
  const plan = planComponentClone(source, tx.doc.elements);
  const idMap = new Map<string, string>(source.filter((e) => !plan.skip.has(e.id)).map((e) => [e.id, newId()]));
  const groupMap = new Map<string, string>();
  const existing = new Set(tx.doc.elements.map((e) => e.id));
  const created: string[] = [];
  for (const src of source) {
    if (plan.skip.has(src.id)) continue; // regenerated by the Sync_Pass with derived ids
    const el = clone(src) as Element & Record<string, unknown>;
    remapComponentFields(el, src, plan, idMap);
    if (el.type === 'edge') {
      if (plan.skip.has(el.sourceId) || plan.skip.has(el.targetId)) continue;
      const ends = [el.sourceId, el.targetId].map((id) => idMap.get(id) ?? (existing.has(id) ? id : undefined));
      if (ends[0] === undefined || ends[1] === undefined) continue;
      el.sourceId = ends[0];
      el.targetId = ends[1];
    }
    if (el.parentId !== undefined) {
      const p = idMap.get(el.parentId) ?? (existing.has(el.parentId) ? el.parentId : undefined);
      if (p === undefined) delete el.parentId;
      else el.parentId = p;
    }
    if (el.groupId !== undefined) {
      if (!groupMap.has(el.groupId)) groupMap.set(el.groupId, newId());
      el.groupId = groupMap.get(el.groupId) as string;
    }
    el.id = idMap.get(src.id) as string;
    el.x = round2(el.x + dx);
    el.y = round2(el.y + dy);
    tx.create(el as unknown as ElementInput);
    created.push(el.id);
  }
  const problem = frameNestingProblem(tx.doc.elements, created);
  if (problem !== undefined) throw new ToolFailure('invalid_parent', problem);
  return created;
}

function validClipboard(clip: Clipboard): Element[] {
  const list = clip.elements;
  if (!Array.isArray(list)) throw new ToolFailure('invalid_clipboard', 'clipboard.elements must be an array');
  for (const [i, e] of list.entries()) {
    const r = e as unknown as Record<string, unknown> | null;
    const ok =
      r !== null &&
      typeof r === 'object' &&
      typeof r['id'] === 'string' &&
      typeof r['type'] === 'string' &&
      ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number');
    if (!ok) throw new ToolFailure('invalid_clipboard', `clipboard.elements[${i}] is not a valid element`);
  }
  return list;
}

function nudge(tx: Tx, picked: Element[], input: ArrangeInput): ArrangeOutput {
  const ids = picked.map((e) => e.id);
  const step = input.amount ?? 1;
  const dx = (input.dx ?? 0) * step;
  const dy = (input.dy ?? 0) * step;
  if (picked.length === 0 || (dx === 0 && dy === 0)) return result(false, ids);
  const moving = new Map<ElementId, Element>(picked.map((e) => [e.id, e]));
  for (const el of picked) {
    if (el.type !== 'frame') continue;
    // An instance's Instance_Children follow through the Sync_Pass; its User_Children move here.
    const prefix = `${el.id}::`;
    for (const d of descendantsOf(el.id, tx.doc.elements)) if (!d.id.startsWith(prefix)) moving.set(d.id, d);
  }
  const targets = new Map<ElementId, { x?: number; y?: number }>();
  for (const el of moving.values()) targets.set(el.id, { x: el.x + dx, y: el.y + dy });
  return result(moveTo(tx, targets) > 0, ids);
}

/** True when an ancestor of `el` (following `parentId`) is in `ids`. */
function hasSelectedAncestor(el: Element, ids: ReadonlySet<ElementId>, byId: ReadonlyMap<ElementId, Element>): boolean {
  const seen = new Set<ElementId>();
  for (let p = el.parentId; p !== undefined && !seen.has(p); p = byId.get(p)?.parentId) {
    if (ids.has(p)) return true;
    seen.add(p);
  }
  return false;
}

/** Req 21.2: sets the target Frame as parent of each selected element not under another selected one. */
function moveIntoFrame(tx: Tx, picked: Element[], targetId: string): ArrangeOutput {
  const ids = picked.map((e) => e.id);
  const target = tx.doc.elements.find((e) => e.id === targetId);
  if (!target) throw new ToolFailure('not_found', `Element not found: ${targetId}`);
  if (target.type !== 'frame') throw new ToolFailure('invalid_parent', `Element ${targetId} is not a Frame.`);
  const byId = new Map(tx.doc.elements.map((e) => [e.id, e]));
  const idSet = new Set(ids);
  const movers = picked.filter((e) => e.type !== 'edge' && !hasSelectedAncestor(e, idSet, byId));
  const changed = movers.filter((e) => e.parentId !== targetId);
  for (const el of changed) tx.update(el.id, { parentId: targetId });
  if (changed.length > 0) {
    const problem = frameNestingProblem(tx.doc.elements, changed.map((e) => e.id));
    if (problem !== undefined) throw new ToolFailure('invalid_parent', problem);
  }
  return result(changed.length > 0, ids);
}

/** Req 21.3: re-parents each selected element to its parent Frame's own parent (or clears it). */
function moveOutOfFrame(tx: Tx, picked: Element[]): ArrangeOutput {
  const ids = picked.map((e) => e.id);
  const byId = new Map(tx.doc.elements.map((e) => [e.id, e]));
  const moves: Array<[Element, ElementId | undefined]> = [];
  for (const el of picked) {
    if (el.parentId === undefined) continue;
    const parent = byId.get(el.parentId);
    if (parent?.type !== 'frame') continue;
    moves.push([el, parent.parentId]);
  }
  for (const [el, next] of moves) tx.update(el.id, { parentId: next });
  if (moves.length > 0) {
    const problem = frameNestingProblem(tx.doc.elements, moves.map(([e]) => e.id));
    if (problem !== undefined) throw new ToolFailure('invalid_parent', problem);
  }
  return result(moves.length > 0, ids);
}

// --- tool ---------------------------------------------------------------------------------------

const arrangeTool: ToolDefinition<ArrangeInput, ArrangeOutput> = {
  name: 'openboard.element.arrange',
  description:
    'Arrange elements selected by `ids`. `action`: group | ungroup | align (`alignment` left|center|right|top|middle|bottom, 2+ elements, to selection bounds) | distribute (`direction` horizontal|vertical, 3+ elements, outer two stay) | zorder (`mode` front|back|forward|backward) | duplicate | copy (returns `clipboard`) | cut (copy then delete; destructive) | paste (`clipboard`, optional `offset` {x,y}) | nudge (`dx`/`dy` steps times `amount` 1 or 10 px) | moveIntoFrame (`targetId` Frame becomes parent of each selected element, including Frames, except those whose ancestor is also selected) | moveOutOfFrame (each selected element takes its parent Frame\'s parent, or none). Nesting: no cycles, depth at most 16, parent must be a Frame, else the whole edit is rejected. Returns `changed`; when preconditions fail nothing changes and no history entry is added.',
  inputSchema: s.object({
    board: s.opt(s.string({ minLength: 1 })),
    action: s.enum(ARRANGE_ACTIONS),
    ids: s.opt(s.array(s.string({ minLength: 1 }), { maxItems: 1000 })),
    alignment: s.opt(s.enum(ALIGNMENTS)),
    direction: s.opt(s.enum(DISTRIBUTIONS)),
    mode: s.opt(s.enum(ZORDER_MODES)),
    clipboard: s.opt(s.object({ elements: s.array(s.object({})) })),
    offset: s.opt(s.object({ x: s.opt(s.number()), y: s.opt(s.number()) })),
    dx: s.opt(s.number()),
    dy: s.opt(s.number()),
    amount: s.opt(s.enum(NUDGE_AMOUNTS)),
    targetId: s.opt(s.string({ minLength: 1 })),
  }),
  outputSchema: s.object({
    changed: s.boolean(),
    ids: s.array(s.string()),
    clipboard: s.opt(s.object({ elements: s.array(s.object({})) })),
    deleted: s.opt(s.array(s.string())),
  }),
  destructive: true,
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = needTx(ctx);
    if (input.action === 'paste') {
      const source = validClipboard(need(input, 'clipboard'));
      if (source.length === 0) return result(false, []);
      const created = instantiate(tx, source, input.offset?.x ?? 0, input.offset?.y ?? 0);
      return result(created.length > 0, created);
    }
    const picked = selected(tx, input.ids);
    const ids = picked.map((e) => e.id);
    switch (input.action) {
      case 'group':
        return group(tx, picked);
      case 'ungroup':
        return ungroup(tx, picked);
      case 'align':
        return align(tx, picked, need(input, 'alignment'));
      case 'distribute':
        return distribute(tx, picked, need(input, 'direction'));
      case 'zorder':
        return zorder(tx, picked, need(input, 'mode'));
      case 'duplicate': {
        if (picked.length === 0) return result(false, ids);
        const created = instantiate(tx, copySet(tx, picked), DUPLICATE_OFFSET, DUPLICATE_OFFSET);
        return result(created.length > 0, created);
      }
      case 'copy':
        return result(false, ids, { clipboard: { elements: copySet(tx, picked) } });
      case 'cut': {
        if (picked.length === 0) return result(false, ids, { clipboard: { elements: [] }, deleted: [] });
        const clipboard = { elements: copySet(tx, picked) };
        const before = tx.doc.elements.map((e) => e.id);
        for (const id of ids) if (tx.doc.elements.some((e) => e.id === id)) tx.remove(id);
        const after = new Set(tx.doc.elements.map((e) => e.id));
        return result(true, ids, { clipboard, deleted: before.filter((id) => !after.has(id)) });
      }
      case 'nudge':
        return nudge(tx, picked, input);
      case 'moveIntoFrame':
        return moveIntoFrame(tx, picked, need(input, 'targetId'));
      case 'moveOutOfFrame':
        return moveOutOfFrame(tx, picked);
    }
  },
};

export const arrangeTools: ToolDefinition[] = [arrangeTool];

export function registerArrangeTools(registry: Pick<DefaultToolRegistry, 'register'>): void {
  for (const t of arrangeTools) registry.register(t);
}
