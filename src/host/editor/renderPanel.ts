/**
 * vscode glue: a hidden webview panel used to render previews/exports for boards that have no
 * open editor tab (Req 14.14, 14.15). Logic lives in recovery.ts (RenderBroker).
 */
import * as vscode from 'vscode';
import type { HiddenRenderPanel } from './recovery';
import { buildEditorHtml, makeNonce } from './html';
import type { Session } from './session';

export interface HiddenPanelOptions {
  extensionUri: vscode.Uri;
  /** Routes raw webview messages (ready/render:result) exactly like an editor session. */
  onMessage(session: Session, raw: unknown): void;
  /** Called once with the session so the caller can attach it to a SessionHub. */
  onCreate?(session: Session): () => void;
}

export function createHiddenRenderPanel(opts: HiddenPanelOptions): HiddenRenderPanel {
  const dist = vscode.Uri.joinPath(opts.extensionUri, 'dist');
  const panel = vscode.window.createWebviewPanel(
    'openboard.renderPanel',
    'OpenBoard Render',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    { enableScripts: true, localResourceRoots: [dist], retainContextWhenHidden: true },
  );
  panel.reveal(undefined, true);
  const session: Session = { id: makeNonce(), post: (m) => void panel.webview.postMessage(m) };
  const detach = opts.onCreate?.(session);
  let ready!: () => void;
  const readyPromise = new Promise<void>((r) => (ready = r));
  panel.webview.onDidReceiveMessage((raw: unknown) => {
    if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'ready') ready();
    opts.onMessage(session, raw);
  });
  panel.webview.html = buildEditorHtml({
    cspSource: panel.webview.cspSource,
    nonce: makeNonce(),
    scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString(),
    styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css')).toString(),
    title: 'OpenBoard Render',
  });
  return {
    session,
    whenReady: () => readyPromise,
    dispose: () => {
      detach?.();
      panel.dispose();
    },
  };
}
