/**
 * vscode-backed hosts for the tool registry: BoardHost, BoardLifecycleHost and ExportHost.
 * Thin glue over BoardEditorProvider documents, workspace.fs and the render broker.
 */
import * as vscode from 'vscode';
import { serialize } from '../core/format/serializer';
import { createEmptyDocument } from '../core/format/parser';
import type { BoardInfo, BoardLifecycleHost } from '../core/tools/board-tools';
import type { ExportHost, RasterizeOptions } from '../core/tools/export-tools';
import { normalizeBoardPath, type BoardHost } from '../core/tools/resolution';
import type { RenderBroker } from './editor/recovery';
import { BOARD_VIEW_TYPE, type BoardDocument, type BoardEditorProvider } from './editor/provider';
import { AtomicFileWriter, vscodeAtomicFs } from './io/AtomicFileWriter';

class HostFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

/** Resolves a tool-supplied path (URI string, absolute or workspace-relative path) to a Uri. */
export function toUri(path: string): vscode.Uri {
  if (SCHEME_RE.test(path)) return vscode.Uri.parse(path);
  if (/^([a-zA-Z]:)?[\\/]/.test(path)) return vscode.Uri.file(path);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  return root ? vscode.Uri.joinPath(root, path) : vscode.Uri.file(path);
}

function displayPath(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

function findDocument(provider: BoardEditorProvider, path: string): BoardDocument | undefined {
  const direct = provider.documents.get(path);
  if (direct) return direct;
  const wanted = normalizeBoardPath(path).toLowerCase();
  let uriKey: string | undefined;
  try {
    uriKey = toUri(path).toString();
  } catch {
    /* not a valid path */
  }
  for (const doc of provider.documents.values()) {
    if (uriKey !== undefined && doc.uri.toString() === uriKey) return doc;
    if (normalizeBoardPath(doc.uri.fsPath).toLowerCase() === wanted) return doc;
  }
  return undefined;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function openTabsFor(uri: vscode.Uri): vscode.Tab[] {
  const tabs: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputCustom && input.viewType === BOARD_VIEW_TYPE && input.uri.toString() === uri.toString()) {
        tabs.push(tab);
      }
    }
  }
  return tabs;
}

/** True when the active editor tab is an OpenBoard board editor (Req 18.2). */
export function hasActiveBoardEditor(): boolean {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom && input.viewType === BOARD_VIEW_TYPE;
}

export function activeBoardEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom && input.viewType === BOARD_VIEW_TYPE ? input.uri : undefined;
}

export function createBoardHost(provider: BoardEditorProvider): BoardHost {
  return {
    isOpen: (path) => findDocument(provider, path)?.state.model,
    exists: async (path) => (await fileExists(toUri(path))) || findDocument(provider, path) !== undefined,
    async openInBackground(path) {
      const doc = findDocument(provider, path) ?? (await provider.openBackground(toUri(path)));
      if (!doc.state.model) throw new HostFailure('invalid_board', `Board is not a valid OpenBoard file: ${path}`);
      return doc.state.model;
    },
    activeBoard: () => provider.activeDocument()?.state.model,
    openBoards: () => [...provider.documents.values()].map((d) => displayPath(d.uri)),
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
  };
}

export function createLifecycleHost(provider: BoardEditorProvider, writer: AtomicFileWriter<vscode.Uri>): BoardLifecycleHost {
  const info = (doc: BoardDocument): BoardInfo => ({ path: displayPath(doc.uri), dirty: doc.dirty });
  const need = (path: string): BoardDocument => {
    const doc = findDocument(provider, path);
    if (!doc) throw new HostFailure('not_found', `Board is not open: ${path}`);
    return doc;
  };
  const token: vscode.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

  async function openDoc(uri: vscode.Uri, background: boolean): Promise<BoardDocument> {
    if (background) return provider.openBackground(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, BOARD_VIEW_TYPE);
    return findDocument(provider, uri.toString()) ?? provider.openBackground(uri);
  }

  return {
    list: () => [...provider.documents.values()].filter((d) => d.state.isValid).map(info),
    active: () => {
      const d = provider.activeDocument();
      return d ? displayPath(d.uri) : undefined;
    },
    async open(path, options) {
      const uri = toUri(path);
      if (!findDocument(provider, path) && !(await fileExists(uri))) {
        throw new HostFailure('not_found', `Board not found: ${path}`);
      }
      return info(await openDoc(uri, options?.background === true));
    },
    async create(path) {
      const uri = toUri(path);
      if ((await fileExists(uri)) || findDocument(provider, path)) {
        throw new HostFailure('already_exists', `Board already exists: ${path}`);
      }
      await writer.write(uri, new TextEncoder().encode(serialize(createEmptyDocument())));
      return info(await openDoc(uri, false));
    },
    async save(path) {
      const doc = need(path);
      if (doc.uri.scheme === 'untitled') {
        throw new HostFailure('save_requires_path', 'An untitled board must be saved from the editor (Save As)');
      }
      if (!doc.dirty) return; // the file already has this content
      // A board shown in an editor tab is saved through the IDE's own save, so the tab's dirty
      // marker clears and the IDE's working copy stays in sync. The command acts on the active
      // editor, so bring this board's tab to the front first.
      if (openTabsFor(doc.uri).length > 0) {
        if (activeBoardEditorUri()?.toString() !== doc.uri.toString()) {
          await vscode.commands.executeCommand('vscode.openWith', doc.uri, BOARD_VIEW_TYPE);
        }
        if (activeBoardEditorUri()?.toString() === doc.uri.toString()) {
          await vscode.commands.executeCommand('workbench.action.files.save');
          if (!doc.dirty) return;
        }
      }
      // Background boards (no tab), or the IDE command did not save: write through the provider
      // (atomic temp-file + rename).
      await provider.saveCustomDocument(doc, token);
    },
    async close(path, options) {
      const doc = need(path);
      if (doc.dirty && !options.discard) {
        throw new HostFailure('unsaved_changes', `Board has unsaved changes: ${path}; save it or close with discard`);
      }
      if (doc.dirty && doc.uri.scheme !== 'untitled') await provider.revertCustomDocument(doc, token);
      const tabs = openTabsFor(doc.uri);
      if (tabs.length > 0) await vscode.window.tabGroups.close(tabs);
      provider.closeBackground(doc);
    },
  };
}

/** Rasterizes through an editor/hidden render panel and writes files atomically. */
export function createExportHost(broker: RenderBroker, writer: AtomicFileWriter<vscode.Uri>): ExportHost {
  return {
    async rasterize(svg: string, options: RasterizeOptions): Promise<Uint8Array> {
      const b64 = await broker.render({ svg, ...options });
      return new Uint8Array(Buffer.from(b64, 'base64'));
    },
    writeFile: (path, bytes) => writer.write(toUri(path), bytes),
  };
}
