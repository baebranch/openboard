/**
 * Extension-host scenarios run against the in-memory fake `vscode` module (test/helpers/fake-vscode.ts).
 * They mirror test/integration (real VS Code) as far as a fake can.
 * Validates: Requirements 1.3, 2.4, 2.7, 2.8, 14.1, 14.4, 15.5, 15.6, 16.6
 */
import { EXPOSED_TOOL_NAMES } from '../../src/codemode/surface';
import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, Uri } from '../helpers/fake-vscode';

// The MCP channel writes under OPENBOARD_HOME; keep it out of the real home directory.
const obHome = mkdtempSync(path.join(os.tmpdir(), 'openboard-ext-'));
process.env.OPENBOARD_HOME = obHome;
afterAll(() => rmSync(obHome, { recursive: true, force: true }));

vi.mock('vscode', async () => (await import('../helpers/fake-vscode')).vscodeModule);

// provider.ts loads dist/validators.js with a free `require`; ESM test modules have none.
(globalThis as { require?: NodeRequire }).require ??= createRequire(import.meta.url);

import { activate, deactivate } from '../../src/host/extension';
import type { OpenBoardApi } from '../../src/host/agent/bridge';

const ctx = () =>
  ({ extensionUri: Uri.file(process.cwd()), subscriptions: [] as { dispose(): unknown }[] }) as never;

const boardUri = (name: string) => Uri.file(`/ws/${name}.openboard`);
const provider = () => harness.customEditors.get('openboard.board')!.provider;

let api: OpenBoardApi;
let subs: { dispose(): unknown }[];

function start(): void {
  const c = ctx() as { subscriptions: { dispose(): unknown }[] };
  api = activate(c as never);
  subs = c.subscriptions;
}

async function createBoard(name: string): Promise<string> {
  const uri = boardUri(name).toString();
  await api.invoke('openboard.board.create', { path: uri });
  return uri;
}

const addRect = (board: string, id: string) =>
  api.invoke('openboard.element.create', { board, elements: [{ type: 'rectangle', id }] });

const lmInvoke = async (tool: string, input: unknown): Promise<{ content: { value: string }[] }> => {
  const t = harness.registeredTools.get(tool) as { invoke(o: { input: unknown }): Promise<{ content: { value: string }[] }> };
  return t.invoke({ input });
};

const ids = async (board: string) =>
  ((await api.invoke('openboard.element.query', { board })) as { items: { id: string }[] }).items.map((e) => e.id);

beforeEach(() => {
  harness.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  deactivate();
  for (const s of subs ?? []) s.dispose();
  subs = [];
});

describe('activation and agent surface', () => {
  it('exports exactly {list, describe, invoke} and registers the commands', () => {
    start();
    expect(Object.keys(api).sort()).toEqual(['describe', 'invoke', 'list']);
    expect(api.list().length).toBeGreaterThan(10);
    expect(harness.commandHandlers.has('openboard.invokeTool')).toBe(true);
    expect(harness.customEditors.has('openboard.board')).toBe(true);
  });

  it('registers exactly the five exposed LM tools when vscode.lm exists (registry stays at full size)', () => {
    start();
    expect([...harness.registeredTools.keys()].sort()).toEqual([...EXPOSED_TOOL_NAMES].sort());
    expect(api.list()).toHaveLength(40);
    expect(api.list().every((n) => n.startsWith('openboard.'))).toBe(true);
  });

  it('activates gracefully without vscode.lm', async () => {
    harness.hasLm = false;
    start();
    expect(harness.registeredTools.size).toBe(0);
    await expect(api.invoke('openboard.board.list', {})).resolves.toBeDefined();
  });

  it('openboard.invokeTool rejects an unknown tool and bad JSON input by argument name', async () => {
    start();
    await expect(harness.run('openboard.invokeTool', 'nope', {})).rejects.toThrow(/"name"/);
    await expect(harness.run('openboard.invokeTool', 'openboard.board.list', '{bad')).rejects.toThrow(/"input"/);
  });
});

describe('custom editor, edit and save', () => {
  it('opens a board in the custom editor and answers ready with init', async () => {
    start();
    const uri = await createBoard('a');
    const panel = harness.panels[0]!;
    expect(panel.webview.html).toContain('<script');
    panel.receive({ type: 'ready' });
    expect(panel.posted.some((m) => (m as { type: string }).type === 'init')).toBe(true);
    expect(harness.readText(Uri.parse(uri))).toContain('"elements"');
  });

  it('edits via openboard.invokeTool then saves atomically to parseable JSON', async () => {
    start();
    const uri = await createBoard('a');
    await harness.run('openboard.invokeTool', 'openboard.element.create', {
      board: uri,
      elements: [{ type: 'rectangle', id: 'r1' }],
    });
    const before = harness.readText(Uri.parse(uri));
    expect(before).not.toContain('"r1"'); // not saved yet
    harness.fsLog.length = 0;
    await harness.run('openboard.invokeTool', 'openboard.board.save', JSON.stringify({ board: uri }));
    const text = harness.readText(Uri.parse(uri))!;
    expect(JSON.parse(text).elements.map((e: { id: string }) => e.id)).toEqual(['r1']);
    expect(harness.fsLog[0]).toMatch(/^write .*\.tmp$/);
    expect(harness.fsLog[1]).toMatch(/^rename .*\.tmp -> /);
    expect([...harness.files.keys()].some((k) => k.endsWith('.tmp'))).toBe(false);
  });

  it('Reopen Editor With text shows the JSON', async () => {
    start();
    const uri = await createBoard('a');
    await addRect(uri, 'r1');
    await harness.run('openboard.invokeTool', 'openboard.board.save', { board: uri });
    await harness.run('openboard.openAsText');
    const opened = harness.textEditorsOpened.at(-1)!;
    expect(opened.uri.toString()).toBe(uri);
    expect(JSON.parse(opened.text).elements).toHaveLength(1);
  });

  it('Toggle Grid is a single undoable, dirtying edit stored in the board file', async () => {
    start();
    const uri = await createBoard('grid');
    await api.invoke('openboard.board.save', { board: uri });
    const doc = provider().documents.get(uri);
    const history = doc.state.history;
    const gridOf = () => doc.state.getDocument().settings?.grid;
    expect(doc.dirty).toBe(false);
    const before = history.undoCount();

    await harness.run('openboard.toggleGrid');
    expect(gridOf()?.enabled).toBe(false);
    expect(doc.dirty).toBe(true);
    expect(history.undoCount()).toBe(before + 1);

    await api.invoke('openboard.board.save', { board: uri });
    expect(JSON.parse(harness.readText(Uri.parse(uri))!).settings.grid.enabled).toBe(false);

    await harness.run('openboard.toggleGrid');
    expect(gridOf()?.enabled).toBe(true);
    expect(history.undoCount()).toBe(before + 2);

    history.undo(doc.state.model);
    expect(gridOf()?.enabled).toBe(false);
    history.undo(doc.state.model);
    expect(gridOf()?.enabled ?? true).toBe(true);
    expect(history.undoCount()).toBe(before);
  });

  it('hot exit: a backup of unsaved edits restores them on reopen', async () => {
    start();
    const uri = await createBoard('a');
    await addRect(uri, 'r1');
    const p = provider();
    const doc = p.documents.get(uri);
    const dest = Uri.file('/backup/a.bak');
    const backup = await p.backupCustomDocument(doc, { destination: dest }, undefined);
    expect(harness.readText(dest)).toContain('"r1"');
    const restored = await p.openCustomDocument(
      Uri.file('/ws/elsewhere.openboard'),
      { backupId: backup.id, untitledDocumentData: undefined },
      undefined,
    );
    expect(restored.state.getDocument().elements.map((e: { id: string }) => e.id)).toEqual(['r1']);
    await backup.delete();
    expect(harness.readText(dest)).toBeUndefined();
  });
});

describe('API / command parity', () => {
  it('returns identical results through api.invoke and openboard.invokeTool', async () => {
    start();
    const a = await createBoard('p1');
    const b = await createBoard('p2');
    const els = [{ type: 'rectangle', id: 'r' }, { type: 'text', id: 't', text: 'hi' }];
    const viaApi = await api.invoke('openboard.element.create', { board: a, elements: els });
    const viaCmd = await harness.run('openboard.invokeTool', 'openboard.element.create', { board: b, elements: els });
    expect(viaCmd).toEqual(viaApi);
    const qa = await api.invoke('openboard.element.query', { board: a });
    const qb = await harness.run('openboard.invokeTool', 'openboard.element.query', { board: b });
    expect(qb).toEqual(qa);
  });

  it('openboard_call returns the same JSON as the API', async () => {
    start();
    const a = await createBoard('p1');
    const lm = await lmInvoke('openboard_call', { action: 'element.query', input: { board: a } });
    expect(JSON.parse(lm.content[0]!.value)).toEqual(await api.invoke('openboard.element.query', { board: a }));
  });
});

describe('code mode in the extension host', () => {
  it('openboard_execute edits through the sandbox as ONE undo entry and a real undo reverts it', async () => {
    start();
    const uri = await createBoard('x');
    const doc = provider().documents.get(uri);
    const history = doc.state.history;
    const before = history.undoCount();
    const out = await lmInvoke('openboard_execute', {
      board: uri,
      code: `const ids = await ob.board().create([{type:'rectangle',id:'a'},{type:'rectangle',id:'b'}]);
             await ob.board().connect('a','b'); console.log('made', ids.length);
             return (await ob.board().query({})).total;`,
    });
    const res = JSON.parse(out.content[0]!.value);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(3);
    expect(res.logs).toEqual(['made 2']);
    expect(history.undoCount()).toBe(before + 1);
    expect(await ids(uri)).toHaveLength(3);
    history.undo(doc.state.model);
    expect(await ids(uri)).toEqual([]);
  });

  it('openboard_execute rolls everything back when the script throws', async () => {
    start();
    const uri = await createBoard('x');
    const doc = provider().documents.get(uri);
    const before = doc.state.history.undoCount();
    const out = await lmInvoke('openboard_execute', {
      board: uri,
      code: `await ob.board().create([{type:'rectangle',id:'a'}]); throw new Error('boom');`,
    });
    const res = JSON.parse(out.content[0]!.value);
    expect(res.error.message).toContain('boom');
    expect(res.rolledBack).toBe(true);
    expect(await ids(uri)).toEqual([]);
    expect(doc.state.history.undoCount()).toBe(before);
  });

  it('openboard_save saves a dirty board that has an editor tab through the IDE save command', async () => {
    start();
    const uri = await createBoard('tab');
    await addRect(uri, 'r1');
    const doc = provider().documents.get(uri);
    expect(doc.dirty).toBe(true);
    const out = await lmInvoke('openboard_save', { board: uri });
    expect(JSON.parse(out.content[0]!.value)).toEqual({ saved: uri });
    expect(harness.ideSaves).toBe(1);
    expect(doc.dirty).toBe(false);
    expect(JSON.parse(harness.readText(Uri.parse(uri))!).elements.map((e: { id: string }) => e.id)).toEqual(['r1']);
  });

  it('saving the active board when `board` is omitted, and ob.board().save() in a script', async () => {
    start();
    const uri = await createBoard('act');
    await addRect(uri, 'r1');
    await lmInvoke('openboard_save', {});
    expect(provider().documents.get(uri).dirty).toBe(false);
    const out = await lmInvoke('openboard_execute', {
      code: `await ob.board().create({type:'ellipse',id:'e1'}); return await ob.board().save();`,
    });
    expect(JSON.parse(out.content[0]!.value).result.saved).toBe(true);
    expect(provider().documents.get(uri).dirty).toBe(false);
    expect(JSON.parse(harness.readText(Uri.parse(uri))!).elements.map((e: { id: string }) => e.id)).toEqual(['r1', 'e1']);
  });

  it('saves a background-opened board (no tab) atomically without the IDE command', async () => {
    start();
    const uri = await createBoard('bg');
    await api.invoke('openboard.board.save', { board: uri });
    await api.invoke('openboard.board.close', { board: uri });
    harness.ideSaves = 0;
    await api.invoke('openboard.board.open', { path: uri, background: true });
    expect(harness.tabs.some((t) => (t.input as { uri?: Uri }).uri?.toString() === uri)).toBe(false);
    await addRect(uri, 'bg1');
    expect(provider().documents.get(uri).dirty).toBe(true);
    harness.fsLog.length = 0;
    const out = await lmInvoke('openboard_save', { board: uri });
    expect(JSON.parse(out.content[0]!.value).saved).toBe(uri);
    expect(harness.ideSaves).toBe(0);
    expect(harness.fsLog[0]).toMatch(/^write .*\.tmp$/);
    expect(harness.fsLog[1]).toMatch(/^rename .*\.tmp -> /);
    expect(provider().documents.get(uri).dirty).toBe(false);
    expect(JSON.parse(harness.readText(Uri.parse(uri))!).elements.map((e: { id: string }) => e.id)).toEqual(['bg1']);
  });
});

describe('external file changes', () => {
  async function diskVersionWith(id: string): Promise<string> {
    const other = await createBoard(`other-${id}`);
    await addRect(other, id);
    await api.invoke('openboard.board.save', { board: other });
    return harness.readText(Uri.parse(other))!;
  }

  it('reloads a clean document within 2 s', async () => {
    start();
    const uri = await createBoard('a');
    const text = await diskVersionWith('ext');
    const t0 = Date.now();
    harness.putFile(Uri.parse(uri), text);
    harness.fireFileChange(Uri.parse(uri));
    await vi.waitFor(async () => expect(await ids(uri)).toEqual(['ext']), { timeout: 2000 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(harness.showWarningMessage).not.toHaveBeenCalled();
  });

  it('prompts on a dirty document and keeps local edits on "Keep local"', async () => {
    start();
    const uri = await createBoard('a');
    await addRect(uri, 'mine');
    harness.showWarningMessage.mockResolvedValue('Keep local');
    harness.putFile(Uri.parse(uri), await diskVersionWith('ext'));
    harness.fireFileChange(Uri.parse(uri));
    await vi.waitFor(() => expect(harness.showWarningMessage).toHaveBeenCalledTimes(1));
    expect(harness.showWarningMessage.mock.calls[0]![0]).toMatch(/unsaved edits/);
    expect(await ids(uri)).toEqual(['mine']);
  });

  it('loads the disk version on "Load disk version"', async () => {
    start();
    const uri = await createBoard('a');
    await addRect(uri, 'mine');
    harness.showWarningMessage.mockResolvedValue('Load disk version');
    harness.putFile(Uri.parse(uri), await diskVersionWith('ext'));
    harness.fireFileChange(Uri.parse(uri));
    await vi.waitFor(async () => expect(await ids(uri)).toEqual(['ext']));
  });

  it('does not treat our own save as an external change', async () => {
    start();
    const uri = await createBoard('a');
    await addRect(uri, 'mine');
    await api.invoke('openboard.board.save', { board: uri });
    harness.fireFileChange(Uri.parse(uri));
    await new Promise((r) => setTimeout(r, 50));
    expect(harness.showWarningMessage).not.toHaveBeenCalled();
    expect(await ids(uri)).toEqual(['mine']);
  });
});

describe('webview recovery', () => {
  it('restarts an unresponsive webview within the watchdog window and re-inits on ready', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    const uri = await createBoard('a');
    await addRect(uri, 'r1');
    const panel = harness.panels[0]!;
    const htmlBefore = panel.webview.html;
    await vi.advanceTimersByTimeAsync(3000); // WATCHDOG_TIMEOUT_MS, never saw `ready`
    expect(panel.webview.html).not.toBe('');
    expect(panel.webview.html).not.toBe(htmlBefore); // reloaded with a fresh nonce
    panel.receive({ type: 'ready' });
    const init = panel.posted.filter((m) => (m as { type: string }).type === 'init').at(-1) as {
      doc: { elements: { id: string }[] };
    };
    expect(init.doc.elements.map((e) => e.id)).toEqual(['r1']); // state survived in the host
  });

  it('does not restart a webview that reported ready', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    start();
    await createBoard('a');
    const panel = harness.panels[0]!;
    panel.receive({ type: 'ready' });
    const html = panel.webview.html;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(panel.webview.html).toBe(html);
  });
});

describe('MCP channel', () => {
  const instancesDir = path.join(obHome, 'instances');
  const records = () => (existsSync(instancesDir) ? readdirSync(instancesDir).filter((n) => n.endsWith('.json')) : []);
  const readRecord = () => JSON.parse(readFileSync(path.join(instancesDir, records()[0]!), 'utf8')) as Record<string, any>;

  it('writes an instance record on activation and removes it on deactivate', async () => {
    start();
    await vi.waitFor(() => expect(records()).toHaveLength(1));
    const rec = readRecord();
    expect(rec).toMatchObject({ ide: 'Fake IDE', pid: process.pid, folders: ['/ws'] });
    expect(rec.workspaceId).toMatch(/^[0-9a-f]{12}$/);
    expect(rec.token).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(path.join(obHome, 'bin', 'openboard-mcp.js'))).toBe(true);
    deactivate();
    expect(records()).toHaveLength(0);
  });

  it('registers the MCP server definition provider with this window\'s workspace id', async () => {
    start();
    await vi.waitFor(() => expect(records()).toHaveLength(1));
    const provider = harness.mcpProviders.get('openboard.mcp');
    expect(provider).toBeDefined();
    const [def] = await provider.provideMcpServerDefinitions();
    expect(def.command).toBe(process.execPath);
    expect(def.args[0]).toMatch(/mcp\.js$/);
    expect(def.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', OPENBOARD_WORKSPACE_ID: readRecord().workspaceId });
  });

  it('activates without the MCP provider API', async () => {
    harness.hasMcpApi = false;
    start();
    await vi.waitFor(() => expect(records()).toHaveLength(1));
    expect(harness.mcpProviders.size).toBe(0);
    expect(harness.registeredTools.size).toBeGreaterThan(0);
  });

  it('opens no channel when openboard.mcp.enabled is false and starts it when toggled on', async () => {
    harness.config['mcp.enabled'] = false;
    start();
    await new Promise((r) => setTimeout(r, 100));
    expect(records()).toHaveLength(0);
    harness.config['mcp.enabled'] = true;
    harness.configEmitter.fire({ affectsConfiguration: (s: string) => s === 'openboard.mcp.enabled' });
    await vi.waitFor(() => expect(records()).toHaveLength(1));
    harness.config['mcp.enabled'] = false;
    harness.configEmitter.fire({ affectsConfiguration: (s: string) => s === 'openboard.mcp.enabled' });
    await vi.waitFor(() => expect(records()).toHaveLength(0));
  });

  it('copyMcpConfig puts a global snippet on the clipboard', async () => {
    start();
    await harness.run('openboard.copyMcpConfig');
    const cfg = JSON.parse(harness.clipboardText) as { mcpServers: { openboard: { command: string; args: string[]; env?: unknown } } };
    expect(cfg.mcpServers.openboard.args[0]).toBe(path.join(obHome, 'bin', 'openboard-mcp.js'));
    expect(harness.clipboardText).not.toContain('OPENBOARD_WORKSPACE_ID');
    expect(harness.showInformationMessage).toHaveBeenCalled();
  });
});

describe('offline operation', () => {
  it('makes no network connections during activation, edit and save', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const connect = vi.spyOn(net.Socket.prototype, 'connect');
    const request = vi.spyOn(http, 'request');
    const requestS = vi.spyOn(https, 'request');
    start();
    const uri = await createBoard('a');
    await addRect(uri, 'r1');
    await api.invoke('openboard.board.save', { board: uri });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(requestS).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
