import type { ToolId } from '../uiState';

export interface PaletteTool {
  id: ToolId;
  label: string;
  shortcut: string;
}

/** The 13 palette tools in display order. Labels are unique and non-empty. */
export const PALETTE_TOOLS: readonly PaletteTool[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'hand', label: 'Hand', shortcut: 'H' },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O' },
  { id: 'diamond', label: 'Diamond', shortcut: 'D' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A' },
  { id: 'freehand', label: 'Freehand', shortcut: 'P' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'image', label: 'Image', shortcut: 'I' },
  { id: 'frame', label: 'Frame', shortcut: 'F' },
  { id: 'sticky', label: 'Sticky Note', shortcut: 'S' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
];

/** Roving-tabindex focus target after an arrow/Home/End key; undefined when the key is not handled. */
export function nextToolIndex(current: number, count: number, key: string): number | undefined {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/** Tab / Shift+Tab selection traversal in z-order; wraps around. */
export function nextSelectionId(order: readonly string[], selection: readonly string[], backwards: boolean): string | undefined {
  if (order.length === 0) return undefined;
  const cur = selection.length > 0 ? order.indexOf(selection[selection.length - 1]!) : -1;
  if (cur < 0) return backwards ? order[order.length - 1] : order[0];
  return order[(cur + (backwards ? -1 : 1) + order.length) % order.length];
}
