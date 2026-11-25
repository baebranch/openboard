/**
 * Tool sessions: make a sequence of registry calls ONE atomic, single-undo unit.
 *
 * Design. Each call still runs through `registry.invoke` (validation, board resolution, trust gate,
 * per-call `model.transact`), so a script's later calls see its earlier writes immediately and
 * views update live. What changes is the history: on first use of a board the session takes a
 * per-board lock and opens a *scope* on its `BoardModel` (see `BoardModel.beginScope`). While the
 * scope is open, successful transactions apply to the document but their undo entries are held
 * back. `commit()` records ONE merged undo entry per board (and one IDE edit event); `rollback()`
 * applies the inverse patches in reverse order, restoring the board exactly and recording nothing.
 *
 * Limits: the lock serializes sessions per board, but an unrelated edit (e.g. the user typing in
 * the editor) made while a session is open joins the scope and is undone with it on rollback.
 * `openboard.board.save` first commits pending work (it must save a consistent document), so a
 * `save()` in the middle of a script splits the undo entries and cannot be rolled back afterwards.
 */
import type { BoardModel } from '../ops';
import type { InvokeOptions } from './registry';

export const SAVE_TOOL_NAME = 'openboard.board.save';
export const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
export const DEFAULT_SESSION_LABEL = 'OpenBoard script';

export class SessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

/** The registry surface a session needs. */
export interface SessionRegistry {
  invoke(name: string, input: unknown, options?: InvokeOptions): Promise<unknown>;
}

const locks = new WeakMap<BoardModel, Promise<void>>();

export class ToolSession {
  private readonly held = new Map<BoardModel, () => void>();
  private readonly entering = new Map<BoardModel, Promise<void>>();
  private ended = false;

  constructor(
    private readonly label: string = DEFAULT_SESSION_LABEL,
    private readonly lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
  ) {}

  get isEnded(): boolean {
    return this.ended;
  }

  /** `InvokeSession.enter`: joins `model` (lock + scope) once per board. */
  enter(model: BoardModel): Promise<void> {
    if (this.ended) return Promise.reject(new SessionError('session_ended', 'The script has already finished'));
    if (this.held.has(model)) return Promise.resolve();
    let pending = this.entering.get(model);
    if (!pending) {
      pending = this.acquire(model).finally(() => this.entering.delete(model));
      this.entering.set(model, pending);
    }
    return pending;
  }

  private async acquire(model: BoardModel): Promise<void> {
    const previous = locks.get(model) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(model, previous.then(() => mine));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const acquired = await Promise.race([
      previous.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), this.lockTimeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!acquired) {
      void previous.then(release); // give the queue slot back as soon as the holder finishes
      throw new SessionError('board_busy', `Board ${model.path} is being edited by another script; try again`);
    }
    if (this.ended) {
      release();
      throw new SessionError('session_ended', 'The script has already finished');
    }
    try {
      model.beginScope(this.label);
      model.takeLastDerivedIds(); // stale ids from before the session must not reach its first call
    } catch (e) {
      release();
      throw e;
    }
    this.held.set(model, release);
  }

  /** Commits pending work (one undo entry per board) and releases the boards; the session stays usable. */
  flush(): void {
    for (const [model, release] of this.held) {
      try {
        model.commitScope();
      } finally {
        release();
      }
    }
    this.held.clear();
  }

  /** Commits and ends the session. */
  commit(): void {
    this.ended = true;
    this.flush();
  }

  /** Reverts everything done since each board was joined, and ends the session. */
  rollback(): void {
    this.ended = true;
    for (const [model, release] of this.held) {
      try {
        model.rollbackScope();
      } finally {
        release();
      }
    }
    this.held.clear();
  }

  /** Invokes through `registry` as part of this session (`board.save` commits pending work first). */
  invoke(registry: SessionRegistry, name: string, input: unknown): Promise<unknown> {
    if (name === SAVE_TOOL_NAME) this.flush();
    return registry.invoke(name, input, { session: this });
  }
}

export const DEFAULT_SESSION_TTL_MS = 120_000;

interface ManagedSession {
  session: ToolSession;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Window-side table of sessions started by remote callers (the MCP server). A session that sees no
 * call for `ttlMs` (the caller died) is rolled back.
 */
export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(
    private readonly registry: SessionRegistry,
    private readonly ttlMs: number = DEFAULT_SESSION_TTL_MS,
  ) {}

  get size(): number {
    return this.sessions.size;
  }

  private touch(id: string): ToolSession {
    let entry = this.sessions.get(id);
    if (entry) clearTimeout(entry.timer);
    else entry = { session: new ToolSession(), timer: undefined as never };
    entry.timer = setTimeout(() => this.end(id, false), this.ttlMs);
    entry.timer.unref?.();
    this.sessions.set(id, entry);
    return entry.session;
  }

  invoke(id: string, name: string, input: unknown): Promise<unknown> {
    return this.touch(id).invoke(this.registry, name, input);
  }

  /** Ends a session; false when it never existed (nothing was written). */
  end(id: string, commit: boolean): boolean {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.sessions.delete(id);
    if (commit) entry.session.commit();
    else entry.session.rollback();
    return true;
  }

  /** Rolls back every open session. */
  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.end(id, false);
  }
}
