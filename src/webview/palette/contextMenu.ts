/** Pure context-menu model (Req 5.12): only actions applicable to the target are listed. */
import { uniqueComponentName } from '../../core/components/names';
import type { Element, FrameElement } from '../../core/model';
import { ActionId } from '../actions';
import { t } from '../i18n/t';

/** Component menu entries (Req 26.8, 26.11); each maps to a component tool or a local view action. */
export const ComponentMenuId = {
  Create: 'create-component',
  Remove: 'remove-component',
  Detach: 'detach-instance',
  ResetOverrides: 'reset-overrides',
  GoToMaster: 'go-to-master',
} as const;
export type ComponentMenuId = (typeof ComponentMenuId)[keyof typeof ComponentMenuId];

/** Frame nesting entries (Req 21.2, 21.3, 26.8, 26.11); each maps to an `element.arrange` action. */
export const FrameMenuId = {
  MoveInto: 'move-into-frame',
  MoveOut: 'move-out-of-frame',
} as const;
export type FrameMenuId = (typeof FrameMenuId)[keyof typeof FrameMenuId];

const FRAME_LABEL_KEYS: Record<FrameMenuId, string> = {
  [FrameMenuId.MoveInto]: 'Move into Frame',
  [FrameMenuId.MoveOut]: 'Move out of Frame',
};

export function isFrameMenuId(id: string): id is FrameMenuId {
  return Object.prototype.hasOwnProperty.call(FRAME_LABEL_KEYS, id);
}

export type ContextMenuItemId = ActionId | 'select-all' | ComponentMenuId | FrameMenuId;

export interface ContextMenuCtx {
  /** Ids the menu acts on: element under pointer (or the selection containing it), empty for canvas. */
  targetIds: readonly string[];
  /** True when any targeted element belongs to a group. */
  grouped: boolean;
  hasClipboard: boolean;
  readOnly?: boolean;
  /** Total elements on the board (for select-all). */
  elementCount?: number;
  /** Board elements; enables the component entries. Omitted means no component entries. */
  elements?: readonly Element[];
}

export interface ContextMenuItem {
  /** An ActionId, a component entry, or 'select-all' (handled locally by selection state). */
  id: ContextMenuItemId;
  label: string;
}

const LABELS: Partial<Record<ContextMenuItemId, string>> = {
  [ActionId.Copy]: 'Copy',
  [ActionId.Cut]: 'Cut',
  [ActionId.Paste]: 'Paste',
  [ActionId.Duplicate]: 'Duplicate',
  [ActionId.Delete]: 'Delete',
  [ActionId.Group]: 'Group',
  [ActionId.Ungroup]: 'Ungroup',
  [ActionId.AlignLeft]: 'Align left',
  [ActionId.AlignCenter]: 'Align center',
  [ActionId.AlignRight]: 'Align right',
  [ActionId.AlignTop]: 'Align top',
  [ActionId.AlignMiddle]: 'Align middle',
  [ActionId.AlignBottom]: 'Align bottom',
  [ActionId.DistributeHorizontal]: 'Distribute horizontally',
  [ActionId.DistributeVertical]: 'Distribute vertically',
  [ActionId.BringToFront]: 'Bring to front',
  [ActionId.BringForward]: 'Bring forward',
  [ActionId.SendBackward]: 'Send backward',
  [ActionId.SendToBack]: 'Send to back',
  'select-all': 'Select all',
};

/** Component entry labels; keys are the English strings in l10n/bundle.l10n.json. */
const COMPONENT_LABEL_KEYS: Record<ComponentMenuId, string> = {
  [ComponentMenuId.Create]: 'Create Component',
  [ComponentMenuId.Remove]: 'Remove Component',
  [ComponentMenuId.Detach]: 'Detach Instance',
  [ComponentMenuId.ResetOverrides]: 'Reset Overrides',
  [ComponentMenuId.GoToMaster]: 'Go to master',
};

export function isComponentMenuId(id: string): id is ComponentMenuId {
  return Object.prototype.hasOwnProperty.call(COMPONENT_LABEL_KEYS, id);
}

/** Instance_Children carry derived ids `<instanceId>::<masterChildId>` and cannot be edited directly. */
function isInstanceChildId(id: string): boolean {
  const at = id.lastIndexOf('::');
  return at > 0 && at + 2 < id.length;
}

function frameById(elements: readonly Element[], id: string): FrameElement | undefined {
  const el = elements.find((e) => e.id === id);
  return el && el.type === 'frame' ? el : undefined;
}

/**
 * Component entries that apply to `ids`, mirroring the preconditions of the matching tools so a
 * disallowed selection never lists an entry that would only error (Req 26.11).
 */
export function componentMenuIds(
  elements: readonly Element[],
  ids: readonly string[],
  readOnly = false,
): ComponentMenuId[] {
  const out: ComponentMenuId[] = [];
  if (ids.length === 0) return out;
  const picked = ids.map((id) => elements.find((e) => e.id === id));
  if (picked.some((e) => e === undefined)) return out;
  const els = picked as Element[];

  if (els.length === 1) {
    const only = els[0] as Element;
    if (only.type === 'frame' && only.instanceOf !== undefined) {
      const master = frameById(elements, only.instanceOf);
      if (master && master.component !== undefined) out.push(ComponentMenuId.GoToMaster);
      if (!readOnly) {
        out.push(ComponentMenuId.Detach);
        if (only.overrides && Object.keys(only.overrides).length > 0) out.push(ComponentMenuId.ResetOverrides);
      }
      return out;
    }
  }
  if (readOnly) return out;

  if (els.length === 1 && els[0]?.type === 'frame' && els[0].component !== undefined) {
    out.push(ComponentMenuId.Remove);
    return out;
  }
  // Create: one plain Frame, or only non-Frame elements; nothing that is part of an instance.
  if (els.some((e) => isInstanceChildId(e.id))) return out;
  const frames = els.filter((e) => e.type === 'frame');
  if (frames.length === 0 || (frames.length === 1 && els.length === 1)) out.push(ComponentMenuId.Create);
  return out;
}

/** Default master name for "Create Component": the Frame's name, else "Component", made unique. */
export function defaultComponentName(elements: readonly Element[], ids: readonly string[]): string {
  const only = ids.length === 1 ? frameById(elements, ids[0] as string) : undefined;
  const base = (only?.name ?? '').trim() || 'Component';
  const names: string[] = [];
  for (const e of elements) if (e.type === 'frame' && e.component !== undefined) names.push(e.component);
  return uniqueComponentName(base.slice(0, 100), names);
}

/** Tool call for a component entry, or undefined for "Go to master" (a view action, no tool). */
export function buildComponentOp(
  id: ComponentMenuId,
  elements: readonly Element[],
  ids: readonly string[],
): { tool: string; input: Record<string, unknown> } | undefined {
  const first = ids[0] as string;
  switch (id) {
    case ComponentMenuId.Create:
      return { tool: 'openboard.component.create', input: { ids: [...ids], name: defaultComponentName(elements, ids) } };
    case ComponentMenuId.Remove:
      return { tool: 'openboard.component.remove', input: { id: first } };
    case ComponentMenuId.Detach:
      return { tool: 'openboard.component.instance.detach', input: { id: first } };
    case ComponentMenuId.ResetOverrides:
      return { tool: 'openboard.component.instance.override.reset', input: { id: first } };
    case ComponentMenuId.GoToMaster:
      return undefined;
  }
}

/** The master Frame of the single selected instance, if any. */
export function masterOf(elements: readonly Element[], id: string): FrameElement | undefined {
  const inst = frameById(elements, id);
  return inst?.instanceOf === undefined ? undefined : frameById(elements, inst.instanceOf);
}

/**
 * The Frame "Move into Frame" targets: the smallest Frame that fully contains the selection's
 * bounds, is not itself selected or inside the selection, and is not already the parent of every
 * mover. Undefined when there is none.
 */
export function moveIntoFrameTarget(elements: readonly Element[], ids: readonly string[]): string | undefined {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const picked = ids.map((id) => byId.get(id)).filter((e): e is Element => e !== undefined && e.type !== 'edge');
  if (picked.length === 0 || picked.length !== ids.length) return undefined;
  const sel = new Set(ids);
  const inSelection = (el: Element): boolean => {
    for (let cur: Element | undefined = el, n = 0; cur && n < 64; cur = cur.parentId ? byId.get(cur.parentId) : undefined, n++) {
      if (sel.has(cur.id)) return true;
    }
    return false;
  };
  const x1 = Math.min(...picked.map((e) => e.x));
  const y1 = Math.min(...picked.map((e) => e.y));
  const x2 = Math.max(...picked.map((e) => e.x + e.width));
  const y2 = Math.max(...picked.map((e) => e.y + e.height));
  let best: Element | undefined;
  for (const f of elements) {
    if (f.type !== 'frame' || inSelection(f) || isInstanceChildId(f.id)) continue;
    if (f.x > x1 || f.y > y1 || f.x + f.width < x2 || f.y + f.height < y2) continue;
    if (picked.every((e) => e.parentId === f.id)) continue;
    if (!best || f.width * f.height <= best.width * best.height) best = f;
  }
  return best?.id;
}

/** Frame entries that apply to `ids` (Req 26.11): only when the action would change something. */
export function frameMenuIds(elements: readonly Element[], ids: readonly string[]): FrameMenuId[] {
  const out: FrameMenuId[] = [];
  const picked = ids.map((id) => elements.find((e) => e.id === id));
  if (picked.length === 0 || picked.some((e) => e === undefined)) return out;
  const els = picked as Element[];
  if (els.some((e) => isInstanceChildId(e.id))) return out;
  if (moveIntoFrameTarget(elements, ids) !== undefined) out.push(FrameMenuId.MoveInto);
  if (els.some((e) => e.parentId !== undefined && frameById(elements, e.parentId) !== undefined)) out.push(FrameMenuId.MoveOut);
  return out;
}

/** Tool call for a Frame entry. */
export function buildFrameOp(
  id: FrameMenuId,
  elements: readonly Element[],
  ids: readonly string[],
): { tool: string; input: Record<string, unknown> } | undefined {
  if (id === FrameMenuId.MoveOut) return { tool: 'openboard.element.arrange', input: { action: 'moveOutOfFrame', ids: [...ids] } };
  const targetId = moveIntoFrameTarget(elements, ids);
  if (targetId === undefined) return undefined;
  return { tool: 'openboard.element.arrange', input: { action: 'moveIntoFrame', ids: [...ids], targetId } };
}

export function buildContextMenu(ctx: ContextMenuCtx): ContextMenuItem[] {
  const ids: ContextMenuItemId[] = [];
  const n = ctx.targetIds.length;
  const components = ctx.elements ? componentMenuIds(ctx.elements, ctx.targetIds, ctx.readOnly) : [];
  if (ctx.readOnly) {
    if (n > 0) ids.push(ActionId.Copy);
    ids.push(...components);
    if ((ctx.elementCount ?? 1) > 0) ids.push('select-all');
  } else if (n === 0) {
    if (ctx.hasClipboard) ids.push(ActionId.Paste);
    if ((ctx.elementCount ?? 1) > 0) ids.push('select-all');
  } else {
    ids.push(ActionId.Cut, ActionId.Copy);
    if (ctx.hasClipboard) ids.push(ActionId.Paste);
    ids.push(ActionId.Duplicate, ActionId.Delete);
    if (n >= 2) ids.push(ActionId.Group);
    if (ctx.grouped) ids.push(ActionId.Ungroup);
    if (n >= 2) {
      ids.push(
        ActionId.AlignLeft,
        ActionId.AlignCenter,
        ActionId.AlignRight,
        ActionId.AlignTop,
        ActionId.AlignMiddle,
        ActionId.AlignBottom,
      );
    }
    if (n >= 3) ids.push(ActionId.DistributeHorizontal, ActionId.DistributeVertical);
    ids.push(...components);
    if (ctx.elements) ids.push(...frameMenuIds(ctx.elements, ctx.targetIds));
    ids.push(ActionId.BringToFront, ActionId.BringForward, ActionId.SendBackward, ActionId.SendToBack);
    ids.push('select-all');
  }
  return ids.map((id) => ({
    id,
    label: isComponentMenuId(id)
      ? t(COMPONENT_LABEL_KEYS[id])
      : isFrameMenuId(id)
        ? t(FRAME_LABEL_KEYS[id])
        : (LABELS[id] ?? String(id)),
  }));
}
