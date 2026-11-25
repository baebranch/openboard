/**
 * vscode glue for the board custom editor. All decisions live in the pure modules next to this
 * file (loader, state, session, html, validators); this file only adapts them to the vscode API.
 */
import * as vscode from 'vscode';
import { createEmptyDocument, parse } from '../../core/format/parser';
import type { Settings } from '../../core/settings/settings';
import { createMessageValidation } from '../../shared/messages';
import { listInstalledFonts } from '../fonts';
import { AtomicFileWriter, vscodeAtomicFs } from '../io/AtomicFileWriter';
import { OwnWriteRegistry } from '../io/external-change';
import { attachExternalChangeHandler, registerLocalContentProvider } from '../io/external-change-vscode';
import { buildEditorHtml, buildInvalidHtml, isOpenAsTextMessage, makeNonce } from './html';
import { describeInvalid, loadBoard, loadFromBytes, type LoaderFs, type LoadOutcome } from './loader';
import { SessionHub, routeMessage, type RouterHandlers, type Session } from './session';
import { BoardDocumentState } from './state';
import { loadValidators, type LoadedValidators } from './validators';

export const BOARD_VIEW_TYPE = 'openboard.board';

export interface ProviderLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface ProviderOptions {
  extensionUri: vscode.Uri;
  validators: LoadedValidators;
  getSettings: () => Settings;
  logger: ProviderLogger;
  handlers?: RouterHandlers;
  /** Per-document handlers (op, selection), merged over `handlers`. */
  documentHandlers?: (document: BoardDocument) => RouterHandlers;
}

/** `vscode.CustomDocument` for one board file; shared by every editor tab showing it. */
export class BoardDocument implements vscode.CustomDocument {
  readonly hub: SessionHub;
  /** True while there are unsaved edits (cleared on save/revert/reload from disk). */
  dirty = false;
  /** True while the document was opened without an editor tab (agent tools). */
  background = false;

  constructor(
    readonly uri: vscode.Uri,
    readonly state: BoardDocumentState,
  ) {
    this.hub = new SessionHub(state);
  }

  dispose(): void {
    this.hub.dispose();
    this.state.dispose();
  }
}

const workspaceLoaderFs: LoaderFs<vscode.Uri> = {
  async stat(uri) {
    const s = await vscode.workspace.fs.stat(uri);
    return { size: s.size };
  },
  readFile: async (uri) => vscode.workspace.fs.readFile(uri),
};

let untitledCounter = 0;

/** URI for the next "new untitled board" (Req 2.2). */
export function nextUntitledBoardUri(): vscode.Uri {
  untitledCounter++;
  return vscode.Uri.parse(`untitled:Untitled-${untitledCounter}.openboard`);
}

/** Opens a new empty, unsaved board in the Board_Editor (Req 2.2). */
export async function openNewBoard(): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', nextUntitledBoardUri(), BOARD_VIEW_TYPE);
}

/** Loads `dist/validators.js` from the extension directory. */
export function loadExtensionValidators(extensionUri: vscode.Uri): LoadedValidators {
  const file = vscode.Uri.joinPath(extensionUri, 'dist', 'validators.js').fsPath;
  return loadValidators(file, (id) => require(id));
}

const noCancel: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};

export class BoardEditorProvider implements vscode.CustomEditorProvider<BoardDocument> {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BoardDocument>>();
  readonly onDidChangeCustomDocument = this.changeEmitter.event;

  private readonly writer = new AtomicFileWriter<vscode.Uri>(vscodeAtomicFs(vscode.workspace.fs));
  private readonly ownWrites = new OwnWriteRegistry();
  private readonly validation;
  private readonly docs = new Map<string, BoardDocument>();
  private readonly editorPanels = new Map<Session, { document: BoardDocument; panel: vscode.WebviewPanel }>();
  private lastActive: BoardDocument | undefined;

  /** Every open document (editor-backed or background), keyed by `uri.toString()`. */
  get documents(): ReadonlyMap<string, BoardDocument> {
    return this.docs;
  }

  /** The document of the most recently active board editor. */
  activeDocument(): BoardDocument | undefined {
    return this.lastActive && this.docs.get(this.lastActive.uri.toString()) === this.lastActive ? this.lastActive : undefined;
  }

  /** A session of a visible board editor, used for rendering (Req 14.14). */
  visibleEditorSession(): Session | undefined {
    for (const [session, { panel }] of this.editorPanels) if (panel.visible) return session;
    return undefined;
  }

  /** Pushes new settings to every open editor (Req 18.4). */
  broadcastSettings(settings: Settings): void {
    for (const doc of this.docs.values()) doc.hub.broadcast({ type: 'settings', settings });
  }

  /** Opens a document without an editor tab, or returns the already open one. */
  async openBackground(uri: vscode.Uri): Promise<BoardDocument> {
    const existing = this.docs.get(uri.toString());
    if (existing) return existing;
    const doc = await this.openCustomDocument(uri, { backupId: undefined, untitledDocumentData: undefined }, noCancel);
    doc.background = true;
    return doc;
  }

  /** Disposes a background-only document (no-op for editor-backed ones). */
  closeBackground(doc: BoardDocument): void {
    if (doc.background) doc.dispose();
  }

  dispose(): void {
    for (const doc of [...this.docs.values()]) doc.dispose();
    this.docs.clear();
    this.editorPanels.clear();
    this.changeEmitter.dispose();
  }

  constructor(private readonly opts: ProviderOptions) {
    this.validation = createMessageValidation(opts.validators, opts.logger);
  }

  static register(provider: BoardEditorProvider): vscode.Disposable {
    return vscode.Disposable.from(
      registerLocalContentProvider(),
      vscode.window.registerCustomEditorProvider(BOARD_VIEW_TYPE, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true }, // keeps viewport while hidden (Req 2.10)
      }),
    );
  }

  private parseText = (text: string) => parse(text, { validator: this.opts.validators.validateBoard });

  private async load(uri: vscode.Uri): Promise<LoadOutcome> {
    return loadBoard(workspaceLoaderFs, uri, this.parseText);
  }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<BoardDocument> {
    const existing = this.docs.get(uri.toString());
    if (existing?.background && !openContext.backupId) {
      existing.background = false; // an editor now owns it; the IDE disposes it on close
      return existing;
    }
    let state: BoardDocumentState;
    if (uri.scheme === 'untitled' && !openContext.backupId) {
      state = BoardDocumentState.untitled(uri.toString());
    } else {
      const source = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri;
      const outcome = await this.load(source);
      if (!outcome.ok) {
        this.opts.logger.warn(`${uri.toString()}: ${describeInvalid(outcome.reason)}`);
        if (outcome.reason.kind === 'tooLarge') void vscode.window.showErrorMessage(describeInvalid(outcome.reason));
      }
      state = new BoardDocumentState(uri.toString(), outcome);
    }
    const doc = new BoardDocument(uri, state);
    state.onDidEdit((e) => {
      doc.dirty = true;
      this.changeEmitter.fire({ document: doc, label: e.label, undo: e.undo, redo: e.redo });
    });
    if (state.loadSyncError) {
      this.opts.logger.warn(`${uri.toString()}: ${state.loadSyncError.message}`);
      void vscode.window.showErrorMessage(state.loadSyncError.message);
    }
    if (state.syncedOnLoad) {
      // Req 15.10: the load-time Sync_Pass changed the board, so it opens modified.
      doc.dirty = true;
      this.changeEmitter.fire({ document: doc, label: 'Sync component instances', undo: () => undefined, redo: () => undefined });
    }
    if (uri.scheme === 'file' && state.isValid) {
      const watcher = attachExternalChangeHandler({
        uri,
        state,
        ownWrites: this.ownWrites,
        isDirty: () => doc.dirty,
        parse: (bytes) => loadFromBytes(bytes, this.parseText),
        warn: (m) => this.opts.logger.warn(`${uri.toString()}: ${m}`),
        onReloaded: () => {
          doc.dirty = false;
        },
      });
      const prev = doc.dispose.bind(doc);
      doc.dispose = () => {
        watcher.dispose();
        prev();
      };
    }
    const key = uri.toString();
    this.docs.set(key, doc);
    const disposeDoc = doc.dispose.bind(doc);
    doc.dispose = () => {
      if (this.docs.get(key) === doc) this.docs.delete(key);
      if (this.lastActive === doc) this.lastActive = undefined;
      disposeDoc();
    };
    return doc;
  }

  async resolveCustomEditor(
    document: BoardDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = panel.webview;
    const dist = vscode.Uri.joinPath(this.opts.extensionUri, 'dist');
    webview.options = { enableScripts: true, localResourceRoots: [dist] };
    const nonce = makeNonce();
    const { state } = document;

    if (state.invalid) {
      webview.html = buildInvalidHtml({
        cspSource: webview.cspSource,
        nonce,
        message: describeInvalid(state.invalid),
        offerOpenAsText: state.invalid.kind !== 'tooLarge',
      });
      const sub = webview.onDidReceiveMessage((raw: unknown) => {
        if (isOpenAsTextMessage(raw)) void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
      });
      panel.onDidDispose(() => sub.dispose());
      return;
    }

    const session: Session = {
      id: makeNonce(),
      post: (m) => void webview.postMessage(m),
    };
    const loadHtml = (): void => {
      webview.html = buildEditorHtml({
        cspSource: webview.cspSource,
        nonce: makeNonce(),
        scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString(),
        styleUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css')).toString(),
        title: 'OpenBoard',
      });
    };
    // Unresponsive webview: reload it from the host-held document; `ready` then re-sends init
    // and a notice for any unacknowledged gestures (Req 16.6, 16.10).
    const detach = document.hub.attach(session, {
      onUnresponsive: () => {
        this.opts.logger.warn('Webview unresponsive; restarting');
        webview.html = '';
        loadHtml();
        document.hub.rearm(session);
      },
    });
    this.editorPanels.set(session, { document, panel });
    if (panel.active) this.lastActive = document;
    const viewSub = panel.onDidChangeViewState((e) => {
      document.hub.setVisible(session, e.webviewPanel.visible);
      if (e.webviewPanel.active) this.lastActive = document;
    });
    const handlers: RouterHandlers = { ...this.opts.handlers, ...this.opts.documentHandlers?.(document) };
    const sub = webview.onDidReceiveMessage((raw: unknown) =>
      routeMessage(
        {
          state,
          accept: this.validation.accept,
          getSettings: this.opts.getSettings,
          logger: this.opts.logger,
          hub: document.hub,
          handlers,
          listFonts: listInstalledFonts,
        },
        session,
        raw,
      ),
    );
    panel.onDidDispose(() => {
      sub.dispose();
      viewSub.dispose();
      this.editorPanels.delete(session);
      detach();
    });
    loadHtml();
  }

  async saveCustomDocument(document: BoardDocument, _token: vscode.CancellationToken): Promise<void> {
    if (!document.state.model || document.state.readOnly) return; // nothing to write; file stays untouched
    const bytes = document.state.toBytes();
    this.ownWrites.recordOwnWrite(document.uri.toString(), bytes);
    await this.writer.write(document.uri, bytes);
    document.dirty = false;
  }

  async saveCustomDocumentAs(
    document: BoardDocument,
    destination: vscode.Uri,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    if (!document.state.model) throw new Error('An invalid board cannot be saved');
    const bytes = document.state.toBytes();
    this.ownWrites.recordOwnWrite(destination.toString(), bytes);
    await this.writer.write(destination, bytes);
  }

  async revertCustomDocument(document: BoardDocument, _token: vscode.CancellationToken): Promise<void> {
    const { state } = document;
    if (!state.model) return;
    const outcome: LoadOutcome =
      document.uri.scheme === 'untitled'
        ? { ok: true, doc: createEmptyDocument(), readOnly: false }
        : await this.load(document.uri);
    if (!outcome.ok) throw new Error(describeInvalid(outcome.reason));
    state.replaceContent(outcome);
    document.dirty = false;
  }

  async backupCustomDocument(
    document: BoardDocument,
    context: vscode.CustomDocumentBackupContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    const dest = context.destination;
    if (document.state.model) await vscode.workspace.fs.writeFile(dest, document.state.toBytes());
    return {
      id: dest.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(dest);
        } catch {
          /* already gone */
        }
      },
    };
  }
}
