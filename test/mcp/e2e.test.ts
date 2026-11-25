/**
 * End to end: real per-window IPC channel(s) (named pipe / Unix socket in a temp OPENBOARD_HOME)
 * driven by the MCP server, in-process over an in-memory transport and as the built stdio bundle.
 * child_process is used here (test code only) to spawn dist/mcp.js.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPOSED_TOOL_NAMES, SERVER_INSTRUCTIONS, type SkillFile } from '../../src/codemode/surface';
import { IpcChannel } from '../../src/host/ipc/server';
import { instancesDir } from '../../src/host/ipc/instances';
import { buildCatalog, type CatalogFile } from '../../src/mcp/catalog';
import { IpcCallError, ipcCall } from '../../src/mcp/client';
import { createMcpServer } from '../../src/mcp/server';
import { FakeLifecycleHost, buildFullRegistry } from '../helpers/registry';
import { loadSkill } from '../helpers/skill';

const root = path.resolve(__dirname, '../..');
const rect = { type: 'rectangle', id: 'r1', x: 0, y: 0, width: 10, height: 10 };

let home: string;
let catalog: CatalogFile;
let skill: SkillFile;
const channels: IpcChannel[] = [];
const clients: Client[] = [];

function openWindow(folders: string[], name = 'win') {
  const lifecycle = new FakeLifecycleHost();
  const built = buildFullRegistry({ spy: false, lifecycleHost: lifecycle });
  const channel = new IpcChannel({
    registry: built.registry,
    home,
    ide: 'TestIDE',
    version: '9.9.9',
    folders: () => folders,
    workspaceName: () => name,
  });
  channels.push(channel);
  return { ...built, channel, lifecycle };
}

async function connectInProcess(env: NodeJS.ProcessEnv = {}): Promise<Client> {
  const server = createMcpServer({ catalog, skill, home, env, log: () => {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  clients.push(client);
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: any): string => r.content[0].text;
const json = (r: any): any => JSON.parse(text(r));

beforeAll(() => {
  const registry = buildFullRegistry({ spy: false }).registry;
  catalog = buildCatalog(registry, '0.0.0');
  skill = loadSkill(registry);
});
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'openboard-e2e-'));
});
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const c of channels.splice(0)) c.stop();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe('local channel', () => {
  it('listens only on a pipe/socket path and writes a private record', async () => {
    const listen = vi.spyOn(net.Server.prototype, 'listen');
    const { channel } = openWindow(['/proj']);
    await channel.start();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(typeof listen.mock.calls[0]![0]).toBe('string');
    if (process.platform === 'win32') expect(channel.endpoint).toMatch(/^\\\\\.\\pipe\\openboard-[0-9a-f]+$/);
    else expect(channel.endpoint.startsWith(path.join(home, 'run'))).toBe(true);
    expect(readdirSync(instancesDir(home))).toEqual([`${channel.instanceId}.json`]);
    channel.stop();
    expect(readdirSync(instancesDir(home))).toEqual([]);
    if (process.platform !== 'win32') expect(existsSync(channel.endpoint)).toBe(false);
  });

  it('answers ping/list/describe/invoke with the right token and rejects bad tokens', async () => {
    const { channel, model } = openWindow(['/proj']);
    await channel.start();
    const target = { endpoint: channel.endpoint, token: channel.token };
    expect(await ipcCall(target, 'ping')).toMatchObject({ ok: true, workspaceId: channel.workspaceId });
    expect(await ipcCall(target, 'list')).toContain('openboard.element.create');
    expect(await ipcCall(target, 'describe', { name: 'openboard.element.create' })).toMatchObject({ description: expect.any(String) });
    await ipcCall(target, 'invoke', { name: 'openboard.element.create', input: { elements: [rect] } });
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['r1']);

    const bad = ipcCall({ endpoint: channel.endpoint, token: 'x'.repeat(64) }, 'ping');
    await expect(bad).rejects.toMatchObject({ code: 'unauthorized', message: 'unauthorized' });
    await expect(ipcCall({ endpoint: channel.endpoint, token: '' }, 'invoke', { name: 'openboard.element.create', input: { elements: [{ ...rect, id: 'evil' }] } })).rejects.toBeInstanceOf(IpcCallError);
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['r1']);
    await expect(ipcCall(target, 'invoke', { name: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps a session open across calls: one undo entry on commit, nothing on rollback', async () => {
    const { channel, model, history } = openWindow(['/proj']);
    await channel.start();
    const target = { endpoint: channel.endpoint, token: channel.token };
    const add = (session: string, id: string) =>
      ipcCall(target, 'invoke', { name: 'openboard.element.create', input: { elements: [{ ...rect, id }] }, session });

    await add('s1', 'a');
    await add('s1', 'b');
    // visible immediately, but not yet an undo entry
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(history.undoCount()).toBe(0);
    expect(await ipcCall(target, 'end', { name: 's1', input: { commit: true } })).toMatchObject({ ended: true, committed: true });
    expect(history.undoCount()).toBe(1);
    history.undo(model);
    expect(model.getDocument().elements).toEqual([]);

    await add('s2', 'c');
    expect(await ipcCall(target, 'end', { name: 's2', input: { commit: false } })).toMatchObject({ ended: true, committed: false });
    expect(model.getDocument().elements).toEqual([]);
    expect(history.undoCount()).toBe(0);
    expect(await ipcCall(target, 'end', { name: 'never-started', input: { commit: true } })).toMatchObject({ ended: false });
  });

  it('rolls back an open session when the channel stops', async () => {
    const { channel, model, history } = openWindow(['/proj']);
    await channel.start();
    const target = { endpoint: channel.endpoint, token: channel.token };
    await ipcCall(target, 'invoke', { name: 'openboard.element.create', input: { elements: [rect] }, session: 'dead' });
    expect(model.getDocument().elements).toHaveLength(1);
    channel.stop();
    expect(model.getDocument().elements).toEqual([]);
    expect(history.undoCount()).toBe(0);
  });

  it('survives malformed lines', async () => {
    const { channel } = openWindow(['/proj']);
    await channel.start();
    const reply = await new Promise<string>((resolve, reject) => {
      const s = net.createConnection(channel.endpoint);
      let data = '';
      s.on('data', (d) => {
        data += d.toString();
        if (data.includes('\n')) {
          s.destroy();
          resolve(data);
        }
      });
      s.on('error', reject);
      s.on('connect', () => s.write('this is not json\n'));
    });
    expect(JSON.parse(reply)).toMatchObject({ id: null, error: { code: 'bad_request' } });
    expect(await ipcCall({ endpoint: channel.endpoint, token: channel.token }, 'ping')).toMatchObject({ ok: true });
  });

  it('rejects oversized requests', async () => {
    const built = buildFullRegistry({ spy: false });
    const channel = new IpcChannel({
      registry: built.registry,
      home,
      ide: 'T',
      version: '1',
      folders: () => ['/p'],
      workspaceName: () => 'p',
      maxMessageBytes: 1024,
    });
    channels.push(channel);
    await channel.start();
    await expect(ipcCall({ endpoint: channel.endpoint, token: channel.token }, 'invoke', { name: 'openboard.element.create', input: { pad: 'x'.repeat(5000) } })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('updates the record and notifies when the workspace id changes', async () => {
    let folders = ['/one'];
    const built = buildFullRegistry({ spy: false });
    const channel = new IpcChannel({ registry: built.registry, home, ide: 'T', version: '1', folders: () => folders, workspaceName: () => 'n' });
    channels.push(channel);
    await channel.start();
    const before = channel.workspaceId;
    const seen: string[] = [];
    channel.onDidChangeWorkspaceId((id) => seen.push(id));
    folders = ['/one', '/two'];
    expect(channel.refresh()).toBe(true);
    expect(channel.workspaceId).not.toBe(before);
    expect(seen).toEqual([channel.workspaceId]);
    expect(channel.refresh()).toBe(false);
  });
});

describe('MCP server (in process)', () => {
  it('lists exactly the five tools, with instructions, without any window running', async () => {
    const client = await connectInProcess();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...EXPOSED_TOOL_NAMES]);
    for (const n of tools.map((t) => t.name)) expect(n).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
    expect(JSON.stringify(tools.map((t) => [t.description, t.inputSchema])).length).toBeLessThan(4096);
    const call = tools.find((t) => t.name === 'openboard_call')!;
    expect((call.inputSchema.properties as any).action.enum).toContain('element.create');
    expect((call.inputSchema.properties as any).workspace.type).toBe('string');
    const instructions = client.getInstructions()!;
    expect(instructions).toBe(SERVER_INSTRUCTIONS);
    expect(instructions.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(instructions.split('\n').length).toBeLessThanOrEqual(6);
    expect(instructions).toContain('openboard_read_skill');
    const none = await client.callTool({ name: 'openboard_call', arguments: { action: 'element.create', input: { elements: [rect] } } });
    expect(none.isError).toBe(true);
    expect(text(none)).toContain('No OpenBoard window is running');
  });

  it('serves the skill: index, topics, unknown topic, and openboard://skill/<topic> resources', async () => {
    const client = await connectInProcess();
    const index = await client.callTool({ name: 'openboard_read_skill', arguments: {} });
    expect(index.isError).toBeFalsy();
    for (const id of ['overview', 'elements', 'editing', 'flowcharts', 'export', 'library', 'code-mode', 'actions']) {
      expect(text(index)).toContain(`- ${id}:`);
    }
    const code = await client.callTool({ name: 'openboard_read_skill', arguments: { topic: 'code-mode' } });
    expect(text(code)).toContain('declare const ob');
    expect(text(code)).toContain('importMermaid');
    const bad = await client.callTool({ name: 'openboard_read_skill', arguments: { topic: 'nope' } });
    expect(bad.isError).toBe(true);
    expect(json(bad).error.code).toBe('unknown_topic');
    expect(json(bad).error.message).toContain('code-mode');

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(skill.topics.map((t) => `openboard://skill/${t.id}`).sort());
    const read = await client.readResource({ uri: 'openboard://skill/overview' });
    expect((read.contents[0] as any).text).toBe(skill.topics.find((t) => t.id === 'overview')!.content);
    await expect(client.readResource({ uri: 'openboard://skill/zzz' })).rejects.toThrow();
  });

  it('openboard_call routes to the only window when workspace is omitted', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const res = await client.callTool({ name: 'openboard_call', arguments: { action: 'element.create', input: { elements: [rect] } } });
    expect(res.isError).toBeFalsy();
    expect(json(res).ids).toEqual(['r1']);
    expect(win.model.getDocument().elements.map((e) => e.id)).toEqual(['r1']);
  });

  it('openboard_call: unknown action and validation errors carry the issues and a skill hint', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const unknown = await client.callTool({ name: 'openboard_call', arguments: { action: 'element.explode' } });
    expect(unknown.isError).toBe(true);
    expect(json(unknown).error.code).toBe('unknown_action');
    const invalid = await client.callTool({ name: 'openboard_call', arguments: { action: 'element.create', input: { elements: 'nope' } } });
    expect(invalid.isError).toBe(true);
    const err = json(invalid).error;
    expect(err.code).toBe('invalid_input');
    expect(err.issues.length).toBeGreaterThan(0);
    expect(err.hint).toMatch(/openboard_read_skill.*actions/);
    const missing = await client.callTool({ name: 'openboard_call', arguments: { action: 'element.update', input: { ids: ['missing'], set: { x: 1 } } } });
    expect(missing.isError).toBe(true);
    expect(json(missing).error.code).toEqual(expect.any(String));
  });

  it('requires `workspace` with two windows and lists both in the error', async () => {
    const a = openWindow(['/proj-a'], 'a');
    const b = openWindow(['/proj-b'], 'b');
    await a.channel.start();
    await b.channel.start();
    const client = await connectInProcess();
    const args = (extra: Record<string, unknown> = {}) => ({ action: 'element.create', input: { elements: [rect] }, ...extra });
    const res = await client.callTool({ name: 'openboard_call', arguments: args() });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain(a.channel.workspaceId);
    expect(text(res)).toContain(b.channel.workspaceId);
    expect(text(res)).toContain('/proj-a');
    expect(text(res)).toContain('/proj-b');

    const list = await client.callTool({ name: 'openboard_workspaces', arguments: {} });
    const workspaces = json(list).workspaces as { workspaceId: string; ide: string; workspaceName: string; folders: string[] }[];
    expect(workspaces.map((w) => w.workspaceId).sort()).toEqual([a.channel.workspaceId, b.channel.workspaceId].sort());
    expect(workspaces[0]!.ide).toBe('TestIDE');
    expect(Object.keys(workspaces[0]!).sort()).toEqual(['folders', 'ide', 'workspaceId', 'workspaceName']);

    // explicit id and OPENBOARD_WORKSPACE_ID select a window; `workspace` is not forwarded as input
    await client.callTool({ name: 'openboard_call', arguments: { action: 'element.create', input: { elements: [{ ...rect, id: 'rb' }] }, workspace: b.channel.workspaceId } });
    expect(b.model.getDocument().elements.map((e) => e.id)).toEqual(['rb']);
    expect(a.model.getDocument().elements).toEqual([]);
    const envClient = await connectInProcess({ OPENBOARD_WORKSPACE_ID: a.channel.workspaceId });
    const viaEnv = await envClient.callTool({ name: 'openboard_call', arguments: args() });
    expect(viaEnv.isError).toBeFalsy();
    expect(a.model.getDocument().elements.map((e) => e.id)).toContain('r1');

    // execute and save honor `workspace` too
    const exec = await client.callTool({ name: 'openboard_execute', arguments: { workspace: b.channel.workspaceId, code: 'return (await ob.board().query({})).total' } });
    expect(json(exec).result).toBe(1);
    const noWs = await client.callTool({ name: 'openboard_execute', arguments: { code: 'return 1' } });
    expect(noWs.isError).toBe(true);
    expect(text(noWs)).toContain(a.channel.workspaceId);
  });

  it('forgets a window once it stops', async () => {
    const a = openWindow(['/proj-a']);
    const b = openWindow(['/proj-b']);
    await a.channel.start();
    await b.channel.start();
    const client = await connectInProcess();
    a.channel.stop();
    const res = await client.callTool({ name: 'openboard_call', arguments: { action: 'element.create', input: { elements: [rect] } } });
    expect(res.isError).toBeFalsy();
    expect(b.model.getDocument().elements).toHaveLength(1);
  });

  it('openboard_save saves the active board and a named board, returning {saved}', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const ok = await client.callTool({ name: 'openboard_save', arguments: {} });
    expect(ok.isError).toBeFalsy();
    expect(json(ok)).toEqual({ saved: '/b.openboard' });
    const named = await client.callTool({ name: 'openboard_save', arguments: { board: '/b.openboard' } });
    expect(json(named)).toEqual({ saved: '/b.openboard' });
    expect(win.lifecycle.calls.filter((c) => c.startsWith('save:'))).toEqual(['save:/b.openboard', 'save:/b.openboard']);
  });
});

describe('openboard_execute (in process)', () => {
  const run = async (client: Client, code: string, extra: Record<string, unknown> = {}) =>
    client.callTool({ name: 'openboard_execute', arguments: { code, ...extra } });

  it('runs a script: happy path with return value, logs, and live reads of earlier writes', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const res = await run(
      client,
      `const board = ob.board();
       const ids = await board.create([{ type: 'rectangle', id: 'a', x: 0, y: 0 }, { type: 'ellipse', id: 'b', x: 200, y: 0 }]);
       console.log('created', ids.join(','));
       console.warn('careful');
       console.error({ e: 1 });
       const seen = await board.get('a');
       return { ids, type: seen.type, total: (await board.query({})).total };`,
    );
    expect(res.isError).toBeFalsy();
    expect(json(res)).toEqual({
      result: { ids: ['a', 'b'], type: 'rectangle', total: 2 },
      logs: ['created a,b', '[warn] careful', '[error] {"e":1}'],
    });
    expect(win.model.getDocument().elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('creates two elements and connects them as exactly ONE undo entry', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const res = await run(
      client,
      `const [a, b] = await ob.board().create([{ type: 'flowNode', id: 'a' }, { type: 'flowNode', id: 'b' }]);
       const edge = await ob.board().connect(a, b, { label: 'go' });
       return edge.ids.length;`,
    );
    expect(json(res).result).toBe(1);
    expect(win.model.getDocument().elements.map((e) => e.type)).toEqual(['flowNode', 'flowNode', 'edge']);
    expect(win.history.undoCount()).toBe(1);
    win.history.undo(win.model);
    expect(win.model.getDocument().elements).toEqual([]);
    expect(win.history.canUndo()).toBe(false);
    win.history.redo(win.model);
    expect(win.model.getDocument().elements).toHaveLength(3);
  });

  it('leaves the board unchanged when the script throws midway', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    await win.registry.invoke('openboard.element.create', { elements: [{ ...rect, id: 'keep' }] });
    const before = JSON.stringify(win.model.getDocument());
    const undoBefore = win.history.undoCount();
    const res = await run(
      client,
      `await ob.board().create([{ type: 'rectangle', id: 'x1' }]);
       await ob.board().update(['keep'], { x: 500 });
       await ob.board().remove(['keep']);
       console.log('about to fail');
       throw new Error('boom');`,
    );
    expect(res.isError).toBe(true);
    const body = json(res);
    expect(body.error.code).toBe('script_error');
    expect(body.error.message).toContain('boom');
    expect(body.rolledBack).toBe(true);
    expect(body.logs).toEqual(['about to fail']);
    expect(JSON.stringify(win.model.getDocument())).toBe(before);
    expect(win.history.undoCount()).toBe(undoBefore);
  });

  it('rolls back when a tool call fails inside the script, and the error carries the issues', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const res = await run(client, `await ob.board().create({ type: 'rectangle', id: 'ok' }); await ob.board().update(['nope'], { x: 1 });`);
    expect(res.isError).toBe(true);
    expect(json(res).error.message).toMatch(/\[not_found\]/);
    expect(win.model.getDocument().elements).toEqual([]);
    const bad = await run(client, `await ob.board().create({ type: 'rectangle', width: -5 });`);
    expect(json(bad).error.message).toMatch(/invalid_input/);
    expect(win.history.undoCount()).toBe(0);
  });

  it('keeps edits when the script catches the failing call itself', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const res = await run(client, `await ob.board().create({ type: 'rectangle', id: 'kept' }); try { await ob.board().remove(['ghost']); } catch (e) { return e.code; }`);
    expect(json(res).result).toBe('not_found');
    expect(win.model.getDocument().elements.map((e) => e.id)).toEqual(['kept']);
    expect(win.history.undoCount()).toBe(1);
  });

  it('stops an infinite loop at the timeout and rolls back', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const t0 = Date.now();
    const res = await run(client, `await ob.board().create({ type: 'rectangle', id: 'late' }); while (true) {}`, { timeoutMs: 400 });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(res.isError).toBe(true);
    expect(json(res).error.code).toBe('timeout');
    expect(win.model.getDocument().elements).toEqual([]);
  });

  it('refuses a runaway memory allocation', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    const res = await run(client, `const a = []; while (true) a.push('x'.repeat(1 << 20) + a.length);`, { timeoutMs: 20000 });
    expect(res.isError).toBe(true);
    expect(json(res).error.code).toBe('memory');
  }, 30_000);

  it('validates its input', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const client = await connectInProcess();
    expect(json(await run(client, '   ')).error.code).toBe('invalid_input');
    expect(json(await client.callTool({ name: 'openboard_execute', arguments: { code: 'return 1', timeoutMs: -3 } })).error.code).toBe('invalid_input');
    expect(json(await run(client, 'return 7', { timeoutMs: 999999 })).result).toBe(7);
  });
});

describe('built stdio bundle', () => {
  beforeAll(() => {
    if (
      !existsSync(path.join(root, 'dist/mcp.js')) ||
      !existsSync(path.join(root, 'dist/mcp-tools.json')) ||
      !existsSync(path.join(root, 'dist/mcp-skill.json')) ||
      !existsSync(path.join(root, 'dist/quickjs.wasm'))
    ) {
      execFileSync(process.execPath, ['esbuild.config.mjs'], { cwd: root, stdio: 'pipe' });
    }
  }, 180_000);
  afterAll(() => undefined);

  it('serves tools/list, the skill, and runs sandboxed scripts against a window over stdio', async () => {
    const win = openWindow(['/proj']);
    await win.channel.start();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'dist/mcp.js')],
      env: { ...(process.env as Record<string, string>), OPENBOARD_HOME: home },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '0' });
    clients.push(client);
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...EXPOSED_TOOL_NAMES]);
    expect(client.getInstructions()).toContain('openboard_read_skill');
    const skillRes = await client.callTool({ name: 'openboard_read_skill', arguments: { topic: 'actions' } });
    expect(text(skillRes)).toContain('### element.create');

    const res = await client.callTool({ name: 'openboard_call', arguments: { action: 'element.create', input: { elements: [rect] } } });
    expect(res.isError).toBeFalsy();
    expect(win.model.getDocument().elements.map((e) => e.id)).toEqual(['r1']);

    const exec = await client.callTool({ name: 'openboard_execute', arguments: { code: `await ob.board().create({ type: 'ellipse', id: 'e1' }); return (await ob.board().query({})).total;` } });
    expect(json(exec).result).toBe(2);
    expect(win.history.undoCount()).toBe(2); // the call and the whole script: one entry each

    // the sandbox has no way to reach the host
    const probe = await client.callTool({
      name: 'openboard_execute',
      arguments: { code: `return [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof globalThis.__ob_call];` },
    });
    expect(json(probe).result).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
  }, 60_000);
});
