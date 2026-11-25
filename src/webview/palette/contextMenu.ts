/** Pure context-menu model (Req 5.12): only actions applicable to the target are listed. */
import { ActionId } from '../actions';

export interface ContextMenuCtx {
  /** Ids the menu acts on: element under pointer (or the selection containing it), empty for canvas. */
  targetIds: readonly string[];
  /** True when any targeted element belongs to a group. */
  grouped: boolean;
  hasClipboard: boolean;
  readOnly?: boolean;
  /** Total elements on the board (for select-all). */
  elementCount?: number;
}

export interface ContextMenuItem {
  /** An ActionId, or 'select-all' (handled locally by selection state). */
  id: ActionId | 'select-all';
  label: string;
}

const LABELS: Partial<Record<ActionId | 'select-all', string>> = {
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

export function buildContextMenu(ctx: ContextMenuCtx): ContextMenuItem[] {
  const ids: (ActionId | 'select-all')[] = [];
  const n = ctx.targetIds.length;
  if (ctx.readOnly) {
    if (n > 0) ids.push(ActionId.Copy);
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
    ids.push(ActionId.BringToFront, ActionId.BringForward, ActionId.SendBackward, ActionId.SendToBack);
    ids.push('select-all');
  }
  return ids.map((id) => ({ id, label: LABELS[id] ?? String(id) }));
}
