/**
 * Board lifecycle tools: `openboard.board.list|open|create|save|close` (Req 13.16, 14.12).
 * The core cannot touch editors or the file system; everything goes through `BoardLifecycleHost`.
 * All tools are `async`: none of them mutates a board through a transaction.
 */
import { s } from '../schema/builder';
import type { DefaultToolRegistry, ToolDefinition } from './registry';

export interface BoardInfo {
  path: string;
  /** Unsaved edits exist. */
  dirty: boolean;
}

/** Host services for opening, creating, saving and closing boards. */
export interface BoardLifecycleHost {
  /** Every open board. */
  list(): BoardInfo[];
  /** Path of the active board, if any. */
  active(): string | undefined;
  /** Opens `path`; `background` opens without an editor tab. Rejects with code `not_found` if missing. */
  open(path: string, options?: { background?: boolean }): Promise<BoardInfo>;
  /** Creates a new board file. Must never overwrite: rejects with an error whose `code` is `already_exists`. */
  create(path: string): Promise<BoardInfo>;
  save(path: string): Promise<void>;
  /** Closes the board; with `discard` unsaved edits are dropped. */
  close(path: string, options: { discard: boolean }): Promise<void>;
}

class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const boardInfoSchema = s.object({ path: s.string(), dirty: s.boolean() });

function listTool(host: BoardLifecycleHost): ToolDefinition {
  return {
    name: 'openboard.board.list',
    description:
      'List the open boards with their path and unsaved state, and the path of the active board. Read-only.',
    inputSchema: s.object({}),
    outputSchema: s.object({ boards: s.array(boardInfoSchema), active: s.opt(s.string()) }),
    readOnly: true,
    boardResolution: 'none',
    async: true,
    handler() {
      const active = host.active();
      return { boards: host.list().map((b) => ({ path: b.path, dirty: b.dirty })), ...(active !== undefined ? { active } : {}) };
    },
  };
}

function openTool(host: BoardLifecycleHost): ToolDefinition<{ path: string; background?: boolean }, BoardInfo> {
  return {
    name: 'openboard.board.open',
    description:
      'Open the board file at `path`. With `background` true it is opened without an editor tab and does not become active. Returns the path and unsaved state.',
    inputSchema: s.object({ path: s.string({ minLength: 1 }), background: s.opt(s.boolean()) }),
    outputSchema: boardInfoSchema,
    readOnly: true,
    boardResolution: 'none',
    async: true,
    async handler(_ctx, input) {
      const info = await host.open(input.path, { background: input.background === true });
      return { path: info.path, dirty: info.dirty };
    },
  };
}

function createTool(host: BoardLifecycleHost): ToolDefinition<{ path: string }, BoardInfo> {
  return {
    name: 'openboard.board.create',
    description:
      'Create a new empty board file at `path` and open it. Fails with `already_exists` if the file exists; an existing file is never overwritten.',
    inputSchema: s.object({ path: s.string({ minLength: 1 }) }),
    outputSchema: boardInfoSchema,
    writesElsewhere: true,
    boardResolution: 'create',
    async: true,
    async handler(_ctx, input) {
      const info = await host.create(input.path);
      return { path: info.path, dirty: info.dirty };
    },
  };
}

function saveTool(host: BoardLifecycleHost): ToolDefinition<{ board?: string }, { path: string; saved: boolean }> {
  return {
    name: 'openboard.board.save',
    description: 'Save the board (the active board unless `board` names another) to its file.',
    inputSchema: s.object({ board: s.opt(s.string({ minLength: 1 })) }),
    outputSchema: s.object({ path: s.string(), saved: s.boolean() }),
    boardResolution: 'required-or-active',
    async: true,
    async handler(ctx) {
      if (!ctx.model) throw new ToolFailure('no_board', 'No board is available for this tool');
      await host.save(ctx.model.path);
      return { path: ctx.model.path, saved: true };
    },
  };
}

function closeTool(host: BoardLifecycleHost): ToolDefinition<{ board?: string; discard?: boolean }, { path: string; closed: boolean; discarded: boolean }> {
  return {
    name: 'openboard.board.close',
    description:
      'Close the board (the active board unless `board` names another). Unsaved edits block the close unless `discard` is true, which throws them away and cannot be undone.',
    inputSchema: s.object({ board: s.opt(s.string({ minLength: 1 })), discard: s.opt(s.boolean()) }),
    outputSchema: s.object({ path: s.string(), closed: s.boolean(), discarded: s.boolean() }),
    // Static flag: the registry cannot decide per input, so every close asks for confirmation.
    destructive: true,
    boardResolution: 'required-or-active',
    async: true,
    async handler(ctx, input) {
      if (!ctx.model) throw new ToolFailure('no_board', 'No board is available for this tool');
      const path = ctx.model.path;
      const discard = input.discard === true;
      const dirty = host.list().find((b) => b.path === path)?.dirty === true;
      if (dirty && !discard) {
        throw new ToolFailure('unsaved_changes', `${path} has unsaved changes; save it or pass discard: true`);
      }
      await host.close(path, { discard });
      return { path, closed: true, discarded: dirty && discard };
    },
  };
}

export function boardTools(host: BoardLifecycleHost): ToolDefinition[] {
  return [listTool(host), openTool(host), createTool(host), saveTool(host), closeTool(host)];
}

export function registerBoardTools(registry: Pick<DefaultToolRegistry, 'register'>, host: BoardLifecycleHost): void {
  for (const t of boardTools(host)) registry.register(t);
}
