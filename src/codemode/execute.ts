/**
 * `openboard_execute`: runs a script in the sandbox against a tool transport and finishes the
 * transport's session (commit on success, rollback on any failure). Shared by the MCP server (the
 * transport talks to a window over the local channel) and the VS Code LM tool (direct registry).
 */
import { GUEST_PRELUDE, createDispatcher, type InvokeTool } from './ob-api';
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, runSandbox, type SandboxErrorKind } from './sandbox';

export const MAX_CODE_LENGTH = 100_000;

/** Carries the script's tool calls and settles its transaction. */
export interface ExecTransport {
  invoke: InvokeTool;
  /** Called exactly once, after the script and all its host calls have finished. */
  finish(commit: boolean): Promise<void>;
}

export interface ExecuteInput {
  code: unknown;
  board?: unknown;
  timeoutMs?: unknown;
}

export type ExecuteErrorCode = SandboxErrorKind | 'invalid_input' | 'commit_failed';

export type ExecuteResult =
  | { ok: true; result: unknown; logs: string[]; durationMs: number }
  | { ok: false; error: { code: ExecuteErrorCode; message: string; stack?: string }; logs: string[]; durationMs: number; rolledBack: boolean };

const invalid = (message: string): ExecuteResult => ({
  ok: false,
  error: { code: 'invalid_input', message },
  logs: [],
  durationMs: 0,
  rolledBack: false,
});

/** Validates the input and creates nothing on failure (so `finish` is not called). */
export function checkExecuteInput(input: ExecuteInput): { code: string; board?: string; timeoutMs: number } | ExecuteResult {
  if (typeof input.code !== 'string' || input.code.trim().length === 0) return invalid('`code` must be a non-empty string');
  if (input.code.length > MAX_CODE_LENGTH) return invalid(`\`code\` is over ${MAX_CODE_LENGTH} characters`);
  if (input.board !== undefined && (typeof input.board !== 'string' || input.board.length === 0)) {
    return invalid('`board` must be a non-empty string');
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (input.timeoutMs !== undefined) {
    if (typeof input.timeoutMs !== 'number' || !Number.isFinite(input.timeoutMs) || input.timeoutMs < 1) {
      return invalid('`timeoutMs` must be a positive number');
    }
    timeoutMs = Math.min(Math.floor(input.timeoutMs), MAX_TIMEOUT_MS);
  }
  return { code: input.code, ...(input.board !== undefined ? { board: input.board as string } : {}), timeoutMs };
}

export async function executeScript(input: ExecuteInput, transport: ExecTransport): Promise<ExecuteResult> {
  const checked = checkExecuteInput(input);
  if ('ok' in checked) return checked;

  const outcome = await runSandbox({
    prelude: GUEST_PRELUDE,
    code: checked.code,
    timeoutMs: checked.timeoutMs,
    hostCall: createDispatcher({ invoke: (n, i) => transport.invoke(n, i), ...(checked.board !== undefined ? { defaultBoard: checked.board } : {}) }),
  });

  if (outcome.ok) {
    try {
      await transport.finish(true);
    } catch (e) {
      return {
        ok: false,
        error: { code: 'commit_failed', message: `Could not finish the edit: ${e instanceof Error ? e.message : String(e)}` },
        logs: outcome.logs,
        durationMs: outcome.durationMs,
        rolledBack: false,
      };
    }
    return { ok: true, result: outcome.result, logs: outcome.logs, durationMs: outcome.durationMs };
  }
  let rolledBack = true;
  try {
    await transport.finish(false);
  } catch {
    rolledBack = false;
  }
  return { ok: false, error: { code: outcome.error.kind, message: outcome.error.message, ...(outcome.error.stack ? { stack: outcome.error.stack } : {}) }, logs: outcome.logs, durationMs: outcome.durationMs, rolledBack };
}
