import { describe, expect, it } from 'vitest';
import { serialize } from '../src/core/format/serializer';
import type { BoardDocument, Element } from '../src/core/model/types';
import { buildFullRegistry } from './helpers/registry';

// Requirement 11.15 through the real tool registry: number Tokens in layout gap and padding.
const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const base = { y: 0, width: 10, height: 10, rotation: 0, style };
const lay = { direction: 'horizontal', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, mainAlign: 'start', crossAlign: 'start' };
const doc = (): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, assets: [], library: [],
  tokens: { numbers: { space: 6 } },
  elements: [
    { id: 'f', type: 'frame', name: 'f', ...base, x: 0, width: 200, height: 40, layout: lay },
    { id: 'a', type: 'rectangle', ...base, x: 0, parentId: 'f' },
    { id: 'b', type: 'rectangle', ...base, x: 50, parentId: 'f' },
  ] as unknown as Element[],
});
const x = (env: ReturnType<typeof buildFullRegistry>, id: string): number =>
  env.model.getDocument().elements.find((e) => e.id === id)!.x;
type Out = { error?: { code?: string; message?: string } };

describe('number tokens in layout gap and padding', () => {
  it('accepts a reference, reflows, follows token updates, blocks delete, renames, and detaches', async () => {
    const env = buildFullRegistry({ doc: doc() });
    const call = async (tool: string, input: unknown) => (await env.registry.invoke(tool, input)) as Out;

    expect((await call('openboard.element.update', { ids: ['f'], set: { layout: { ...lay, gap: 'token:space' } } })).error).toBeUndefined();
    expect(x(env, 'b')).toBe(16);

    expect((await call('openboard.token.update', { category: 'numbers', name: 'space', value: 20 })).error).toBeUndefined();
    expect(x(env, 'b')).toBe(30);

    const del = await call('openboard.token.delete', { category: 'numbers', name: 'space' });
    expect(del.error?.message).toContain('1');

    expect((await call('openboard.token.rename', { category: 'numbers', name: 'space', newName: 'gap-s' })).error).toBeUndefined();
    const f = env.model.getDocument().elements.find((e) => e.id === 'f') as unknown as { layout: { gap: unknown } };
    expect(f.layout.gap).toBe('token:gap-s');

    expect((await call('openboard.token.detach', { ids: ['f'] })).error).toBeUndefined();
    const g = env.model.getDocument().elements.find((e) => e.id === 'f') as unknown as { layout: { gap: unknown } };
    expect(g.layout.gap).toBe(20);
    expect(x(env, 'b')).toBe(30);
  });

  it('rejects an invalid reference and leaves the board unchanged', async () => {
    const env = buildFullRegistry({ doc: doc() });
    const before = serialize(env.model.getDocument());
    const out = (await env.registry.invoke('openboard.element.update', {
      ids: ['f'],
      set: { layout: { ...lay, gap: 'token:bad name' } },
    })) as Out;
    expect(out.error).toBeDefined();
    expect(serialize(env.model.getDocument())).toBe(before);
  });

  it('round-trips a number token reference through serialize', async () => {
    const env = buildFullRegistry({ doc: doc() });
    await env.registry.invoke('openboard.element.update', { ids: ['f'], set: { layout: { ...lay, padding: { ...lay.padding, left: 'token:space' } } } });
    expect(serialize(env.model.getDocument())).toContain('"left": "token:space"');
  });
});
