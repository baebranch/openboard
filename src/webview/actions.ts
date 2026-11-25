/**
 * Every user-facing webview action, mapped to the registry tool that performs it and a pure
 * builder for that tool's input (Req 5.12, 5.13, 5.14). Test 19.2 checks each tool exists.
 */

export const ActionId = {
  Copy: 'copy',
  Cut: 'cut',
  Paste: 'paste',
  Duplicate: 'duplicate',
  Delete: 'delete',
  Group: 'group',
  Ungroup: 'ungroup',
  AlignLeft: 'align-left',
  AlignCenter: 'align-center',
  AlignRight: 'align-right',
  AlignTop: 'align-top',
  AlignMiddle: 'align-middle',
  AlignBottom: 'align-bottom',
  DistributeHorizontal: 'distribute-horizontal',
  DistributeVertical: 'distribute-vertical',
  BringToFront: 'bring-to-front',
  BringForward: 'bring-forward',
  SendBackward: 'send-backward',
  SendToBack: 'send-to-back',
  Nudge: 'nudge',
} as const;
export type ActionId = (typeof ActionId)[keyof typeof ActionId];

export interface ActionContext {
  ids: readonly string[];
  /** Clipboard payload (opaque to the UI). */
  clipboard?: unknown;
  /** Paste offset, board coordinates. */
  offset?: { x: number; y: number };
  /** Nudge step counts; amount is 1 or 10 px. */
  dx?: number;
  dy?: number;
  amount?: 1 | 10;
}

export interface ActionSpec {
  label: string;
  tool: 'openboard.element.arrange' | 'openboard.element.delete';
  build(ctx: ActionContext): Record<string, unknown>;
}

const arrange = (label: string, extra: (c: ActionContext) => Record<string, unknown>, action: string): ActionSpec => ({
  label,
  tool: 'openboard.element.arrange',
  build: (c) => ({ action, ids: [...c.ids], ...extra(c) }),
});
const none = (): Record<string, unknown> => ({});

export const ACTIONS: Readonly<Record<ActionId, ActionSpec>> = {
  [ActionId.Copy]: arrange('Copy', none, 'copy'),
  [ActionId.Cut]: arrange('Cut', none, 'cut'),
  [ActionId.Paste]: arrange(
    'Paste',
    (c) => ({ clipboard: c.clipboard, ...(c.offset ? { offset: c.offset } : {}) }),
    'paste',
  ),
  [ActionId.Duplicate]: arrange('Duplicate', none, 'duplicate'),
  [ActionId.Delete]: { label: 'Delete', tool: 'openboard.element.delete', build: (c) => ({ ids: [...c.ids] }) },
  [ActionId.Group]: arrange('Group', none, 'group'),
  [ActionId.Ungroup]: arrange('Ungroup', none, 'ungroup'),
  [ActionId.AlignLeft]: arrange('Align left', () => ({ alignment: 'left' }), 'align'),
  [ActionId.AlignCenter]: arrange('Align center', () => ({ alignment: 'center' }), 'align'),
  [ActionId.AlignRight]: arrange('Align right', () => ({ alignment: 'right' }), 'align'),
  [ActionId.AlignTop]: arrange('Align top', () => ({ alignment: 'top' }), 'align'),
  [ActionId.AlignMiddle]: arrange('Align middle', () => ({ alignment: 'middle' }), 'align'),
  [ActionId.AlignBottom]: arrange('Align bottom', () => ({ alignment: 'bottom' }), 'align'),
  [ActionId.DistributeHorizontal]: arrange('Distribute horizontally', () => ({ direction: 'horizontal' }), 'distribute'),
  [ActionId.DistributeVertical]: arrange('Distribute vertically', () => ({ direction: 'vertical' }), 'distribute'),
  [ActionId.BringToFront]: arrange('Bring to front', () => ({ mode: 'front' }), 'zorder'),
  [ActionId.BringForward]: arrange('Bring forward', () => ({ mode: 'forward' }), 'zorder'),
  [ActionId.SendBackward]: arrange('Send backward', () => ({ mode: 'backward' }), 'zorder'),
  [ActionId.SendToBack]: arrange('Send to back', () => ({ mode: 'back' }), 'zorder'),
  [ActionId.Nudge]: arrange(
    'Nudge',
    (c) => ({ dx: c.dx ?? 0, dy: c.dy ?? 0, amount: c.amount ?? 1 }),
    'nudge',
  ),
};

export function buildAction(id: ActionId, ctx: ActionContext): { tool: ActionSpec['tool']; input: Record<string, unknown> } {
  const spec = ACTIONS[id];
  return { tool: spec.tool, input: spec.build(ctx) };
}
