import { describe, expect, it } from 'vitest';
import { BoardModel } from '../ops';
import type { HistoryEntry } from '../ops';
import type { BoardDocument } from '../model/types';
import { DefaultToolRegistry, defaultValidatorFactory } from './index';
import type { ToolDefinition } from './index';
import { ToolSession } from './session';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const doc = (): BoardDocument => ({ schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [], assets: [], library: [] });

function setup(handler?: ToolDefinition['handler'], outputSchema: ToolDefinition['outputSchema'] = { type: 'object', required: ['id'] }) {
  const entries: HistoryEntry[] = [];
  const model = new BoardModel('/b.openboard', doc(), { history: { push: (e) => entries.push(e) } });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  reg.register({
    name: 'test.add',
    description: 'adds a rectangle',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } }, additionalProperties: false },
    outputSchema,
    boardResolution: 'required-or-active',
    handler:
      handler ??
      ((ctx, input: { id: string }) => {
        ctx.tx!.create({ id: input.id, type: 'rectangle', x: 0, y: 0, width: 1, height: 1, rotation: 0, style });
        return { id: input.id };
      }),
  });
  return { reg, model, entries };
}

describe('ToolRegistry.invoke', () => {
  it('lists, describes and runs one history entry per success', async () => {
    const { reg, model, entries } = setup();
    expect(reg.list()).toEqual(['test.add']);
    expect(reg.describe('test.add').description).toBe('adds a rectangle');
    expect(await reg.invoke('test.add', { id: 'a' })).toEqual({ id: 'a' });
    expect(entries).toHaveLength(1);
    expect(model.getDocument().elements).toHaveLength(1);
  });

  it('names the unknown tool', async () => {
    const { reg } = setup();
    expect(await reg.invoke('nope', {})).toEqual({ error: { code: 'unknown_tool', message: 'Unknown tool: nope' } });
  });

  it('returns invalid_input issues without calling the handler', async () => {
    let called = false;
    const { reg, entries } = setup(() => {
      called = true;
      return { id: 'x' };
    });
    const r = (await reg.invoke('test.add', { id: '', extra: 1 })) as { error: { code: string; issues: { path: string }[] } };
    expect(r.error.code).toBe('invalid_input');
    expect(r.error.issues.map((i) => i.path).sort()).toEqual(['/extra', '/id']);
    expect(called).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it('rolls back when output violates the schema', async () => {
    const { reg, model, entries } = setup(undefined, { type: 'object', required: ['nope'] });
    const r = (await reg.invoke('test.add', { id: 'a' })) as { error: { code: string } };
    expect(r.error.code).toBe('internal_error');
    expect(model.getDocument().elements).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it('rolls back and reports a handler throw', async () => {
    const { reg, model } = setup((ctx) => {
      ctx.tx!.create({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 1, height: 1, rotation: 0, style });
      throw Object.assign(new Error('boom'), { code: 'bad' });
    });
    expect(await reg.invoke('test.add', { id: 'a' })).toEqual({ error: { code: 'bad', message: 'boom' } });
    expect(model.getDocument().elements).toHaveLength(0);
  });

  describe('geometryChanges', () => {
    const rectEl = (id: string, extra: object = {}) =>
      ({ id, type: 'rectangle', x: 0, y: 0, width: 1, height: 1, rotation: 0, style, ...extra }) as never;
    const frameEl = (id: string, extra: object = {}) =>
      ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 100, rotation: 0, style, ...extra }) as never;
    const instantiate = (children: number) =>
      setup((ctx) => {
        ctx.tx!.create(frameEl('M', { component: 'Card' }));
        for (let i = 0; i < children; i++) ctx.tx!.create(rectEl(`c${String(i).padStart(4, '0')}`, { parentId: 'M' }));
        ctx.tx!.create(frameEl('I', { x: 300, instanceOf: 'M' }));
        return { id: 'I' };
      });

    it('attaches sorted ids, count and truncated for derived changes', async () => {
      const { reg } = instantiate(2);
      const r = (await reg.invoke('test.add', { id: 'x' })) as { id: string; geometryChanges: { count: number; ids: string[]; truncated: boolean } };
      expect(r.id).toBe('I');
      expect(r.geometryChanges.count).toBeGreaterThan(0);
      expect(r.geometryChanges.ids).toEqual([...r.geometryChanges.ids].sort());
      expect(r.geometryChanges.ids).toContain('I::c0000');
      expect(r.geometryChanges.truncated).toBe(false);
    });

    it('caps ids at 500 and reports the full count', async () => {
      const { reg } = instantiate(520);
      const r = (await reg.invoke('test.add', { id: 'x' })) as { geometryChanges: { count: number; ids: string[]; truncated: boolean } };
      expect(r.geometryChanges.ids).toHaveLength(500);
      expect(r.geometryChanges.count).toBeGreaterThanOrEqual(520);
      expect(r.geometryChanges.truncated).toBe(true);
    });

    it('does not leak ids from an earlier transaction or session call into later calls', async () => {
      const { reg, model } = setup();
      reg.register({
        name: 'test.inst',
        description: 'instantiates',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        boardResolution: 'required-or-active',
        handler: (ctx) => {
          ctx.tx!.create(frameEl('M', { component: 'Card' }));
          ctx.tx!.create(rectEl('c0', { parentId: 'M' }));
          ctx.tx!.create(frameEl('I', { x: 300, instanceOf: 'M' }));
          return { ok: true };
        },
      });
      const session = new ToolSession();
      try {
        const first = (await session.invoke(reg, 'test.inst', {})) as { geometryChanges?: { ids: string[] } };
        expect(first.geometryChanges?.ids).toContain('I::c0');
        const second = (await session.invoke(reg, 'test.add', { id: 'plain' })) as Record<string, unknown>;
        expect(second).toEqual({ id: 'plain' });
      } finally {
        session.rollback();
      }
      // Stale ids left by a transaction that bypassed the registry are dropped too.
      model.transact('direct', (tx) => {
        tx.create(frameEl('M2', { component: 'Card2' }));
        tx.create(frameEl('I2', { x: 5, instanceOf: 'M2' }));
      });
      expect(await reg.invoke('test.add', { id: 'later' })).toEqual({ id: 'later' });
    });

    it('omits geometryChanges when nothing was derived', async () => {
      const { reg } = setup();
      expect(await reg.invoke('test.add', { id: 'a' })).toEqual({ id: 'a' });
    });
  });

  it('serializes concurrent invocations', async () => {
    const { reg, entries, model } = setup();
    await Promise.all([reg.invoke('test.add', { id: 'a' }), reg.invoke('test.add', { id: 'b' })]);
    expect(entries).toHaveLength(2);
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('errors without a resolver for board tools and rejects bad registrations', async () => {
    const reg = new DefaultToolRegistry();
    const base = { description: 'd', inputSchema: {}, outputSchema: {}, boardResolution: 'required-or-active' as const, handler: () => ({}) };
    reg.register({ ...base, name: 't' });
    expect(await reg.invoke('t', {})).toMatchObject({ error: { code: 'no_board' } });
    expect(() => reg.register({ ...base, name: 'Bad Name' })).toThrow();
    expect(() => reg.register({ ...base, name: 't' })).toThrow();
    expect(() => reg.register({ ...base, name: 'u', description: '' })).toThrow();
  });

  it('runs async handlers for tools without a board', async () => {
    const reg = new DefaultToolRegistry();
    reg.register({ name: 'n', description: 'd', inputSchema: {}, outputSchema: { type: 'number' }, boardResolution: 'none', handler: async () => 3 });
    expect(await reg.invoke('n', {})).toBe(3);
  });
});

describe('default JSON-Schema validator', () => {
  const v = (schema: Record<string, unknown>, data: unknown) => defaultValidatorFactory.compile(schema)(data).ok;
  it('handles numeric, array, enum, const bounds', () => {
    expect(v({ type: 'integer', minimum: 1, maximum: 3 }, 2)).toBe(true);
    expect(v({ type: 'integer', minimum: 1, maximum: 3 }, 4)).toBe(false);
    expect(v({ type: 'integer' }, 1.5)).toBe(false);
    expect(v({ type: 'array', minItems: 1, maxItems: 2, items: { enum: ['a'] } }, ['a', 'b'])).toBe(false);
    expect(v({ const: 5 }, 5)).toBe(true);
    expect(v({ type: 'string', maxLength: 2 }, 'abc')).toBe(false);
  });
  it('handles $ref, oneOf and discriminator', () => {
    const schema = {
      $defs: {
        a: { type: 'object', required: ['t'], properties: { t: { const: 'a' }, n: { type: 'number' } } },
        b: { type: 'object', required: ['t'], properties: { t: { const: 'b' }, s: { type: 'string' } } },
      },
      oneOf: [{ $ref: '#/$defs/a' }, { $ref: '#/$defs/b' }],
      discriminator: { propertyName: 't' },
    };
    expect(v(schema, { t: 'b', s: 'x' })).toBe(true);
    expect(v(schema, { t: 'b', s: 1 })).toBe(false);
    expect(v(schema, { t: 'c' })).toBe(false);
    expect(v({ oneOf: [{ type: 'string' }, { type: 'number' }] }, 1)).toBe(true);
    expect(v({ oneOf: [{ type: 'string' }, { type: 'number' }] }, null)).toBe(false);
  });
});
