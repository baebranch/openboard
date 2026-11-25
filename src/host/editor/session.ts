/**
 * Pure webview session management and message routing. Every editor tab of a document is a
 * session; all sessions share one BoardDocumentState (Req 2.5, 2.6). No vscode imports.
 */
import type { HostToWebview, MessageLogger, WebviewToHost } from '../../shared/messages';
import type { Settings } from '../../core/settings/settings';
import type { Patch } from '../../core/ops/patches';
import {
  GestureTracker,
  NOTICE_UNACKED_EDITS,
  Watchdog,
  realScheduler,
  restoreViewport,
  type Scheduler,
} from './recovery';
import type { BoardDocumentState, ContentEvent, Disposer } from './state';

export interface Session {
  readonly id: string;
  post(message: HostToWebview): void;
}

export interface AttachOptions {
  /** Called when the webview did not report in time; the glue restarts it from host state. */
  onUnresponsive?: () => void;
  scheduler?: Scheduler;
  timeoutMs?: number;
}

export const NOTICE_LARGE_BOARD =
  'This board has more than 5,000 elements. Rendering and editing may be slower than usual.';
export const NOTICE_READ_ONLY_NEWER =
  'This board was saved by a newer version of OpenBoard. It is opened read-only and will not be modified.';

/** Fans document content changes out to attached sessions. */
export class SessionHub {
  private readonly sessions = new Set<Session>();
  private readonly meta = new Map<Session, { tracker: GestureTracker; watchdog: Watchdog | undefined }>();
  private origin: Session | undefined;
  private off: Disposer;

  constructor(private readonly state: BoardDocumentState) {
    this.off = state.onDidChangeContent((e) => this.broadcastContent(e));
  }

  get size(): number {
    return this.sessions.size;
  }

  attach(s: Session, opts?: AttachOptions): Disposer {
    this.sessions.add(s);
    const tracker = new GestureTracker();
    const watchdog = opts?.onUnresponsive
      ? new Watchdog(opts.scheduler ?? realScheduler, () => opts.onUnresponsive?.(), opts.timeoutMs)
      : undefined;
    this.meta.set(s, { tracker, watchdog });
    watchdog?.arm(); // the freshly created webview must report `ready` in time (Req 16.6)
    return () => {
      watchdog?.disarm();
      this.meta.delete(s);
      this.sessions.delete(s);
    };
  }

  /** Any message from the webview proves it is alive. */
  noteActivity(s: Session): void {
    this.meta.get(s)?.watchdog?.touch();
  }

  /** Re-arms the watchdog after the host reloads the webview content (restart). */
  rearm(s: Session): void {
    this.meta.get(s)?.watchdog?.arm();
  }

  /** Records a received gesture as pending until its ack is posted (handlers may be async). */
  beginGesture(s: Session, gestureId: string): void {
    this.meta.get(s)?.tracker.begin(gestureId);
  }

  /** Gestures received from `s` whose ack was never delivered (Req 16.10). */
  pendingGestures(s: Session): string[] {
    return this.meta.get(s)?.tracker.list() ?? [];
  }

  /**
   * Called after `init` was sent to a (re)started session: warns about gestures that were not
   * acknowledged before the webview went away, then forgets them (Req 16.10).
   */
  reportUnacked(s: Session): number {
    const tracker = this.meta.get(s)?.tracker;
    const n = tracker?.list().length ?? 0;
    if (n > 0) {
      tracker?.clear();
      s.post({ type: 'notice', level: 'warn', message: NOTICE_UNACKED_EDITS });
    }
    return n;
  }

  /** Re-sends the host-held viewport when a tab becomes visible again (Req 2.10). */
  setVisible(s: Session, visible: boolean): void {
    if (visible && this.sessions.has(s)) restoreViewport(s, this.state.viewport);
  }

  /**
   * Applies a gesture (`fn` mutates the model) on behalf of `origin`: the origin is skipped by the
   * patch broadcast and instead receives `ack {gestureId, revision, patches}`. Other sessions get
   * the same patches with the same revision numbers (Req 2.5).
   */
  runGesture<T>(origin: Session, gestureId: string, fn: () => T): T {
    const tracker = this.meta.get(origin)?.tracker;
    tracker?.begin(gestureId);
    const collected: Patch[] = [];
    const off = this.state.onDidChangeContent((e) => {
      if (e.kind === 'patch') collected.push(...e.patches);
    });
    let result: T;
    try {
      result = this.runAs(origin, fn);
    } catch (err) {
      tracker?.ack(gestureId);
      throw err;
    } finally {
      off();
    }
    // Only ack if the session is still attached; otherwise the gesture stays unacknowledged.
    if (this.sessions.has(origin)) {
      origin.post({ type: 'ack', gestureId, revision: this.state.revision, patches: collected });
      tracker?.ack(gestureId);
    }
    return result;
  }

  /** Async variant of `runGesture` for handlers that go through the (async) tool registry. */
  async runGestureAsync<T>(origin: Session, gestureId: string, fn: () => Promise<T>): Promise<T> {
    const tracker = this.meta.get(origin)?.tracker;
    tracker?.begin(gestureId);
    const collected: Patch[] = [];
    const off = this.state.onDidChangeContent((e) => {
      if (e.kind === 'patch') collected.push(...e.patches);
    });
    const prev = this.origin;
    this.origin = origin;
    let result: T;
    try {
      result = await fn();
    } catch (err) {
      tracker?.ack(gestureId);
      throw err;
    } finally {
      this.origin = prev;
      off();
    }
    if (this.sessions.has(origin)) {
      origin.post({ type: 'ack', gestureId, revision: this.state.revision, patches: collected });
      tracker?.ack(gestureId);
    }
    return result;
  }

  /** Runs `fn` (a model mutation) so the originating session is skipped by the patch broadcast. */
  runAs<T>(origin: Session, fn: () => T): T {
    const prev = this.origin;
    this.origin = origin;
    try {
      return fn();
    } finally {
      this.origin = prev;
    }
  }

  broadcast(message: HostToWebview, except?: Session): void {
    for (const s of [...this.sessions]) if (s !== except) s.post(message);
  }

  dispose(): void {
    this.off();
    this.sessions.clear();
  }

  private broadcastContent(e: ContentEvent): void {
    if (e.kind === 'patch') this.broadcast({ type: 'patch', revision: e.revision, patches: e.patches }, this.origin);
    else this.broadcast({ type: 'reset', doc: e.doc });
  }
}

/** Optional handlers for messages whose processing belongs to later tasks (tool registry, export). */
export interface RouterHandlers {
  op?(session: Session, msg: Extract<WebviewToHost, { type: 'op' }>): void;
  exportResult?(session: Session, msg: Extract<WebviewToHost, { type: 'export:result' }>): void;
  renderResult?(session: Session, msg: Extract<WebviewToHost, { type: 'render:result' }>): void;
  exportCancel?(session: Session, msg: Extract<WebviewToHost, { type: 'export:cancel' }>): void;
  selection?(session: Session, ids: string[]): void;
}

export interface RouterDeps {
  state: BoardDocumentState;
  accept: (direction: 'webview-to-host', data: unknown) => WebviewToHost | undefined;
  getSettings: () => Settings;
  logger: MessageLogger & { info?(message: string): void };
  handlers?: RouterHandlers;
  /** When given, liveness and unacknowledged-gesture reporting are wired through it. */
  hub?: SessionHub;
}

/** Builds `init` for a session: document, settings, read-only flag. */
export function buildInit(state: BoardDocumentState, settings: Settings): HostToWebview | undefined {
  const doc = state.getDocument();
  if (!doc) return undefined;
  const base = state.viewport ? { ...doc, viewport: state.viewport } : doc;
  return { type: 'init', doc: base, settings, readOnly: state.readOnly };
}

/** Routes one raw message from a session. Invalid messages are dropped and logged by `accept`. */
export function routeMessage(deps: RouterDeps, session: Session, raw: unknown): void {
  const msg = deps.accept('webview-to-host', raw);
  if (!msg) return;
  deps.hub?.noteActivity(session);
  const { state, handlers } = deps;
  switch (msg.type) {
    case 'ready': {
      const init = buildInit(state, deps.getSettings());
      if (!init) {
        deps.logger.warn('Ignored ready message: document is not displayable');
        return;
      }
      session.post(init);
      deps.hub?.reportUnacked(session);
      if (state.readOnly) session.post({ type: 'notice', level: 'info', message: NOTICE_READ_ONLY_NEWER });
      if (state.isLarge()) session.post({ type: 'notice', level: 'info', message: NOTICE_LARGE_BOARD });
      return;
    }
    case 'op':
      if (!state.canEdit) {
        deps.logger.warn('Dropped op: document is read-only');
        return;
      }
      deps.hub?.beginGesture(session, msg.gestureId);
      handlers?.op?.(session, msg);
      return;
    case 'viewport':
      state.viewport = msg.viewport;
      return;
    case 'selection':
      handlers?.selection?.(session, msg.ids);
      return;
    case 'export:result':
      handlers?.exportResult?.(session, msg);
      return;
    case 'render:result':
      handlers?.renderResult?.(session, msg);
      return;
    case 'export:cancel':
      handlers?.exportCancel?.(session, msg);
      return;
    case 'log':
      if (msg.level === 'warn') deps.logger.warn(msg.message);
      else deps.logger.info?.(msg.message);
      return;
  }
}
