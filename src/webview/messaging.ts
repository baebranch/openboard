/** Webview side of the host protocol (Req 16.1, 16.2). Messages are validated by build-time validators. */
import type { Viewport } from '../core/model/types';
import type { HostToWebview, MessageValidators, RenderSpec, ViewCommandName, WebviewToHost } from '../shared/messages';
import { createMessageValidation } from '../shared/messages';
import type { WebviewStore } from './store';

export interface VsCodeApi {
  postMessage(message: unknown): void;
}

export interface MessagingHandlers {
  onViewport?(viewport: Viewport): void;
  onRenderRequest?(requestId: string, spec: RenderSpec): void;
  onPatchFailure?(): void;
  onViewCommand?(command: ViewCommandName): void;
}

export interface Messaging {
  /** Handle a raw `message` event payload from the host. */
  receive(data: unknown): void;
  send(message: WebviewToHost): void;
  /** Announce readiness to the host (sent once the listener is attached). */
  ready(): void;
}

export function createMessaging(
  api: VsCodeApi,
  validators: Pick<MessageValidators, 'validateHostToWebview'> & Partial<MessageValidators>,
  store: WebviewStore,
  handlers: MessagingHandlers = {},
  warn: (message: string) => void = () => undefined,
): Messaging {
  const validation = createMessageValidation(
    { validateWebviewToHost: () => true, ...validators } as MessageValidators,
    { warn },
  );

  function send(message: WebviewToHost): void {
    api.postMessage(message);
  }

  function applyRevision(patches: Parameters<WebviewStore['applyPatches']>[0], revision: number): void {
    if (revision <= store.getState().revision) return; // stale or duplicate
    if (!store.applyPatches(patches, revision)) {
      warn('Failed to apply patches to the local replica; requesting a fresh document.');
      handlers.onPatchFailure?.();
      send({ type: 'ready' });
    }
  }

  function receive(data: unknown): void {
    const msg: HostToWebview | undefined = validation.accept('host-to-webview', data);
    if (!msg) return;
    switch (msg.type) {
      case 'init':
        store.init(msg.doc, msg.settings, msg.readOnly);
        break;
      case 'reset':
        store.reset(msg.doc);
        break;
      case 'ack':
      case 'patch':
        applyRevision(msg.patches, msg.revision);
        break;
      case 'settings':
        store.setSettings(msg.settings);
        break;
      case 'viewport':
        handlers.onViewport?.(msg.viewport);
        break;
      case 'notice':
        store.addNotice(msg.level, msg.message);
        break;
      case 'render:request':
        handlers.onRenderRequest?.(msg.requestId, msg.spec);
        break;
      case 'view:command':
        handlers.onViewCommand?.(msg.command);
        break;
    }
  }

  return { receive, send, ready: () => send({ type: 'ready' }) };
}
