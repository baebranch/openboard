import { describe, expect, it } from 'vitest';
import { renderElementToSvg } from '../../core/export/svg';
import type { Element, FrameElement } from '../../core/model';
import { builtinPalette } from '../../core/theme';
import {
  buildDetachInstanceOp,
  buildRenameOp,
  buildResetOverridesOp,
  componentContext,
  goToMasterTarget,
  hasOverrides,
  isMasterMissing,
  overriddenProperties,
} from './component-model';

function frame(id: string, over: Record<string, unknown> = {}): FrameElement {
  return { id, type: 'frame', name: 'Frame', x: 0, y: 0, width: 100, height: 50, rotation: 0, style: {}, ...over } as unknown as FrameElement;
}
const rect = (id: string): Element => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style: {} }) as unknown as Element;

const master = frame('m', { component: 'Button' });
const other = frame('m2', { component: 'Card' });
const inst = frame('i', { instanceOf: 'm', overrides: { c1: { fill: '#ff0000' }, '': { width: 200 } } });
const child = rect('i::c1');
const all = [master, other, inst, child];

describe('component-model (Req 13.5, 14.9, 14.11, 14.19)', () => {
  it('classifies the selection', () => {
    expect(componentContext([master], all)?.kind).toBe('master');
    expect(componentContext([inst], all)?.kind).toBe('instance');
    expect(componentContext([child], all)).toMatchObject({ kind: 'instance-child', key: 'c1' });
    expect(componentContext([rect('r')], all)).toBeUndefined();
    expect(componentContext([master, inst], all)).toBeUndefined();
  });

  it('flags a missing master and disables go-to-master', () => {
    const orphan = frame('o', { instanceOf: 'gone' });
    const ctx = componentContext([orphan], [orphan])!;
    expect(isMasterMissing(ctx)).toBe(true);
    expect(goToMasterTarget(ctx)).toBeUndefined();
    expect(goToMasterTarget(componentContext([inst], all))).toBe('m');
  });

  it('lists overridden properties of an instance child and of the instance root', () => {
    expect([...overriddenProperties(componentContext([child], all))]).toEqual(['fill']);
    expect([...overriddenProperties(componentContext([inst], all))]).toEqual(['width']);
    expect(hasOverrides(componentContext([inst], all))).toBe(true);
    expect(hasOverrides(componentContext([frame('i2', { instanceOf: 'm' })], all))).toBe(false);
  });

  it('builds rename, detach and reset ops', () => {
    expect(buildRenameOp(master, '  Primary  ', all)).toEqual({
      ok: true,
      op: { tool: 'openboard.element.update', input: { ids: ['m'], set: { component: 'Primary' } } },
    });
    expect(buildDetachInstanceOp(inst)).toEqual({ tool: 'openboard.component.instance.detach', input: { id: 'i' } });
    const ctx = componentContext([child], all)!;
    expect(buildResetOverridesOp(ctx, 'i::c1', 'fill')).toEqual({
      tool: 'openboard.component.instance.override.reset',
      input: { id: 'i::c1', property: 'fill' },
    });
    expect(buildResetOverridesOp(componentContext([master], all)!, 'm')).toBeUndefined();
  });

  it('keeps the master indicator out of rendered (exported) SVG (Req 13.5)', () => {
    const svg = renderElementToSvg(master, { assets: [], elements: [] }, builtinPalette('dark'));
    expect(svg).not.toMatch(/ob-master|Button|master-indicator/);
  });

  it('rejects empty, too long and duplicate names', () => {
    expect(buildRenameOp(master, '   ', all)).toMatchObject({ ok: false });
    expect(buildRenameOp(master, 'x'.repeat(101), all)).toMatchObject({ ok: false });
    const dup = buildRenameOp(master, 'Card', all);
    expect(dup).toEqual({ ok: false, error: 'The component name "Card" is already in use' });
    expect(buildRenameOp(master, 'Button', all).ok).toBe(true);
  });
});
