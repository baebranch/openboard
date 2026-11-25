/**
 * Extension host entry point. Wires the editor provider, tool registry, agent surface, commands,
 * settings and workspace trust. The only listener is the per-window local MCP channel
 * (src/host/ipc): a named pipe / Unix socket, never a TCP port. Board state lives in this process.
 * The compiled validators are loaded on first use (Req 1.7).
 */
import * as vscode from 'vscode';
import { createEmptyDocument } from '../core/format/parser';
import { toggledGridSettings } from '../core/model/grid';
import { MemorySelectionStore } from '../core/tools/view-tools';
import { createMessageValidation } from '../shared/messages';
import { activateAgentSurface } from './agent/lm-glue';
import type { OpenBoardApi } from './agent/bridge';
import { createRegistry } from './agent/registry-setup';
import { activateMcp } from './ipc/mcp-glue';
import { activeBoardEditorUri, createBoardHost, createExportHost, createLifecycleHost, hasActiveBoardEditor } from './board-host';
import { COMMAND_IDS, exportFormatForPath, planCommand, type CommandKey, type ViewCommand } from './commands';
import { createHiddenRenderPanel } from './editor/renderPanel';
import { BoardEditorProvider, loadExtensionValidators, openNewBoard, type BoardDocument } from './editor/provider';
import type { Session } from './editor/session';
import { RenderBroker } from './editor/recovery';
import type { LoadedValidators } from './editor/validators';
import { AtomicFileWriter, vscodeAtomicFs } from './io/AtomicFileWriter';
import { SettingsBroadcaster, readSettings } from './settings-sync';
import type { SettingKey } from '../core/settings/settings';

interface ActiveState {
  provider: BoardEditorProvider;
  broker: RenderBroker;
  disposables: vscode.Disposable[];
}

let state: ActiveState | undefined;

/** Validators are loaded from dist/validators.js on first access, not at activation. */
function lazyValidators(extensionUri: vscode.Uri): LoadedValidators {
  let loaded: LoadedValidators | undefined;
  const get = (): LoadedValidators => (loaded ??= loadExtensionValidators(extensionUri));
  return {
    get validateBoard() {
      return get().validateBoard;
    },
    get validateWebviewToHost() {
      return get().validateWebviewToHost;
    },
    get validateHostToWebview() {
      return get().validateHostToWebview;
    },
  };
}

/** Save dialog for a webview-started export, defaulting to "<board name>.<ext>" next to the board. */
async function promptExportDestination(board: vscode.Uri, format: string): Promise<vscode.Uri | undefined> {
  const ext = format === 'jpeg' ? 'jpg' : format;
  return vscode.window.showSaveDialog({
    filters: { [format.toUpperCase()]: [ext] },
    defaultUri: board.with({ path: board.path.replace(/\.openboard$/, '') + `.${ext}` }),
  });
}

export function activate(context: vscode.ExtensionContext): OpenBoardApi {
  const output = vscode.window.createOutputChannel('OpenBoard');
  const logger = {
    info: (m: string) => output.appendLine(m),
    warn: (m: string) => output.appendLine(`warn: ${m}`),
  };
  const disposables: vscode.Disposable[] = [output];

  // --- settings (Req 18.2-18.5): read-only; invalid values fall back to defaults, never written back.
  const readCurrent = () =>
    readSettings(
      (key: SettingKey) => vscode.workspace.getConfiguration('openboard').get(key),
      vscode.workspace.getConfiguration('editor').get<string>('fontFamily') ?? '',
    );
  let providerRef: BoardEditorProvider | undefined;
  const broadcaster = new SettingsBroadcaster(readCurrent, (s) => providerRef?.broadcastSettings(s));

  // --- provider, render broker
  const validators = lazyValidators(context.extensionUri);
  const validation = createMessageValidation(validators, logger);
  const selection = new MemorySelectionStore();
  const writer = new AtomicFileWriter<vscode.Uri>(vscodeAtomicFs(vscode.workspace.fs));

  const broker: RenderBroker = new RenderBroker({
    getEditorSession: () => providerRef?.visibleEditorSession(),
    createHiddenPanel: () =>
      createHiddenRenderPanel({
        extensionUri: context.extensionUri,
        onMessage(session: Session, raw: unknown) {
          const msg = validation.accept('webview-to-host', raw);
          if (!msg) return;
          if (msg.type === 'ready') {
            session.post({ type: 'init', doc: createEmptyDocument(), settings: broadcaster.current(), readOnly: true });
          } else if (msg.type === 'render:result') broker.handleResult(msg.requestId, msg.png);
        },
      }),
  });

  // The registry is created below; the op handler needs it lazily.
  let registry!: ReturnType<typeof createRegistry>;

  const provider = new BoardEditorProvider({
    extensionUri: context.extensionUri,
    validators,
    getSettings: () => broadcaster.current(),
    logger,
    handlers: {
      renderResult: (_s, m) => void broker.handleResult(m.requestId, m.png),
    },
    documentHandlers: (doc: BoardDocument) => ({
      selection(_session, ids) {
        if (doc.state.model) selection.set(doc.state.model.path, ids);
      },
      op(session, msg) {
        const model = doc.state.model;
        if (!model) return;
        const extra = typeof msg.input === 'object' && msg.input !== null ? (msg.input as Record<string, unknown>) : {};
        void doc.hub
          .runGestureAsync(session, msg.gestureId, async () => {
            // An export started in the webview (Export dialog, slides Export PDF) has no destination
            // yet: ask for one here. Cancelling the dialog exports nothing.
            if (msg.tool === 'openboard.export' && extra['path'] === undefined) {
              const dest = await promptExportDestination(doc.uri, typeof extra['format'] === 'string' ? extra['format'] : 'png');
              if (!dest) return { results: [] };
              return registry.invoke(msg.tool, { ...extra, board: model.path, path: dest.toString() });
            }
            return registry.invoke(msg.tool, { ...extra, board: model.path });
          })
          .then((result) => {
            const err = (result as { error?: { code?: string; message?: string } } | null)?.error;
            if (err) session.post({ type: 'notice', level: 'warn', message: err.message ?? err.code ?? 'Operation failed' });
          })
          .catch((e: unknown) => logger.warn(`op ${msg.tool} failed: ${String(e)}`));
      },
    }),
  });
  providerRef = provider;

  registry = createRegistry({
    boardHost: createBoardHost(provider),
    exportHost: createExportHost(broker, writer),
    lifecycleHost: createLifecycleHost(provider, writer),
    selection,
  });

  disposables.push(BoardEditorProvider.register(provider));
  const api = activateAgentSurface(context, registry, logger.info);
  const mcp = activateMcp(context, registry, logger.info);
  disposables.push({ dispose: () => mcp.dispose() });

  // --- commands: seven palette commands.
  const notifyNoBoard = (message: string) => void vscode.window.showInformationMessage(vscode.l10n.t(message));
  const register = (key: CommandKey, run: (...args: unknown[]) => Promise<void> | void, allowWithArg = false) =>
    vscode.commands.registerCommand(COMMAND_IDS[key], async (...args: unknown[]) => {
      const plan = planCommand(key, hasActiveBoardEditor() || (allowWithArg && args[0] instanceof vscode.Uri));
      if (plan.action === 'notify') return notifyNoBoard(plan.message);
      await run(...args);
    });
  const activeDoc = (): BoardDocument | undefined => {
    const uri = activeBoardEditorUri();
    return uri ? provider.documents.get(uri.toString()) : undefined;
  };
  const viewCommand = (command: ViewCommand) => () => {
    const doc = activeDoc();
    if (!doc) return;
    if (command === 'toggleGrid') {
      // The grid state is stored in the board file: toggle it as one undoable edit, which marks the
      // document dirty and reaches every tab through the normal patch broadcast.
      const model = doc.state.model;
      if (!model || !doc.state.canEdit) {
        void vscode.window.showInformationMessage(vscode.l10n.t('OpenBoard: this board is read-only.'));
        return;
      }
      model.transact('Toggle grid', (tx) => tx.setSettings(toggledGridSettings(tx.doc.settings, readCurrent().gridSpacing)));
      return;
    }
    // Zoom to fit / toggle minimap are view state only: forwarded to every tab of the active board.
    doc.hub.broadcast({ type: 'view:command', command });
  };

  disposables.push(
    register('newBoard', async (target) => {
      if (!(target instanceof vscode.Uri)) return openNewBoard();
      const name = await vscode.window.showInputBox({ prompt: vscode.l10n.t('File name'), value: 'Untitled.openboard' });
      if (!name) return;
      const file = name.endsWith('.openboard') ? name : `${name}.openboard`;
      try {
        await registry.invoke('openboard.board.create', { path: vscode.Uri.joinPath(target, file).toString() });
      } catch (e) {
        void vscode.window.showErrorMessage(String(e));
      }
    }),
    register(
      'export',
      async (target) => {
        const uri = target instanceof vscode.Uri ? target : activeBoardEditorUri();
        if (!uri) return;
        const dest = await vscode.window.showSaveDialog({
          filters: { Image: ['png', 'svg', 'jpg', 'webp', 'pdf'] },
          defaultUri: uri.with({ path: uri.path.replace(/\.openboard$/, '') + '.png' }),
        });
        if (!dest) return;
        const result = (await registry.invoke('openboard.export', {
          board: uri.toString(),
          format: exportFormatForPath(dest.path),
          path: dest.toString(),
          scale: broadcaster.current().defaultExportScale,
          background: broadcaster.current().defaultExportBackground,
        })) as { error?: { message?: string; code?: string } };
        if (result?.error) void vscode.window.showErrorMessage(result.error.message ?? result.error.code ?? vscode.l10n.t('Export failed'));
      },
      true,
    ),
    register('copyMcpConfig', () => mcp.copyConfig()),
    register('zoomToFit', viewCommand('zoomToFit')),
    register('toggleGrid', viewCommand('toggleGrid')),
    register('toggleMinimap', viewCommand('toggleMinimap')),
    register('openAsText', async () => {
      const uri = activeBoardEditorUri();
      if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }),
  );

  // --- settings push (Req 18.4): synchronous on change, well within 500 ms.
  disposables.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('openboard') || e.affectsConfiguration('editor.fontFamily')) broadcaster.refresh();
    }),
    // --- trust: the tool trust gate reads `workspace.isTrusted` per call, so granting trust takes
    // effect immediately; untrusted workspaces run in limited mode (writes elsewhere are refused).
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      logger.info('Workspace trust granted; full tool access enabled');
      broadcaster.refresh();
    }),
    provider,
    { dispose: () => broker.dispose() },
  );
  if (!vscode.workspace.isTrusted) logger.info('Untrusted workspace: running in limited mode');

  state = { provider, broker, disposables };
  context.subscriptions.push(...disposables);
  return api;
}

/** Disposes watchers, background documents and pending render requests/timers. Idempotent. */
export function deactivate(): void {
  const s = state;
  state = undefined;
  if (!s) return;
  for (const d of s.disposables.splice(0)) {
    try {
      d.dispose();
    } catch {
      /* best effort */
    }
  }
}
