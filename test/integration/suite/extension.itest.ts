/**
 * Real VS Code scenarios (run inside the extension host by `npm run test:integration`).
 * The same scenarios run under vitest against a fake `vscode` in test/host/extension.test.ts.
 * Validates: Requirements 1.3, 2.4, 2.7, 2.8, 14.1, 14.4, 15.5, 15.6, 16.6
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import * as vscode from 'vscode';
import { Skip, assert, assertEqual, test, waitFor } from './harness';

interface Api {
  list(): string[];
  describe(name: string): unknown;
  invoke(name: string, input: unknown): Promise<unknown>;
}

const EXTENSION_ID = 'baebranch.openboard';
const workspaceDir = process.env.OPENBOARD_INT_WORKSPACE ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
let counter = 0;

async function api(): Promise<Api> {
  const ext = vscode.extensions.getExtension<Api>(EXTENSION_ID);
  assert(ext, `extension ${EXTENSION_ID} is installed`);
  return ext.isActive ? ext.exports : ext.activate();
}

function newBoardPath(): string {
  return path.join(workspaceDir, `board-${Date.now()}-${counter++}.openboard`);
}

async function createBoard(a: Api): Promise<{ file: string; uri: string }> {
  const file = newBoardPath();
  const uri = vscode.Uri.file(file).toString();
  const r = (await a.invoke('openboard.board.create', { path: uri })) as { error?: unknown };
  assert(!r?.error, `board.create succeeded: ${JSON.stringify(r)}`);
  return { file, uri };
}

const ids = async (a: Api, board: string): Promise<string[]> =>
  ((await a.invoke('openboard.element.query', { board })) as { items: { id: string }[] }).items.map((e) => e.id);

function activeCustomTab(): vscode.TabInputCustom | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input : undefined;
}

async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(undefined, () => undefined);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

test('activates and exports exactly {list, describe, invoke}', async () => {
  const a = await api();
  assertEqual(Object.keys(a).sort(), ['describe', 'invoke', 'list'], 'exported API keys');
  assert(a.list().length > 10 && a.list().every((n) => n.startsWith('openboard.')), 'tool names');
});

test('opens a .openboard file in the custom editor', async () => {
  const a = await api();
  const { file } = await createBoard(a);
  await closeAll();
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  await waitFor(() => activeCustomTab()?.viewType === 'openboard.board', 5000, 'board custom editor tab');
  await closeAll();
});

test('edit via openboard.invokeTool then save writes parseable JSON atomically', async () => {
  const a = await api();
  const { file, uri } = await createBoard(a);
  await vscode.commands.executeCommand('openboard.invokeTool', 'openboard.element.create', {
    board: uri,
    elements: [{ type: 'rectangle', id: 'r1' }],
  });
  const boardTab = () =>
    vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => t.input instanceof vscode.TabInputCustom && t.input.uri.toString() === uri);
  await waitFor(() => boardTab()?.isDirty === true, 5000, 'board tab dirty after edit (hot-exit backup applies to it)');
  await vscode.commands.executeCommand('openboard.invokeTool', 'openboard.board.save', JSON.stringify({ board: uri }));
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { elements: { id: string }[] };
  assertEqual(doc.elements.map((e) => e.id), ['r1'], 'saved elements');
  const stray = readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp'));
  assertEqual(stray, [], 'no temp files left behind');
  await closeAll();
});

test('hot exit backup/restore', () => {
  throw new Skip('needs a window reload across processes; covered by test/host/extension.test.ts');
});

test("'Reopen Editor With' text editor shows JSON", async () => {
  const a = await api();
  const { uri } = await createBoard(a);
  await waitFor(() => activeCustomTab()?.viewType === 'openboard.board', 5000, 'board tab active');
  await vscode.commands.executeCommand('openboard.openAsText');
  await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === uri, 5000, 'text editor');
  const text = vscode.window.activeTextEditor!.document.getText();
  assert(Array.isArray((JSON.parse(text) as { elements?: unknown }).elements), 'text editor shows board JSON');
  await closeAll();
});

test('LM tools are registered when vscode.lm exists, absent gracefully otherwise', async () => {
  const a = await api();
  const lm = (vscode as unknown as { lm?: { tools?: readonly { name: string }[] } }).lm;
  if (!lm?.tools) {
    assert(a.list().length > 0, 'extension works without vscode.lm');
    return;
  }
  const names = new Set(lm.tools.map((t) => t.name));
  const missing = a.list().filter((n) => !names.has(n.replace(/\./g, "_")));
  assertEqual(missing, [], 'every registry tool is an LM tool');
});

test('API and openboard.invokeTool give identical results', async () => {
  const a = await api();
  const b1 = await createBoard(a);
  const b2 = await createBoard(a);
  const els = [{ type: 'rectangle', id: 'r' }, { type: 'text', id: 't', text: 'hi' }];
  const viaApi = await a.invoke('openboard.element.create', { board: b1.uri, elements: els });
  const viaCmd = await vscode.commands.executeCommand('openboard.invokeTool', 'openboard.element.create', { board: b2.uri, elements: els });
  assertEqual(viaCmd, viaApi, 'create results');
  assertEqual(
    await vscode.commands.executeCommand('openboard.invokeTool', 'openboard.element.query', { board: b2.uri }),
    await a.invoke('openboard.element.query', { board: b1.uri }),
    'query results',
  );
  await closeAll();
});

async function diskTextWith(a: Api, id: string): Promise<string> {
  const other = await createBoard(a);
  await a.invoke('openboard.element.create', { board: other.uri, elements: [{ type: 'rectangle', id }] });
  await a.invoke('openboard.board.save', { board: other.uri });
  return readFileSync(other.file, 'utf8');
}

test('external change reloads a clean document within 2 s', async () => {
  const a = await api();
  const text = await diskTextWith(a, 'ext');
  const { file, uri } = await createBoard(a);
  await new Promise((r) => setTimeout(r, 300)); // let the watcher attach
  writeFileSync(file, text);
  const ms = await waitFor(async () => (await ids(a, uri)).join() === 'ext', 2000, 'reload from disk');
  console.log(`    reloaded in ${ms} ms`);
  await closeAll();
});

test('external change on a dirty document prompts for conflict resolution', async () => {
  const a = await api();
  const win = vscode.window as { showWarningMessage: (...args: unknown[]) => Thenable<unknown> };
  const original = win.showWarningMessage;
  const prompts: unknown[] = [];
  try {
    win.showWarningMessage = async (...args: unknown[]) => (prompts.push(args[0]), 'Keep local');
  } catch {
    /* frozen API object */
  }
  if (win.showWarningMessage === original) throw new Skip('vscode.window cannot be stubbed in this host');
  try {
    const text = await diskTextWith(a, 'ext');
    const { file, uri } = await createBoard(a);
    await a.invoke('openboard.element.create', { board: uri, elements: [{ type: 'rectangle', id: 'mine' }] });
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(file, text);
    await waitFor(() => prompts.length > 0, 5000, 'conflict prompt');
    assert(String(prompts[0]).includes('unsaved edits'), 'conflict message');
    assertEqual(await ids(a, uri), ['mine'], 'local edits kept');
  } finally {
    win.showWarningMessage = original;
    await closeAll();
  }
});

test('webview crash recovery via the watchdog', () => {
  throw new Skip('a webview renderer cannot be hung from the test; host-side restart is covered by test/host/extension.test.ts');
});

test('operates offline: no outbound connections from the extension', async () => {
  const a = await api();
  const extDist = path.join(vscode.extensions.getExtension(EXTENSION_ID)!.extensionPath, 'dist');
  const proto = net.Socket.prototype as { connect: (...args: unknown[]) => unknown };
  const original = proto.connect;
  const ours: string[] = [];
  proto.connect = function (this: unknown, ...args: unknown[]) {
    const stack = new Error().stack ?? '';
    if (stack.includes(extDist)) ours.push(JSON.stringify(args[0]));
    return original.apply(this, args);
  };
  const fetchOrig = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => (fetched++, fetchOrig(...args))) as typeof fetch;
  try {
    const { file, uri } = await createBoard(a);
    await a.invoke('openboard.element.create', { board: uri, elements: [{ type: 'rectangle', id: 'r1' }] });
    await a.invoke('openboard.layout', { board: uri }).catch(() => undefined);
    await a.invoke('openboard.board.save', { board: uri });
    assert(existsSync(file), 'saved');
  } finally {
    proto.connect = original;
    globalThis.fetch = fetchOrig;
    await closeAll();
  }
  assertEqual(ours, [], 'socket connections initiated by the extension');
  assertEqual(fetched, 0, 'fetch calls');
});
