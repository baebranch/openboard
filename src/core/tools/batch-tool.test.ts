import { describe, expect, it } from 'vitest';
import { buildFullRegistry } from '../../../test/helpers/registry';
import { isDestructiveInvocation } from './confirm';

const setup = () => {
  const f = buildFullRegistry();
  const run = (name: string, input: unknown) => f.registry.invoke(name, input) as Promise<any>;
  const ids = () => f.model.getDocument().elements.map((e) => e.id);
  return { ...f, run, ids };
};
const create = (id: string) => ({ tool: 'openboard.element.create', input: { elements: [{ type: 'rectangle', id }] } });

describe('openboard.batch', () => {
  it('runs operations in order in one transaction with one undo entry', async () => {
    const { run, ids, history, model } = setup();
    const r = await run('openboard.batch', {
      operations: [create('a'), create('b'), { tool: 'openboard.element.update', input: { ids: ['a'], set: { x: 7 } } }],
    });
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(3);
    expect(r.exceededTimeTarget).toBeUndefined();
    expect(ids()).toEqual(['a', 'b']);
    expect((model.getDocument().elements[0] as any).x).toBe(7);
    expect(history.undo(model)).toBe(true);
    expect(ids()).toEqual([]);
    expect(history.canUndo()).toBe(false);
  });

  it('reports derived geometry once and does not leak stale ids into later batches', async () => {
    const { run, model, registry } = setup();
    registry.register({
      name: 'test.instantiate',
      description: 'creates a component master and an instance',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      boardResolution: 'required-or-active',
      handler: (ctx) => {
        const base = { rotation: 0, width: 100, height: 100 };
        ctx.tx!.create({ id: 'M', type: 'frame', x: 0, y: 0, component: 'Card', ...base } as never);
        ctx.tx!.create({ id: 'c0', type: 'rectangle', x: 0, y: 0, parentId: 'M', ...base } as never);
        ctx.tx!.create({ id: 'I', type: 'frame', x: 300, y: 0, instanceOf: 'M', ...base } as never);
        return { ok: true };
      },
    });
    // Stale ids from a transaction outside the registry.
    model.transact('direct', (tx) => {
      tx.create({ id: 'M0', type: 'frame', x: 0, y: 0, width: 10, height: 10, rotation: 0, component: 'C0' } as never);
      tx.create({ id: 'I0', type: 'frame', x: 50, y: 0, width: 10, height: 10, rotation: 0, instanceOf: 'M0' } as never);
    });
    const plain = await run('openboard.batch', { operations: [create('p')] });
    expect(plain.ok).toBe(true);
    expect(plain.geometryChanges).toBeUndefined();

    const r = await run('openboard.batch', {
      operations: [{ tool: 'test.instantiate' }],
    });
    expect(r.ok).toBe(true);
    expect(r.geometryChanges.ids).toEqual([...r.geometryChanges.ids].sort());
    expect(r.geometryChanges.count).toBe(r.geometryChanges.ids.length);
    expect(r.geometryChanges.truncated).toBe(false);
    r.results.forEach((res: any) => expect(res.geometryChanges).toBeUndefined());

    const after = await run('openboard.batch', { operations: [create('q')] });
    expect(after.geometryChanges).toBeUndefined();
  });

  it('rolls back everything and reports index and reason on failure', async () => {
    const { run, ids, history } = setup();
    const r = await run('openboard.batch', {
      operations: [create('a'), { tool: 'openboard.element.delete', input: { ids: ['ghost'] } }, create('c')],
    });
    expect(r.ok).toBe(false);
    expect(r.error.index).toBe(1);
    expect(typeof r.error.reason).toBe('string');
    expect(ids()).toEqual([]);
    expect(history.canUndo()).toBe(false);
  });

  it('validates sub-inputs before running anything', async () => {
    const { run, ids, handlerCalls } = setup();
    const r = await run('openboard.batch', {
      operations: [create('a'), { tool: 'openboard.element.create', input: { elements: [{ type: 'nope' }] } }],
    });
    expect(r.ok).toBe(false);
    expect(r.error.index).toBe(1);
    expect(r.error.issues?.length).toBeGreaterThan(0);
    expect(ids()).toEqual([]);
    expect(handlerCalls.get('openboard.element.create')).toBeUndefined();
  });

  it('rejects nested batches, unknown tools and async tools', async () => {
    const { run } = setup();
    const nested = await run('openboard.batch', { operations: [{ tool: 'openboard.batch', input: { operations: [] } }] });
    expect(nested).toMatchObject({ ok: false, error: { index: 0 } });
    expect(nested.error.reason).toMatch(/nested/i);
    const unknown = await run('openboard.batch', { operations: [create('a'), { tool: 'nope.tool' }] });
    expect(unknown).toMatchObject({ ok: false, error: { index: 1 } });
    const exp = await run('openboard.batch', { operations: [{ tool: 'openboard.export', input: {} }] });
    expect(exp.ok).toBe(false);
    expect(exp.error.reason).toMatch(/cannot run inside a batch/);
  });

  it('enforces 1..500 operations at the schema', async () => {
    const { run } = setup();
    expect((await run('openboard.batch', { operations: [] })).error.code).toBe('invalid_input');
    const many = Array.from({ length: 501 }, (_, i) => create(`e${i}`));
    expect((await run('openboard.batch', { operations: many })).error.code).toBe('invalid_input');
  });

  it('is destructive when any sub-operation is', () => {
    const { registry } = setup();
    const del = { tool: 'openboard.element.delete', input: { ids: ['a'] } };
    expect(isDestructiveInvocation(registry, 'openboard.batch', { operations: [create('a'), del] })).toBe(true);
    expect(isDestructiveInvocation(registry, 'openboard.batch', { operations: [create('a')] })).toBe(false);
  });

  it('creates 1,000 elements in two batches well within the time target', async () => {
    const { run, ids } = setup();
    const t0 = performance.now();
    for (let b = 0; b < 2; b++) {
      const ops = Array.from({ length: 500 }, (_, i) => create(`e${b}_${i}`));
      const r = await run('openboard.batch', { operations: ops });
      expect(r.ok).toBe(true);
      expect(r.exceededTimeTarget).toBeUndefined();
    }
    expect(ids()).toHaveLength(1000);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
