/** Pure keyboard-shortcut resolver (Req 5.2, 5.14). No DOM access. */

export interface KeyInfo {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** True when focus is in an input, textarea, select or contenteditable element. */
  inTextInput?: boolean;
}

/** Single-letter key -> tool id. */
export const TOOL_SHORTCUTS = {
  v: 'select',
  h: 'hand',
  r: 'rectangle',
  o: 'ellipse',
  d: 'diamond',
  l: 'line',
  a: 'arrow',
  p: 'freehand',
  t: 'text',
  i: 'image',
  f: 'frame',
  s: 'sticky',
  e: 'eraser',
} as const;

export type ShortcutToolId = (typeof TOOL_SHORTCUTS)[keyof typeof TOOL_SHORTCUTS];

/** Returns the tool a key press selects, or undefined when ignored. */
export function resolveToolShortcut(e: KeyInfo): ShortcutToolId | undefined {
  if (e.inTextInput || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return undefined;
  if (e.key.length !== 1) return undefined;
  return (TOOL_SHORTCUTS as Record<string, ShortcutToolId>)[e.key.toLowerCase()];
}

/** Whether a DOM element accepts typed text. */
export function isTextInputTarget(t: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export type KeyCommand =
  | { kind: 'tool'; tool: ShortcutToolId }
  | { kind: 'cancel' }
  | { kind: 'delete' }
  | { kind: 'nudge'; dx: number; dy: number; amount: 1 | 10 }
  | { kind: 'contextMenu' };

/** Resolves any non-palette-focus global key to a command. */
export function resolveKeyCommand(e: KeyInfo): KeyCommand | undefined {
  if (e.inTextInput) return undefined;
  if (e.key === 'Escape') return { kind: 'cancel' };
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) return { kind: 'contextMenu' };
  const mod = e.ctrlKey || e.metaKey || e.altKey;
  if (mod) return undefined;
  if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'delete' };
  const amount: 1 | 10 = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case 'ArrowLeft':
      return { kind: 'nudge', dx: -1, dy: 0, amount };
    case 'ArrowRight':
      return { kind: 'nudge', dx: 1, dy: 0, amount };
    case 'ArrowUp':
      return { kind: 'nudge', dx: 0, dy: -1, amount };
    case 'ArrowDown':
      return { kind: 'nudge', dx: 0, dy: 1, amount };
  }
  const tool = resolveToolShortcut(e);
  return tool ? { kind: 'tool', tool } : undefined;
}
