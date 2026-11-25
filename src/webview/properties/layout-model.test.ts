import { describe, expect, it } from 'vitest';
import type { LayoutSpec } from '../../core/layout/types';
import type { Element, FrameElement } from '../../core/model';
import {
  buildDisableLayoutOp,
  buildEnableLayoutOp,
  buildLayoutFieldCommit,
  buildSizingCommit,
  DEFAULT_LAYOUT,
  layoutFieldValue,
  sizingAxisValue,
} from './layout-model';

const frame = (id: string, over: Record<string, unknown> = {}): FrameElement =>
  ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 50, rotation: 0, style: {}, name: id, ...over }) as unknown as FrameElement;

const withLayout = (id: string, layout: Partial<LayoutSpec> = {}): FrameElement =>
  frame(id, { layout: { ...structuredClone(DEFAULT_LAYOUT), ...layout } });

describe('layout enable / disable (Req 19.8, 19.9)', () => {
  it('enables with the defaults in one update, only on frames without a layout', () => {
    const op = buildEnableLayoutOp([frame('a'), withLayout('b', { gap: 9 })]);
    expect(op).toEqual({
      tool: 'openboard.element.update',
      input: {
        ids: ['a'],
        set: { layout: { direction: 'horizontal', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, mainAlign: 'start', crossAlign: 'start' } },
      },
    });
  });

  it('disables by removing layout', () => {
    expect(buildDisableLayoutOp([frame('a'), withLayout('b')])).toEqual({
      tool: 'openboard.element.update',
      input: { ids: ['b'], set: { layout: null } },
    });
    expect(buildDisableLayoutOp([frame('a')])).toBeUndefined();
  });
});

describe('layout field commits (Req 19.10, 26.7, 26.10)', () => {
  it('writes a complete layout, changing only the edited field', () => {
    const r = buildLayoutFieldCommit([withLayout('a', { gap: 4 })], 'padding.left', '12');
    expect(r).toEqual({
      ok: true,
      op: { tool: 'openboard.element.update', input: { ids: ['a'], set: { layout: { ...DEFAULT_LAYOUT, gap: 4, padding: { top: 0, right: 0, bottom: 0, left: 12 } } } } },
    });
  });

  it('uses one batch when other fields differ between frames, and shows mixed', () => {
    const frames = [withLayout('a', { gap: 1 }), withLayout('b', { gap: 2 })];
    expect(layoutFieldValue(frames, 'gap')).toEqual({ text: '', mixed: true });
    const r = buildLayoutFieldCommit(frames, 'direction', 'vertical');
    expect(r.ok && r.op.tool).toBe('openboard.batch');
    if (r.ok) expect((r.op.input['operations'] as unknown[]).length).toBe(2);
  });

  it.each([
    ['gap', '-1'],
    ['gap', '1001'],
    ['gap', 'abc'],
    ['gap', 'Infinity'],
    ['padding.top', ''],
    ['direction', 'diagonal'],
    ['mainAlign', 'stretch'],
    ['crossAlign', 'spaceBetween'],
  ] as const)('rejects %s = %j naming the path', (path, raw) => {
    const r = buildLayoutFieldCommit([withLayout('a')], path, raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`layout.${path}`);
  });

  it('accepts the range bounds', () => {
    expect(buildLayoutFieldCommit([withLayout('a')], 'gap', '1000').ok).toBe(true);
    expect(buildLayoutFieldCommit([withLayout('a')], 'gap', '0').ok).toBe(true);
  });
});

describe('sizing commits (Req 20.1, 20.11)', () => {
  it('treats absent sizing as fixed and keeps the other axis', () => {
    const el = frame('a', { sizing: { width: 'hug', height: 'fixed' } });
    expect(sizingAxisValue([frame('b')], 'width')).toBe('fixed');
    const r = buildSizingCommit([el], 'height', 'fill');
    expect(r).toEqual({ ok: true, op: { tool: 'openboard.element.update', input: { ids: ['a'], set: { sizing: { width: 'hug', height: 'fill' } } } } });
  });

  it('is mixed when elements differ and preserves each element\'s other axis in one batch', () => {
    const els: Element[] = [frame('a', { sizing: { width: 'hug', height: 'fixed' } }), frame('b')];
    expect(sizingAxisValue(els, 'width')).toBeUndefined();
    const r = buildSizingCommit(els, 'height', 'hug');
    expect(r.ok && r.op.tool).toBe('openboard.batch');
  });

  it('rejects an unknown mode', () => {
    const r = buildSizingCommit([frame('a')], 'width', 'stretch');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('sizing.width');
  });
});

describe('number tokens in gap and padding (Req 11.15)', () => {
  const tokens = { numbers: { s: 8 } };
  it('commits a reference to an existing number token', () => {
    const r = buildLayoutFieldCommit([withLayout('a')], 'gap', 'token:s', tokens);
    expect(r).toEqual({
      ok: true,
      op: { tool: 'openboard.element.update', input: { ids: ['a'], set: { layout: { ...DEFAULT_LAYOUT, gap: 'token:s' } } } },
    });
    expect(layoutFieldValue([withLayout('a', { gap: 'token:s' })], 'gap').text).toBe('token:s');
  });

  it('rejects a reference to a missing number token', () => {
    const r = buildLayoutFieldCommit([withLayout('a')], 'padding.left', 'token:gone', tokens);
    expect(r.ok).toBe(false);
  });
});
