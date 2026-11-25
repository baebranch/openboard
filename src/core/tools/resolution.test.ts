import { describe, expect, it } from 'vitest';
import { BoardModel } from '../ops';
import type { BoardDocument } from '../model/types';
import { DefaultToolRegistry, HostBoardResolver } from './index';
import type { BoardHost, ToolDefinition } from './index';

const doc = (): BoardDocument => ({ schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [], assets: [], library: [] });

function mk(opts: { trusted?: boolean; active?: string; open?: string[]; disk?: string[] } = {}) {
  const models = new Map<string, BoardModel>();
  for (const p of opts.open ?? []) models.set(p, new BoardModel(p, doc()));
  const bg: string[] = [];
  const host: BoardHost = {
    isOpen: (p) => models.get(p),
    exists: (p) => (opts.disk ?? []).includes(p),
    openInBackground: (p) => {
      bg.push(p);
      const m = new BoardModel(p, doc());
      models.set(p, m);
      return m;
    },
    activeBoard: () => (opts.active ? models.get(opts.active) : undefined),
    openBoards: () => [...models.keys()],
    isWorkspaceTrusted: () => opts.trusted ?? true,
  };
  return { resolver: new HostBoardResolver(host), bg, models };
}

const def = (extra: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name: 't', description: 'd', inputSchema: {}, outputSchema: {}, boardResolution: 'required-or-active', handler: () => ({}), ...extra,
});

describe('HostBoardResolver', () => {
  it('returns the open board, background-opens existing, errors on missing', async () => {
    const { resolver, bg, models } = mk({ open: ['/a.openboard'], disk: ['/c.openboard'] });
    expect(await resolver.resolve(def(), { board: '/a.openboard' })).toEqual({ ok: true, model: models.get('/a.openboard') });
    const r = await resolver.resolve(def(), { board: '/c.openboard' });
    expect(r.ok && r.model?.path).toBe('/c.openboard');
    expect(bg).toEqual(['/c.openboard']);
    const miss = await resolver.resolve(def(), { board: '/x.openboard' });
    expect(miss).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(!miss.ok && miss.error.message).toContain('/x.openboard');
    expect(bg).toEqual(['/c.openboard']);
  });

  it('create tools tolerate a missing board', async () => {
    const { resolver } = mk();
    expect(await resolver.resolve(def({ boardResolution: 'create' }), { board: '/n.openboard' })).toEqual({ ok: true });
  });

  it('uses the active board, else lists open boards', async () => {
    const a = mk({ open: ['/a.openboard'], active: '/a.openboard' });
    const r = await a.resolver.resolve(def(), {});
    expect(r.ok && r.model?.path).toBe('/a.openboard');
    const b = mk({ open: ['/a.openboard', '/b.openboard'] });
    const e = await b.resolver.resolve(def(), {});
    expect(e).toMatchObject({ ok: false, error: { code: 'no_active_board' } });
    expect(!e.ok && e.error.message).toContain('/a.openboard');
    expect(!e.ok && e.error.message).toContain('/b.openboard');
  });

  it('trust gate: rejects writesElsewhere and writes to other boards when untrusted', async () => {
    const { resolver } = mk({ trusted: false, open: ['/a.openboard', '/b.openboard'], active: '/a.openboard' });
    expect(await resolver.resolve(def({ writesElsewhere: true }), {})).toMatchObject({ ok: false, error: { code: 'workspace_untrusted' } });
    expect(await resolver.resolve(def(), { board: '/b.openboard' })).toMatchObject({ ok: false, error: { code: 'workspace_untrusted' } });
    expect((await resolver.resolve(def(), {})).ok).toBe(true);
    expect((await resolver.resolve(def(), { board: '\\a.openboard' })).ok).toBe(true);
    expect((await resolver.resolve(def(), { board: '/./a.openboard' })).ok).toBe(true);
    expect((await resolver.resolve(def({ readOnly: true }), { board: '/b.openboard' })).ok).toBe(true);
  });

  it('wires into DefaultToolRegistry', async () => {
    const { resolver } = mk({ trusted: false, open: ['/a.openboard'], active: '/a.openboard' });
    const reg = new DefaultToolRegistry({ resolver });
    reg.register(def({ name: 'w', writesElsewhere: true, inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }));
    expect(await reg.invoke('w', {})).toMatchObject({ error: { code: 'workspace_untrusted' } });
  });
});
