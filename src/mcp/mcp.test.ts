import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog';
import { mapResult } from './results';

describe('catalog', () => {
  const reg = (names: string[]) => ({ list: () => names });
  it('exposes the five tools; workspace is an optional property on all but openboard_workspaces', () => {
    const c = buildCatalog(reg(['openboard.element.create', 'openboard.board.save']), '1.2.3');
    expect(c.version).toBe('1.2.3');
    expect(c.actions).toEqual(['openboard.element.create', 'openboard.board.save']);
    expect(c.tools.map((t) => t.name)).toEqual([
      'openboard_workspaces',
      'openboard_read_skill',
      'openboard_execute',
      'openboard_call',
      'openboard_save',
    ]);
    const props = (n: string) => (c.tools.find((t) => t.name === n)!.inputSchema.properties as Record<string, unknown>);
    expect(props('openboard_workspaces').workspace).toBeUndefined();
    for (const n of ['openboard_execute', 'openboard_call', 'openboard_save']) expect(props(n).workspace).toMatchObject({ type: 'string' });
    expect((props('openboard_call').action as { enum: string[] }).enum).toEqual(['element.create', 'board.save']);
  });
});

describe('mapResult', () => {
  it('returns JSON text', () => {
    expect(mapResult({ ok: 1 })).toEqual({ content: [{ type: 'text', text: '{"ok":1}' }] });
  });
  it('splits top-level and nested images', () => {
    const top = mapResult({ mimeType: 'image/png', data: 'AAAA' });
    expect(top.content[1]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
    expect((top.content[0] as any).text).not.toContain('AAAA');
    const nested = mapResult({ results: [{ mimeType: 'image/png', data: 'BBBB' }, { mimeType: 'text/plain', data: 'x' }] });
    expect(nested.content).toHaveLength(2);
    expect(nested.isError).toBeUndefined();
  });
  it('flags registry errors with isError', () => {
    const r = mapResult({ error: { code: 'not_found', message: 'nope' } });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content[0] as any).text).error.code).toBe('not_found');
  });
});
