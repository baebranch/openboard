import { describe, expect, it } from 'vitest';
import type { Element } from '../../core/model';
import { buildComponentOp, buildContextMenu, ComponentMenuId, componentMenuIds, defaultComponentName } from './contextMenu';

const frame = (id: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 80, name: 'Card', ...extra }) as unknown as Element;
const rect = (id: string): Element => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }) as unknown as Element;

const master = frame('m', { component: 'Card' });
const inst = frame('i', { instanceOf: 'm' });
const instWithOverride = frame('j', { instanceOf: 'm', overrides: { c1: { text: 'x' } } });
const orphan = frame('o', { instanceOf: 'gone' });
const child = rect('i::c1');
const all = [master, inst, instWithOverride, orphan, child, frame('plain'), rect('r1'), rect('r2')];

describe('component context menu entries', () => {
  it('plain frame and non-frame selections offer Create Component', () => {
    expect(componentMenuIds(all, ['plain'])).toEqual([ComponentMenuId.Create]);
    expect(componentMenuIds(all, ['r1', 'r2'])).toEqual([ComponentMenuId.Create]);
  });
  it('rejects selections the create tool would reject', () => {
    expect(componentMenuIds(all, ['plain', 'r1'])).toEqual([]);
    expect(componentMenuIds(all, ['plain', 'i'])).toEqual([]);
    expect(componentMenuIds(all, ['i::c1'])).toEqual([]);
    expect(componentMenuIds(all, [])).toEqual([]);
  });
  it('master offers Remove only', () => {
    expect(componentMenuIds(all, ['m'])).toEqual([ComponentMenuId.Remove]);
  });
  it('instance offers Go to master and Detach; Reset only with overrides', () => {
    expect(componentMenuIds(all, ['i'])).toEqual([ComponentMenuId.GoToMaster, ComponentMenuId.Detach]);
    expect(componentMenuIds(all, ['j'])).toEqual([
      ComponentMenuId.GoToMaster,
      ComponentMenuId.Detach,
      ComponentMenuId.ResetOverrides,
    ]);
  });
  it('instance with a missing master has no Go to master', () => {
    expect(componentMenuIds(all, ['o'])).toEqual([ComponentMenuId.Detach]);
  });
  it('read-only keeps only Go to master', () => {
    expect(componentMenuIds(all, ['j'], true)).toEqual([ComponentMenuId.GoToMaster]);
    expect(componentMenuIds(all, ['plain'], true)).toEqual([]);
  });
  it('buildContextMenu lists them with labels', () => {
    const items = buildContextMenu({ targetIds: ['j'], grouped: false, hasClipboard: false, elements: all });
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['Detach Instance', 'Reset Overrides', 'Go to master']));
    const none = buildContextMenu({ targetIds: ['j'], grouped: false, hasClipboard: false });
    expect(none.map((i) => i.label)).not.toContain('Detach Instance');
  });
  it('builds tool inputs', () => {
    expect(buildComponentOp(ComponentMenuId.Detach, all, ['i'])).toEqual({
      tool: 'openboard.component.instance.detach',
      input: { id: 'i' },
    });
    expect(buildComponentOp(ComponentMenuId.ResetOverrides, all, ['j'])?.tool).toBe(
      'openboard.component.instance.override.reset',
    );
    expect(buildComponentOp(ComponentMenuId.Remove, all, ['m'])?.input).toEqual({ id: 'm' });
    expect(buildComponentOp(ComponentMenuId.GoToMaster, all, ['i'])).toBeUndefined();
  });
  it('default names are unique', () => {
    expect(defaultComponentName(all, ['plain'])).toBe('Card 2');
    expect(defaultComponentName(all, ['r1', 'r2'])).toBe('Component');
  });
});
