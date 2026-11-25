import { describe, expect, it } from 'vitest';
import { buildFullRegistry, FakeLifecycleHost } from '../../../test/helpers/registry';

function setup() {
  const host = new FakeLifecycleHost();
  const full = buildFullRegistry({ lifecycleHost: host });
  return { ...full, host };
}

const errCode = (r: unknown): string | undefined => (r as { error?: { code: string } }).error?.code;

describe('board lifecycle tools', () => {
  it('flags: list readOnly, create writesElsewhere, close destructive', () => {
    const { defs } = setup();
    expect(defs.get('openboard.board.list')?.readOnly).toBe(true);
    expect(defs.get('openboard.board.create')?.writesElsewhere).toBe(true);
    expect(defs.get('openboard.board.create')?.boardResolution).toBe('create');
    expect(defs.get('openboard.board.close')?.destructive).toBe(true);
  });

  it('list reports open boards and the active one', async () => {
    const { registry } = setup();
    expect(await registry.invoke('openboard.board.list', {})).toEqual({
      boards: [{ path: '/b.openboard', dirty: false }],
      active: '/b.openboard',
    });
  });

  it('open supports background and reports not_found', async () => {
    const { registry, host } = setup();
    host.files.add('/x.openboard');
    expect(await registry.invoke('openboard.board.open', { path: '/x.openboard', background: true })).toEqual({
      path: '/x.openboard',
      dirty: false,
    });
    expect(host.active()).toBe('/b.openboard');
    expect(errCode(await registry.invoke('openboard.board.open', { path: '/nope.openboard' }))).toBe('not_found');
  });

  it('create never overwrites an existing file', async () => {
    const { registry, host } = setup();
    expect(await registry.invoke('openboard.board.create', { path: '/n.openboard' })).toEqual({ path: '/n.openboard', dirty: false });
    expect(errCode(await registry.invoke('openboard.board.create', { path: '/n.openboard' }))).toBe('already_exists');
    expect(host.calls.filter((c) => c.startsWith('create:'))).toHaveLength(2);
  });

  it('save saves the resolved board', async () => {
    const { registry, host } = setup();
    host.boards.get('/b.openboard')!.dirty = true;
    expect(await registry.invoke('openboard.board.save', {})).toEqual({ path: '/b.openboard', saved: true });
    expect(host.boards.get('/b.openboard')!.dirty).toBe(false);
  });

  it('close refuses dirty boards unless discard is requested', async () => {
    const { registry, host } = setup();
    host.boards.get('/b.openboard')!.dirty = true;
    expect(errCode(await registry.invoke('openboard.board.close', {}))).toBe('unsaved_changes');
    expect(host.boards.size).toBe(1);
    expect(await registry.invoke('openboard.board.close', { discard: true })).toEqual({
      path: '/b.openboard',
      closed: true,
      discarded: true,
    });
    expect(host.boards.size).toBe(0);
  });

  it('close of a clean board needs no discard', async () => {
    const { registry } = setup();
    expect(await registry.invoke('openboard.board.close', {})).toEqual({ path: '/b.openboard', closed: true, discarded: false });
  });
});
