/** Thin vscode glue for ExternalChangeHandler (all decisions live in external-change.ts). */
import * as vscode from 'vscode';
import { sha256Hex } from '../../core/format/sha256';
import type { LoadOutcome } from '../editor/loader';
import type { BoardDocumentState } from '../editor/state';
import {
  ExternalChangeHandler,
  type ConflictChoice,
  type OwnWriteRegistry,
} from './external-change';

export const LOCAL_SCHEME = 'openboard-local';

const localContents = new Map<string, string>();
let registered: vscode.Disposable | undefined;

/** Registers the virtual-document provider that serves the local serialization for diffs. */
export function registerLocalContentProvider(): vscode.Disposable {
  if (!registered) {
    const emitter = new vscode.EventEmitter<vscode.Uri>();
    const reg = vscode.workspace.registerTextDocumentContentProvider(LOCAL_SCHEME, {
      onDidChange: emitter.event,
      provideTextDocumentContent: (uri) => localContents.get(uri.toString()) ?? '',
    });
    registered = new vscode.Disposable(() => {
      reg.dispose();
      emitter.dispose();
      registered = undefined;
    });
  }
  return registered;
}

export interface AttachOptions {
  uri: vscode.Uri;
  state: BoardDocumentState;
  ownWrites: OwnWriteRegistry;
  isDirty: () => boolean;
  parse: (bytes: Uint8Array) => LoadOutcome;
  warn: (message: string) => void;
  /** Called after the disk version replaced the model content. */
  onReloaded?: () => void;
}

/** Watches the board file and wires change events to an ExternalChangeHandler. */
export function attachExternalChangeHandler(o: AttachOptions): vscode.Disposable {
  const { uri, state } = o;
  const key = uri.toString();
  const handler = new ExternalChangeHandler({
    readFile: async () => vscode.workspace.fs.readFile(uri),
    hash: sha256Hex,
    parse: o.parse,
    isDirty: o.isDirty,
    isOwnWrite: (b) => o.ownWrites.isOwnWrite(key, b),
    forgetOwnWrite: () => o.ownWrites.forget(key),
    getViewport: () => state.viewport,
    applyDisk: (outcome) => {
      const ok = state.replaceContent(outcome);
      if (ok) o.onReloaded?.();
      return ok;
    },
    showPrompt: async (message, choices) => {
      // Display localized labels; map the picked label back to the canonical choice.
      const labels = choices.map((c) => vscode.l10n.t(c));
      const picked = await vscode.window.showWarningMessage(vscode.l10n.t(message), { modal: false }, ...labels);
      const index = picked === undefined ? -1 : labels.indexOf(picked);
      return index >= 0 ? choices[index] : undefined;
    },
    openDiff: async () => {
      const localUri = vscode.Uri.parse(`${LOCAL_SCHEME}:${encodeURIComponent(uri.path)}.json`).with({
        query: String(Date.now()),
      });
      const text = state.model ? new TextDecoder().decode(state.toBytes()) : '';
      localContents.set(localUri.toString(), text);
      const name = uri.path.slice(uri.path.lastIndexOf('/') + 1);
      await vscode.commands.executeCommand(
        'vscode.diff',
        localUri,
        uri.with({ path: `${uri.path}` }),
        `${name}: local ↔ disk`,
      );
    },
    now: () => Date.now(),
    warn: o.warn,
  });

  const slash = uri.path.lastIndexOf('/');
  const dir = uri.with({ path: uri.path.slice(0, slash) || '/' });
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(dir, uri.path.slice(slash + 1)),
  );
  const run = () => void handler.handleChange().catch((e) => o.warn(String(e)));
  return vscode.Disposable.from(watcher, watcher.onDidChange(run), watcher.onDidCreate(run));
}
