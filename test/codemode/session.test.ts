import { describe, expect, it } from 'vitest';
import { SessionManager, ToolSession } from '../../src/core/tools/session';
import { buildFullRegistry } from '../helpers/registry';

const rect = (id: string) => ({ type: 'rectangle', id });
const ids = (m: { getDocument(): { elements: { id: string }[] } }): string[] => m.getDocument().elements.map((e) => e.id);

describe('BoardModel scopes', () => {
  it('apply edits immediately but record ONE merged undo entry on commit', () => {
    const { model, history } = buildFullRegistry();
    const events: string[] = [];
    model.onDidChange((e) => events.push(e.kind));
    model.beginScope('script');
    model.transact('a', (tx) => void tx.create({ type: 'rectangle', id: 'a', x: 0, y: 0, width: 5, height: 5, rotation: 0, style: {} } as never));
    model.transact('b', (tx) => void tx.create({ type: 'rectangle', id: 'b', x: 9, y: 0, width: 5, height: 5, rotation: 0, style: {} } as never));
    expect(ids(model)).toEqual(['a', 'b']);
    expect(history.undoCount()).toBe(0);
    model.commitScope();
    expect(events).toEqual(['scoped', 'scoped', 'scope-commit']);
    expect(history.undoCount()).toBe(1);
    expect(model.hasScope).toBe(false);
    history.undo(model);
    expect(ids(model)).toEqual([]);
    history.redo(model);
    expect(ids(model)).toEqual(['a', 'b']);
  });

  it('roll back to the exact previous document without history', () => {
    const { model, history, registry } = buildFullRegistry();
    void registry;
    model.transact('seed', (tx) => void tx.create({ type: 'rectangle', id: 's', x: 0, y: 0, width: 5, height: 5, rotation: 0, style: {} } as never));
    const before = JSON.stringify(model.getDocument());
    const undo = history.undoCount();
    model.beginScope('script');
    model.transact('x', (tx) => {
      tx.create({ type: 'rectangle', id: 'n', x: 0, y: 0, width: 5, height: 5, rotation: 0, style: {} } as never);
      tx.update('s', { x: 99 });
    });
    model.transact('y', (tx) => tx.remove('s'));
    model.rollbackScope();
    expect(JSON.stringify(model.getDocument())).toBe(before);
    expect(history.undoCount()).toBe(undo);
  });

  it('empty scopes record nothing and scopes do not nest', () => {
    const { model, history } = buildFullRegistry();
    model.beginScope('s');
    expect(() => model.beginScope('t')).toThrow(/already open/);
    model.commitScope();
    expect(history.undoCount()).toBe(0);
    model.rollbackScope(); // no-op
  });
});

describe('ToolSession over the registry', () => {
  it('two calls then commit: one undo entry; later reads see earlier writes', async () => {
    const { registry, model, history } = buildFullRegistry();
    const session = new ToolSession();
    await session.invoke(registry, 'openboard.element.create', { elements: [rect('a'), rect('b')] });
    await session.invoke(registry, 'openboard.connect', { edges: [{ sourceId: 'a', targetId: 'b' }] });
    const q = (await session.invoke(registry, 'openboard.element.query', {})) as { total: number };
    expect(q.total).toBe(3);
    expect(history.undoCount()).toBe(0);
    session.commit();
    expect(history.undoCount()).toBe(1);
    history.undo(model);
    expect(ids(model)).toEqual([]);
  });

  it('rollback restores the board and discards the entry', async () => {
    const { registry, model, history } = buildFullRegistry();
    await registry.invoke('openboard.element.create', { elements: [rect('keep')] });
    const before = JSON.stringify(model.getDocument());
    const session = new ToolSession();
    await session.invoke(registry, 'openboard.element.create', { elements: [rect('x')] });
    await session.invoke(registry, 'openboard.element.delete', { ids: ['keep'] });
    session.rollback();
    expect(JSON.stringify(model.getDocument())).toBe(before);
    expect(history.undoCount()).toBe(1);
    await expect(session.enter(model)).rejects.toMatchObject({ code: 'session_ended' });
  });

  it('a failing tool call inside a session changes nothing by itself', async () => {
    const { registry, model } = buildFullRegistry();
    const session = new ToolSession();
    await session.invoke(registry, 'openboard.element.create', { elements: [rect('a')] });
    const bad = (await session.invoke(registry, 'openboard.element.update', { ids: ['nope'], set: { x: 1 } })) as { error: { code: string } };
    expect(bad.error.code).toBe('not_found');
    expect(ids(model)).toEqual(['a']);
    session.commit();
  });

  it('board.save commits pending work first, so the saved document is consistent', async () => {
    const { registry, model, history } = buildFullRegistry();
    const session = new ToolSession();
    await session.invoke(registry, 'openboard.element.create', { elements: [rect('a')] });
    await session.invoke(registry, 'openboard.board.save', {});
    expect(history.undoCount()).toBe(1);
    await session.invoke(registry, 'openboard.element.create', { elements: [rect('b')] });
    session.commit();
    expect(history.undoCount()).toBe(2);
    expect(ids(model)).toEqual(['a', 'b']);
  });

  it('concurrent calls of one session join the board once (no self-deadlock)', async () => {
    const { registry, model } = buildFullRegistry();
    const session = new ToolSession();
    await Promise.all([
      session.invoke(registry, 'openboard.element.create', { elements: [rect('a')] }),
      session.invoke(registry, 'openboard.element.create', { elements: [rect('b')] }),
    ]);
    session.commit();
    expect(ids(model).sort()).toEqual(['a', 'b']);
  });

  it('serializes two sessions on one board and reports board_busy when the wait is too long', async () => {
    const { registry, model, history } = buildFullRegistry();
    const first = new ToolSession();
    await first.invoke(registry, 'openboard.element.create', { elements: [rect('a')] });

    const second = new ToolSession('second', 5000);
    const waiting = second.invoke(registry, 'openboard.element.create', { elements: [rect('b')] });
    await new Promise((r) => setTimeout(r, 30));
    expect(ids(model)).toEqual(['a']); // second has not started: the first still owns the board
    first.commit();
    await waiting;
    second.commit();
    expect(ids(model)).toEqual(['a', 'b']);
    expect(history.undoCount()).toBe(2);

    const holder = new ToolSession();
    await holder.invoke(registry, 'openboard.element.create', { elements: [rect('c')] });
    const impatient = new ToolSession('impatient', 40);
    const res = (await impatient.invoke(registry, 'openboard.element.create', { elements: [rect('d')] })) as { error: { code: string } };
    expect(res.error.code).toBe('board_busy');
    holder.rollback();
    expect(ids(model)).toEqual(['a', 'b']);
    // the queue is usable again
    const next = new ToolSession();
    await next.invoke(registry, 'openboard.element.create', { elements: [rect('e')] });
    next.commit();
    expect(ids(model)).toEqual(['a', 'b', 'e']);
  });

  it('read-only tools do not take the board lock', async () => {
    const { registry } = buildFullRegistry();
    const holder = new ToolSession();
    await holder.invoke(registry, 'openboard.element.create', { elements: [rect('a')] });
    const reader = new ToolSession('reader', 20);
    const q = (await reader.invoke(registry, 'openboard.element.query', {})) as { total: number };
    expect(q.total).toBe(1);
    holder.rollback();
  });
});

describe('SessionManager', () => {
  it('commits, rolls back, and expires idle sessions', async () => {
    const { registry, model, history } = buildFullRegistry();
    const manager = new SessionManager(registry, 60);
    await manager.invoke('s1', 'openboard.element.create', { elements: [rect('a')] });
    expect(manager.size).toBe(1);
    expect(manager.end('s1', true)).toBe(true);
    expect(manager.end('s1', true)).toBe(false);
    expect(history.undoCount()).toBe(1);

    await manager.invoke('s2', 'openboard.element.create', { elements: [rect('b')] });
    await new Promise((r) => setTimeout(r, 150)); // caller vanished: TTL rolls it back
    expect(manager.size).toBe(0);
    expect(ids(model)).toEqual(['a']);

    await manager.invoke('s3', 'openboard.element.create', { elements: [rect('c')] });
    manager.dispose();
    expect(ids(model)).toEqual(['a']);
  });
});
