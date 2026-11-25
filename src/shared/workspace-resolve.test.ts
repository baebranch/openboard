import { describe, expect, it } from 'vitest';
import { resolveWorkspace } from './workspace-resolve';

const a = { workspaceId: 'aaaaaaaaaaaa', folders: ['C:\\code\\a'], workspaceName: 'a' };
const b = { workspaceId: 'bbbbbbbbbbbb', folders: ['C:\\code\\b', 'C:\\code\\a\\nested'], workspaceName: 'b' };
const run = (extra: Partial<Parameters<typeof resolveWorkspace>[0]>) =>
  resolveWorkspace({ instances: [a, b], caseInsensitive: true, ...extra } as never);

describe('resolveWorkspace', () => {
  it('errors with no instances', () => {
    const r = resolveWorkspace({ instances: [], caseInsensitive: true });
    expect(r.ok).toBe(false);
  });
  it('explicit id wins', () => {
    expect(run({ workspace: 'bbbbbbbbbbbb', envWorkspaceId: 'aaaaaaaaaaaa' })).toEqual({ ok: true, instance: b });
  });
  it('explicit path picks the longest containing folder', () => {
    expect(run({ workspace: 'C:\\code\\a\\nested\\deep\\x.openboard' })).toEqual({ ok: true, instance: b });
    expect(run({ workspace: 'C:\\code\\a\\other' })).toEqual({ ok: true, instance: a });
  });
  it('path match is case-insensitive only when asked', () => {
    expect(run({ workspace: 'c:/CODE/a/x' })).toEqual({ ok: true, instance: a });
    expect(run({ workspace: 'c:/CODE/a/x', caseInsensitive: false }).ok).toBe(false);
  });
  it('unknown explicit workspace is an error listing ids', () => {
    const r = run({ workspace: 'zzz' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('aaaaaaaaaaaa');
  });
  it('uses input.board when workspace is omitted', () => {
    expect(run({ board: 'C:\\code\\b\\x.openboard' })).toEqual({ ok: true, instance: b });
    expect(run({ board: 'file:///c%3A/code/b/x.openboard' })).toEqual({ ok: true, instance: b });
  });
  it('falls back to env id when board is relative or outside', () => {
    expect(run({ board: 'rel.openboard', envWorkspaceId: 'bbbbbbbbbbbb' })).toEqual({ ok: true, instance: b });
    expect(run({ board: 'D:\\elsewhere\\x', envWorkspaceId: 'aaaaaaaaaaaa' })).toEqual({ ok: true, instance: a });
  });
  it('ignores an env id that is not running', () => {
    expect(resolveWorkspace({ instances: [a], envWorkspaceId: 'gone', caseInsensitive: true })).toEqual({ ok: true, instance: a });
  });
  it('single instance is the default', () => {
    expect(resolveWorkspace({ instances: [b], caseInsensitive: true })).toEqual({ ok: true, instance: b });
  });
  it('multiple instances without hints list both', () => {
    const r = run({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('aaaaaaaaaaaa');
      expect(r.message).toContain('bbbbbbbbbbbb');
      expect(r.message).toContain('workspace');
    }
  });
});
