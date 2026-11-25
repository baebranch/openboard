import { describe, expect, it } from 'vitest';
import { ACTIONS, ActionId, buildAction } from '../actions';
import { buildContextMenu } from './contextMenu';
import { PALETTE_TOOLS, nextSelectionId, nextToolIndex } from './tools';
import { TOOL_SHORTCUTS, resolveKeyCommand, resolveToolShortcut } from './shortcuts';

describe('shortcuts', () => {
  it('maps all 14 shortcuts', () => {
    expect(Object.keys(TOOL_SHORTCUTS)).toHaveLength(14);
    expect(resolveToolShortcut({ key: 'K' })).toBe('icon');
    expect(resolveToolShortcut({ key: 'v' })).toBe('select');
    expect(resolveToolShortcut({ key: 'P' })).toBe('freehand');
    expect(resolveToolShortcut({ key: 's' })).toBe('sticky');
  });
  it('ignores modifiers and text inputs', () => {
    expect(resolveToolShortcut({ key: 'r', ctrlKey: true })).toBeUndefined();
    expect(resolveToolShortcut({ key: 'r', metaKey: true })).toBeUndefined();
    expect(resolveToolShortcut({ key: 'r', altKey: true })).toBeUndefined();
    expect(resolveToolShortcut({ key: 'r', inTextInput: true })).toBeUndefined();
    expect(resolveKeyCommand({ key: 'Escape', inTextInput: true })).toBeUndefined();
  });
  it('resolves commands', () => {
    expect(resolveKeyCommand({ key: 'Escape' })).toEqual({ kind: 'cancel' });
    expect(resolveKeyCommand({ key: 'ArrowRight', shiftKey: true })).toEqual({ kind: 'nudge', dx: 1, dy: 0, amount: 10 });
    expect(resolveKeyCommand({ key: 'ArrowUp' })).toEqual({ kind: 'nudge', dx: 0, dy: -1, amount: 1 });
    expect(resolveKeyCommand({ key: 'Delete' })).toEqual({ kind: 'delete' });
    expect(resolveKeyCommand({ key: 'F10', shiftKey: true })).toEqual({ kind: 'contextMenu' });
    expect(resolveKeyCommand({ key: 'ContextMenu' })).toEqual({ kind: 'contextMenu' });
  });
});

describe('buildContextMenu', () => {
  const base = { targetIds: [], grouped: false, hasClipboard: false, elementCount: 3 };
  it('canvas menu', () => {
    expect(buildContextMenu(base).map((i) => i.id)).toEqual(['select-all']);
    expect(buildContextMenu({ ...base, hasClipboard: true }).map((i) => i.id)).toEqual([ActionId.Paste, 'select-all']);
  });
  it('single element lists only applicable actions', () => {
    const ids = buildContextMenu({ ...base, targetIds: ['a'] }).map((i) => i.id);
    expect(ids).toContain(ActionId.Delete);
    expect(ids).not.toContain(ActionId.Group);
    expect(ids).not.toContain(ActionId.Ungroup);
    expect(ids).not.toContain(ActionId.AlignLeft);
    expect(ids).not.toContain(ActionId.Paste);
  });
  it('multi selection adds group/align/distribute', () => {
    const two = buildContextMenu({ ...base, targetIds: ['a', 'b'] }).map((i) => i.id);
    expect(two).toContain(ActionId.Group);
    expect(two).toContain(ActionId.AlignLeft);
    expect(two).not.toContain(ActionId.DistributeHorizontal);
    const three = buildContextMenu({ ...base, targetIds: ['a', 'b', 'c'], grouped: true }).map((i) => i.id);
    expect(three).toContain(ActionId.DistributeVertical);
    expect(three).toContain(ActionId.Ungroup);
  });
  it('read-only offers no mutations', () => {
    const ids = buildContextMenu({ ...base, targetIds: ['a'], readOnly: true }).map((i) => i.id);
    expect(ids).not.toContain(ActionId.Delete);
  });
});

describe('tools', () => {
  it('has 14 unique labelled tools matching shortcut targets', () => {
    expect(PALETTE_TOOLS).toHaveLength(14);
    expect(new Set(PALETTE_TOOLS.map((t) => t.label)).size).toBe(14);
    expect(PALETTE_TOOLS.every((t) => t.label.length > 0)).toBe(true);
    expect(new Set(PALETTE_TOOLS.map((t) => t.id))).toEqual(new Set(Object.values(TOOL_SHORTCUTS)));
  });
  it('roving focus wraps and traversal wraps', () => {
    expect(nextToolIndex(13, 14, 'ArrowRight')).toBe(0);
    expect(nextToolIndex(0, 14, 'ArrowLeft')).toBe(13);
    expect(nextToolIndex(3, 14, 'x')).toBeUndefined();
    expect(nextSelectionId(['a', 'b'], ['b'], false)).toBe('a');
    expect(nextSelectionId(['a', 'b'], [], true)).toBe('b');
  });
});

describe('actions', () => {
  it('every ActionId maps to a tool', () => {
    for (const id of Object.values(ActionId)) expect(ACTIONS[id].tool).toMatch(/^openboard\.element\./);
  });
  it('builds nudge and delete inputs', () => {
    expect(buildAction(ActionId.Nudge, { ids: ['a'], dx: 1, dy: 0, amount: 10 })).toEqual({
      tool: 'openboard.element.arrange',
      input: { action: 'nudge', ids: ['a'], dx: 1, dy: 0, amount: 10 },
    });
    expect(buildAction(ActionId.Delete, { ids: ['a'] })).toEqual({ tool: 'openboard.element.delete', input: { ids: ['a'] } });
  });
});
