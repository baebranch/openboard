import type { BoardDocument, ElementId, Viewport } from '../core/model/types';
import type { Patch } from '../core/ops/patches';
import type { Settings } from '../core/settings/settings';

/** Webview/host message protocol (design.md, Req 16.5). */
export type RenderSpec = Record<string, unknown>;

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'op'; gestureId: string; tool: string; input?: unknown }
  | { type: 'viewport'; viewport: Viewport }
  | { type: 'selection'; ids: ElementId[] }
  | { type: 'export:result'; requestId: string; bytes: string; mime: string }
  | { type: 'render:result'; requestId: string; png: string }
  /** The webview could not produce the requested output; the host removes partial output (Req 12.10). */
  | { type: 'export:cancel'; requestId: string; reason?: string }
  | { type: 'log'; level: 'info' | 'warn'; message: string };

export type HostToWebview =
  | { type: 'init'; doc: BoardDocument; settings: Settings; readOnly: boolean }
  | { type: 'ack'; gestureId: string; revision: number; patches: Patch[] }
  | { type: 'patch'; revision: number; patches: Patch[] }
  | { type: 'reset'; doc: BoardDocument }
  | { type: 'settings'; settings: Settings }
  | { type: 'viewport'; viewport: Viewport }
  | { type: 'render:request'; requestId: string; spec: RenderSpec }
  | { type: 'notice'; level: string; message: string }
  /** Palette commands that change only the view (not the document): forwarded to every open tab. */
  | { type: 'view:command'; command: ViewCommandName };

export type ViewCommandName = 'zoomToFit' | 'toggleGrid' | 'toggleMinimap';

/** A compiled (standalone Ajv) validator as emitted into dist/validators.js. */
export interface CompiledValidator {
  (data: unknown): boolean;
  errors?: { instancePath: string; message?: string; keyword?: string }[] | null;
}

export interface MessageValidators {
  validateWebviewToHost: CompiledValidator;
  validateHostToWebview: CompiledValidator;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface MessageLogger {
  warn(message: string): void;
}

export type MessageDirection = 'webview-to-host' | 'host-to-webview';

function describe(v: CompiledValidator): string {
  const e = v.errors?.[0];
  if (!e) return 'invalid message';
  return `${e.instancePath || '/'} ${e.message ?? e.keyword ?? 'is invalid'}`;
}

/** Create validate/accept helpers around the compiled validators (injected; no runtime schema compilation). */
export function createMessageValidation(validators: MessageValidators, logger: MessageLogger) {
  function validate(direction: 'webview-to-host', data: unknown): ValidationResult<WebviewToHost>;
  function validate(direction: 'host-to-webview', data: unknown): ValidationResult<HostToWebview>;
  function validate(direction: MessageDirection, data: unknown): ValidationResult<WebviewToHost | HostToWebview>;
  function validate(direction: MessageDirection, data: unknown): ValidationResult<WebviewToHost | HostToWebview> {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { ok: false, error: 'message must be an object' };
    }
    const v = direction === 'webview-to-host' ? validators.validateWebviewToHost : validators.validateHostToWebview;
    if (v(data)) return { ok: true, value: data as WebviewToHost | HostToWebview };
    return { ok: false, error: describe(v) };
  }

  /** Returns the message when valid; otherwise logs and drops it (returns undefined). */
  function accept(direction: 'webview-to-host', data: unknown): WebviewToHost | undefined;
  function accept(direction: 'host-to-webview', data: unknown): HostToWebview | undefined;
  function accept(direction: MessageDirection, data: unknown): WebviewToHost | HostToWebview | undefined {
    const r = validate(direction, data);
    if (r.ok) return r.value;
    logger.warn(`Dropped invalid ${direction} message: ${r.error}`);
    return undefined;
  }

  return { validate, accept };
}
