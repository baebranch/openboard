import { describe, expect, it } from 'vitest';
import { executeScript, type ExecTransport } from './execute';
import { GUEST_PRELUDE, createDispatcher } from './ob-api';
import { runSandbox, type HostCallResult } from './sandbox';

const noHost = async (): Promise<HostCallResult> => ({ ok: false, error: { code: 'no_host', message: 'no host' } });
const run = (code: string, extra: Partial<Parameters<typeof runSandbox>[0]> = {}) =>
  runSandbox({ prelude: GUEST_PRELUDE, code, hostCall: noHost, timeoutMs: 5000, ...extra });

describe('sandbox basics', () => {
  it('returns the awaited return value as JSON', async () => {
    const r = await run('const x = await Promise.resolve(20); return { answer: x + 22, list: [1, "a", null] };');
    expect(r).toMatchObject({ ok: true, result: { answer: 42, list: [1, 'a', null] }, logs: [] });
  });

  it('returns null for undefined and supports syntax errors as script errors', async () => {
    expect(await run('const a = 1;')).toMatchObject({ ok: true, result: null });
    const bad = await run('const = ;');
    expect(bad).toMatchObject({ ok: false, error: { kind: 'script_error' } });
  });

  it('reports thrown errors with their message and stack', async () => {
    const r = await run('function f() { throw new TypeError("nope"); }\nf();');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('script_error');
      expect(r.error.message).toContain('TypeError');
      expect(r.error.message).toContain('nope');
      expect(r.error.stack).toContain('script.js');
    }
  });

  it('captures console output in order, with level prefixes', async () => {
    const r = await run(`console.log('a', 1, {b: 2}); console.info('i'); console.warn('w'); console.error('e'); console.debug('d'); console.log(undefined, null);`);
    expect(r).toMatchObject({ ok: true, logs: ['a 1 {"b":2}', 'i', '[warn] w', '[error] e', 'd', 'undefined null'] });
  });

  it('truncates logs at the limit', async () => {
    const r = await run(`for (let i = 0; i < 1000; i++) console.log('x'.repeat(100));`, { maxLogBytes: 1000 });
    expect(r.ok).toBe(true);
    expect(r.logs.length).toBeLessThan(15);
    expect(r.logs.at(-1)).toBe('[log output truncated]');
  });

  it('rejects results that are too large', async () => {
    const r = await run(`return 'y'.repeat(5000);`, { maxResultBytes: 1000 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'result_too_large' } });
  });

  it('fails on a non-serializable result (circular)', async () => {
    const r = await run('const a = {}; a.a = a; return a;');
    expect(r.ok).toBe(false);
  });

  it('detects a script that waits forever', async () => {
    const r = await run('await new Promise(() => {});');
    expect(r).toMatchObject({ ok: false, error: { kind: 'script_error' } });
    if (!r.ok) expect(r.error.message).toContain('never resolve');
  });
});

describe('sandbox limits', () => {
  it('stops an infinite synchronous loop at the deadline', async () => {
    const t0 = Date.now();
    const r = await run('while (true) {}', { timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('stops a loop that starts after an await', async () => {
    const r = await run('await Promise.resolve(); for (;;) {}', { timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  it('cannot swallow the interrupt with try/catch', async () => {
    const r = await run('try { while (true) {} } catch (e) { return "caught"; }', { timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  it('stops a slow host call at the deadline', async () => {
    const slow = async (): Promise<HostCallResult> => {
      await new Promise((r) => setTimeout(r, 1500));
      return { ok: true, value: 1 };
    };
    const t0 = Date.now();
    const r = await run('await ob.boards(); return 1;', { hostCall: slow, timeoutMs: 200 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('enforces the memory limit', async () => {
    const r = await run(`const a = []; for (;;) a.push('x'.repeat(1 << 20) + a.length);`, { memoryLimitBytes: 16 * 1024 * 1024, timeoutMs: 20000 });
    expect(r).toMatchObject({ ok: false, error: { kind: 'memory' } });
  }, 30_000);

  it('enforces the stack limit', async () => {
    const r = await run('function f(n) { return f(n + 1) + 1; } return f(0);');
    expect(r).toMatchObject({ ok: false, error: { kind: 'stack' } });
  });

  it('is isolated between runs (no shared globals) and a failed run does not poison the next', async () => {
    await run('globalThis.leak = 123; while (true) {}', { timeoutMs: 200 });
    const r = await run('return typeof globalThis.leak;');
    expect(r).toMatchObject({ ok: true, result: 'undefined' });
  });
});

describe('sandbox escape attempts are denied', () => {
  const probe = async (expr: string): Promise<unknown> => {
    const r = await run(`return ${expr};`);
    if (!r.ok) return `ERR:${r.error.message}`;
    return r.result;
  };

  it('has no require, process, fetch, timers, modules or host handles', async () => {
    expect(await probe('typeof require')).toBe('undefined');
    expect(await probe('typeof process')).toBe('undefined');
    expect(await probe('typeof fetch')).toBe('undefined');
    expect(await probe('typeof XMLHttpRequest')).toBe('undefined');
    expect(await probe('typeof WebSocket')).toBe('undefined');
    expect(await probe('typeof setTimeout')).toBe('undefined');
    expect(await probe('typeof setInterval')).toBe('undefined');
    expect(await probe('typeof setImmediate')).toBe('undefined');
    expect(await probe('typeof module')).toBe('undefined');
    expect(await probe('typeof Buffer')).toBe('undefined');
    expect(await probe('typeof window')).toBe('undefined');
    expect(await probe('typeof __ob_call')).toBe('undefined');
    expect(await probe('typeof __ob_log')).toBe('undefined');
    expect(await probe('typeof globalThis.__ob_call')).toBe('undefined');
  });

  it('calling require / process / fetch fails with a ReferenceError', async () => {
    for (const call of ['require("fs")', 'process.exit(1)', 'fetch("http://127.0.0.1:1/")']) {
      const r = await run(`${call}; return 1;`);
      expect(r.ok, call).toBe(false);
    }
    const r = await run('return require("child_process");');
    expect(r).toMatchObject({ ok: false, error: { kind: 'script_error' } });
    if (!r.ok) expect(r.error.message).toContain('require');
  });

  it('constructor tricks only reach the sandbox realm', async () => {
    expect(await probe('this.constructor.constructor("return typeof process")()')).toBe('undefined');
    expect(await probe('globalThis.constructor.constructor("return typeof require")()')).toBe('undefined');
    expect(await probe('(function(){}).constructor("return typeof process")()')).toBe('undefined');
    expect(await probe('eval("typeof process")')).toBe('undefined');
    expect(await probe('(0, eval)("typeof require")')).toBe('undefined');
    const AsyncFunction = 'Object.getPrototypeOf(async function () {}).constructor';
    const viaAsync = await run(`return await (${AsyncFunction})("return typeof fetch + typeof process + typeof require")();`);
    expect(viaAsync).toMatchObject({ ok: true, result: 'undefinedundefinedundefined' });
  });

  it('`ob` and `console` are frozen and cannot be replaced', async () => {
    const r = await run(`'use strict'; try { globalThis.ob = 1; } catch (e) {} try { ob.call = null; } catch (e) {} return typeof ob.call + ',' + typeof ob.board;`);
    expect(r).toMatchObject({ ok: true, result: 'function,function' });
    const c = await run(`try { globalThis.console = null; } catch (e) {} console.log('still'); return 1;`);
    expect(c).toMatchObject({ ok: true, logs: ['still'] });
  });

  it('the only host entry is ob, and unknown host methods are refused', async () => {
    const seen: string[] = [];
    const host = createDispatcher({
      invoke: async (name) => {
        seen.push(name);
        return { ok: 1 };
      },
    });
    const r = await runSandbox({
      prelude: GUEST_PRELUDE,
      code: `const keys = Object.keys(globalThis).sort(); await ob.call('board.list'); return { keys, obKeys: Object.keys(ob).sort() };`,
      hostCall: host,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const res = r.result as { keys: string[]; obKeys: string[] };
      expect(res.obKeys).toEqual(['board', 'boards', 'call']);
      expect(res.keys).not.toContain('__ob_call');
    }
    expect(seen).toEqual(['openboard.board.list']);
    expect(await host('nonsense', [])).toMatchObject({ ok: false, error: { code: 'unknown_method' } });
    expect(await host('constructor', [])).toMatchObject({ ok: false, error: { code: 'unknown_method' } });
    expect(await host('__proto__', [])).toMatchObject({ ok: false, error: { code: 'unknown_method' } });
  });
});

describe('host dispatcher', () => {
  const calls: { name: string; input: any }[] = [];
  const invoke = async (name: string, input: unknown): Promise<unknown> => {
    calls.push({ name, input });
    if (name === 'openboard.element.query') return { items: [{ id: 'q1', type: 'rectangle' }], total: 1, offset: 0 };
    if (name === 'openboard.element.create') return { created: [], ids: ['n1'] };
    if (name === 'openboard.board.save') return { error: { code: 'no_board', message: 'No board is available for this tool' } };
    return { done: name };
  };
  const dispatch = createDispatcher({ invoke, defaultBoard: '/default.openboard' });

  it('maps token, component, instance, override, detach and icon methods to the Agent_Tools unchanged', async () => {
    calls.length = 0;
    const board = '/y.openboard';
    const tok = { category: 'colors', name: 'brand', value: '#ff0000' };
    await dispatch('tokens', [board, { category: 'colors' }]);
    await dispatch('createToken', [board, tok]);
    await dispatch('updateToken', [board, tok]);
    await dispatch('renameToken', [board, { category: 'colors', name: 'brand', newName: 'b2' }]);
    await dispatch('deleteToken', [board, { category: 'colors', name: 'b2' }]);
    await dispatch('detachTokens', [board, { ids: ['a'] }]);
    await dispatch('tokenMode', [board, 'dark']);
    await dispatch('components', [board]);
    await dispatch('createComponent', [board, { ids: ['f'], name: 'Card' }]);
    await dispatch('removeComponent', [board, 'f']);
    await dispatch('createInstance', [board, { master: 'f', x: 1 }]);
    await dispatch('setOverride', [board, { id: 'i::c', property: 'text', value: 'x' }]);
    await dispatch('resetOverride', [board, { id: 'i', property: 'text' }]);
    await dispatch('detachInstance', [board, 'i']);
    await dispatch('searchIcons', [board, 'arrow']);
    expect(calls.map((c) => c.name)).toEqual([
      'openboard.token.list',
      'openboard.token.create',
      'openboard.token.update',
      'openboard.token.rename',
      'openboard.token.delete',
      'openboard.token.detach',
      'openboard.token.mode',
      'openboard.component.list',
      'openboard.component.create',
      'openboard.component.remove',
      'openboard.component.instance.create',
      'openboard.component.instance.override.set',
      'openboard.component.instance.override.reset',
      'openboard.component.instance.detach',
      'openboard.icon.search',
    ]);
    expect(calls[1]!.input).toEqual({ board, ...tok });
    expect(calls[6]!.input).toEqual({ board, mode: 'dark' });
    expect(calls[13]!.input).toEqual({ board, id: 'i' });
    expect(calls[14]!.input).toEqual({ board, keyword: 'arrow' });
    expect(await dispatch('detachInstance', [board, 5])).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('maps the board handle methods to registry tools with the board path', async () => {
    calls.length = 0;
    const board = '/x.openboard';
    expect(await dispatch('summary', [board])).toMatchObject({ ok: true });
    expect(await dispatch('get', [board, 'q1'])).toEqual({ ok: true, value: { id: 'q1', type: 'rectangle' } });
    expect(await dispatch('create', [board, { type: 'rectangle' }])).toEqual({ ok: true, value: ['n1'] });
    await dispatch('update', [board, 'a', { x: 1 }]);
    await dispatch('remove', [board, ['a', 'b']]);
    await dispatch('arrange', [board, 'align', { ids: ['a', 'b'], alignment: 'left' }]);
    await dispatch('connect', [board, 'a', 'b', { label: 'l' }]);
    await dispatch('connect', [board, [{ sourceId: 'a', targetId: 'b' }], null, null]);
    await dispatch('connect', [board, 'a', { toPosition: { x: 1, y: 2 } }, null]);
    await dispatch('layout', [board, { direction: 'LR' }]);
    await dispatch('importMermaid', [board, 'flowchart TD\nA-->B', null]);
    await dispatch('library', [board]);
    await dispatch('insertComponent', [board, 'card', { x: 5 }]);
    await dispatch('viewport', [board, { action: 'zoomToFit' }]);
    await dispatch('export', [board, { format: 'svg' }]);
    expect(calls.map((c) => c.name)).toEqual([
      'openboard.board.summary',
      'openboard.element.query',
      'openboard.element.create',
      'openboard.element.update',
      'openboard.element.delete',
      'openboard.element.arrange',
      'openboard.connect',
      'openboard.connect',
      'openboard.connect',
      'openboard.layout',
      'openboard.import',
      'openboard.library.list',
      'openboard.library.insert',
      'openboard.viewport',
      'openboard.export',
    ]);
    expect(calls.every((c) => c.input.board === board)).toBe(true);
    expect(calls[3]!.input).toEqual({ board, ids: ['a'], set: { x: 1 } });
    expect(calls[5]!.input).toMatchObject({ action: 'align', alignment: 'left' });
    expect(calls[6]!.input.edges).toEqual([{ sourceId: 'a', targetId: 'b', label: 'l' }]);
    expect(calls[8]!.input.edges).toEqual([{ sourceId: 'a', toPosition: { x: 1, y: 2 } }]);
    expect(calls[10]!.input).toMatchObject({ source: 'mermaid', text: 'flowchart TD\nA-->B' });
    expect(calls[12]!.input).toMatchObject({ component: 'card', x: 5 });
  });

  it('falls back to the default board and passes it to ob.call, and accepts short or full action names', async () => {
    calls.length = 0;
    await dispatch('summary', [null]);
    await dispatch('call', ['element.query', { limit: 1 }]);
    await dispatch('call', ['openboard.element.query', { board: '/other', limit: 1 }]);
    expect(calls.map((c) => [c.name, c.input.board])).toEqual([
      ['openboard.board.summary', '/default.openboard'],
      ['openboard.element.query', '/default.openboard'],
      ['openboard.element.query', '/other'],
    ]);
  });

  it('turns tool errors into failed results and validates arguments', async () => {
    expect(await dispatch('save', ['/x'])).toEqual({ ok: false, error: { code: 'no_board', message: 'No board is available for this tool' } });
    expect(await dispatch('get', ['/x', 5])).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch('update', ['/x', 5, {}])).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch('connect', ['/x', 5])).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await dispatch('summary', [''])).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });
});

describe('executeScript transactions (transport contract)', () => {
  const transport = (log: string[], fail = false): ExecTransport => ({
    invoke: async (name) => {
      log.push(`invoke ${name}`);
      return fail ? { error: { code: 'nope', message: 'tool failed' } } : { ids: ['a'] };
    },
    finish: async (commit) => {
      log.push(commit ? 'commit' : 'rollback');
    },
  });

  it('commits once after success and rolls back once after failure', async () => {
    const ok: string[] = [];
    const r1 = await executeScript({ code: `await ob.board().create({type:'rectangle'}); await ob.board().create({type:'rectangle'}); return 1;` }, transport(ok));
    expect(r1).toMatchObject({ ok: true, result: 1 });
    expect(ok).toEqual(['invoke openboard.element.create', 'invoke openboard.element.create', 'commit']);

    const bad: string[] = [];
    const r2 = await executeScript({ code: `await ob.board().create({type:'rectangle'}); return 1;` }, transport(bad, true));
    expect(r2).toMatchObject({ ok: false, error: { code: 'script_error' }, rolledBack: true });
    expect(bad).toEqual(['invoke openboard.element.create', 'rollback']);
  });

  it('runs host calls strictly in call order even under Promise.all', async () => {
    const order: string[] = [];
    const t: ExecTransport = {
      invoke: async (name, input) => {
        const id = (input as { elements: { id: string }[] }).elements[0]!.id;
        await new Promise((r) => setTimeout(r, id === 'slow' ? 40 : 1));
        order.push(`${name}:${id}`);
        return { ids: [id] };
      },
      finish: async () => undefined,
    };
    const r = await executeScript({ code: `return await Promise.all([ob.board().create({id:'slow',type:'rectangle'}), ob.board().create({id:'fast',type:'rectangle'})]);` }, t);
    expect(r).toMatchObject({ ok: true, result: [['slow'], ['fast']] });
    expect(order).toEqual(['openboard.element.create:slow', 'openboard.element.create:fast']);
  });

  it('does not start a session for invalid input', async () => {
    const log: string[] = [];
    const r = await executeScript({ code: 42 }, transport(log));
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(log).toEqual([]);
  });

  it('reports a failed commit', async () => {
    const t: ExecTransport = {
      invoke: async () => ({}),
      finish: async () => {
        throw new Error('window gone');
      },
    };
    expect(await executeScript({ code: 'return 1' }, t)).toMatchObject({ ok: false, error: { code: 'commit_failed' } });
  });
});
