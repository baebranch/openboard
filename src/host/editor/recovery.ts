/**
 * Pure webview recovery and render logic (Req 2.10, 14.14, 14.15, 16.6, 16.10). No vscode imports;
 * timers are injected so everything is unit-testable with a fake scheduler.
 */
import type { Session } from './session';

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** A webview that has not reported `ready` (or any message) within this time is restarted (Req 16.6). */
export const WATCHDOG_TIMEOUT_MS = 3000;
/** Hard bound for the whole detect+restart cycle (Req 16.6). */
export const RESTART_DEADLINE_MS = 5000;

export const NOTICE_UNACKED_EDITS =
  'The board view was restarted. Your last edit may not have been applied. Please check the board and redo it if needed.';

/** Tracks gestures received from a session whose ack has not been delivered (Req 16.10). */
export class GestureTracker {
  private readonly pending = new Set<string>();
  begin(id: string): void {
    this.pending.add(id);
  }
  ack(id: string): void {
    this.pending.delete(id);
  }
  list(): string[] {
    return [...this.pending];
  }
  clear(): void {
    this.pending.clear();
  }
}

/**
 * Detects an unresponsive webview: no activity (ready or any message) within `timeoutMs` after
 * `arm()`. Any activity disarms it until the next `arm()` (called on every (re)load).
 */
export class Watchdog {
  private handle: unknown;
  private armed = false;
  constructor(
    private readonly scheduler: Scheduler,
    private readonly onTimeout: () => void,
    private readonly timeoutMs = WATCHDOG_TIMEOUT_MS,
  ) {}

  get isArmed(): boolean {
    return this.armed;
  }

  arm(): void {
    this.disarm();
    this.armed = true;
    this.handle = this.scheduler.setTimeout(() => {
      this.armed = false;
      this.handle = undefined;
      this.onTimeout();
    }, this.timeoutMs);
  }

  /** Called on any message from the webview. */
  touch(): void {
    this.disarm();
  }

  disarm(): void {
    if (this.handle !== undefined) this.scheduler.clearTimeout(this.handle);
    this.handle = undefined;
    this.armed = false;
  }
}

/** Retains and re-sends the viewport on show (Req 2.10). */
export function restoreViewport(
  session: Session,
  viewport: { x: number; y: number; zoom: number } | undefined,
): void {
  if (viewport) session.post({ type: 'viewport', viewport });
}

/** A hidden webview used to render previews/exports when no editor tab is open (Req 14.14, 14.15). */
export interface HiddenRenderPanel {
  readonly session: Session;
  /** Resolves when the panel's webview reported `ready` (and so received init). */
  whenReady(): Promise<void>;
  dispose(): void;
}

export class RenderTimeoutError extends Error {
  constructor(readonly requestId: string) {
    super(`Render request ${requestId} timed out`);
  }
}

/**
 * Sends `render:request` to an open editor session when one exists, otherwise to a lazily created
 * hidden panel (disposed once idle). Results come back through `handleResult`.
 */
export class RenderBroker {
  private readonly waiting = new Map<string, { resolve: (png: string) => void; reject: (e: Error) => void; timer: unknown }>();
  private hidden: HiddenRenderPanel | undefined;
  private inflight = 0;
  private counter = 0;

  constructor(
    private readonly deps: {
      getEditorSession: () => Session | undefined;
      createHiddenPanel: () => HiddenRenderPanel;
      scheduler?: Scheduler;
      timeoutMs?: number;
    },
  ) {}

  get hasHiddenPanel(): boolean {
    return this.hidden !== undefined;
  }

  async render(spec: Record<string, unknown>): Promise<string> {
    const sched = this.deps.scheduler ?? realScheduler;
    let target = this.deps.getEditorSession();
    this.inflight++;
    try {
      if (!target) {
        if (!this.hidden) this.hidden = this.deps.createHiddenPanel();
        await this.hidden.whenReady();
        target = this.hidden.session;
      }
      const requestId = `r${++this.counter}`;
      const result = new Promise<string>((resolve, reject) => {
        const timer = sched.setTimeout(() => {
          this.waiting.delete(requestId);
          reject(new RenderTimeoutError(requestId));
        }, this.deps.timeoutMs ?? 30000);
        this.waiting.set(requestId, { resolve, reject, timer });
      });
      target.post({ type: 'render:request', requestId, spec });
      return await result;
    } finally {
      this.inflight--;
      if (this.inflight === 0 && this.hidden) {
        this.hidden.dispose();
        this.hidden = undefined;
      }
    }
  }

  /** Feed `render:result` messages here. Returns false for unknown ids. */
  handleResult(requestId: string, png: string): boolean {
    const w = this.waiting.get(requestId);
    if (!w) return false;
    this.waiting.delete(requestId);
    (this.deps.scheduler ?? realScheduler).clearTimeout(w.timer);
    w.resolve(png);
    return true;
  }

  dispose(): void {
    for (const [id, w] of this.waiting) {
      (this.deps.scheduler ?? realScheduler).clearTimeout(w.timer);
      w.reject(new Error(`Render request ${id} cancelled`));
    }
    this.waiting.clear();
    this.hidden?.dispose();
    this.hidden = undefined;
  }
}
