/**
 * LM_Tool_Bridge and invocation helpers. Pure: no `vscode` import (Req 1.4, 14.1, 14.3-14.5, 14.17).
 * The vscode glue lives in `lm-glue.ts`.
 */
import { executeScript } from '../../codemode/execute';
import { toolError } from '../../codemode/ob-api';
import {
  BOARD_LIST_ACTION,
  BOARD_SAVE_ACTION,
  TOOL_CALL,
  TOOL_EXECUTE,
  TOOL_READ_SKILL,
  TOOL_SAVE,
  TOOL_WORKSPACES,
  buildSurface,
  readSkill,
  resolveAction,
  withSkillHint,
  type SkillFile,
} from '../../codemode/surface';
import { buildConfirmation, isDestructiveInvocation } from '../../core/tools/confirm';
import type { InvokeOptions, ToolDefinition, ToolDescription } from '../../core/tools/registry';
import { ToolSession } from '../../core/tools/session';

/** The registry surface used by the bridge and the exported API. */
export interface AgentRegistry {
  list(): string[];
  describe(name: string): ToolDescription;
  invoke(name: string, input: unknown, options?: InvokeOptions): Promise<unknown>;
  def(name: string): ToolDefinition;
}

/** A result part: JSON text, or decoded image bytes. */
export type ResultPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: string; data: Uint8Array };

export interface PreparedInvocation {
  confirmationMessages?: { title: string; message: string };
}

export interface LmToolImpl {
  invoke(options: { input: unknown }, token?: unknown): Promise<ResultPart[]>;
  prepareInvocation(options: { input: unknown }, token?: unknown): PreparedInvocation;
}

/** Minimal view of `vscode.lm`. `supportsImages` tells whether image data parts can be built. */
export interface LmApi {
  registerTool(name: string, impl: LmToolImpl): { dispose(): void };
  readonly supportsImages: boolean;
}

/** Thrown for invalid command/API arguments; the message names the offending argument. */
export class InvalidArgumentError extends Error {
  constructor(
    readonly argument: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

/** Normalizes `(name, input)` where input is an object or a JSON string (Req 14.4, 14.5). */
export function normalizeInvokeArgs(
  registry: Pick<AgentRegistry, 'list'>,
  name: unknown,
  input: unknown,
): { name: string; input: unknown } {
  if (typeof name !== 'string' || name.length === 0) {
    throw new InvalidArgumentError('name', 'Invalid argument "name": expected a tool name string');
  }
  if (!registry.list().includes(name)) {
    throw new InvalidArgumentError('name', `Invalid argument "name": unknown tool "${name}"`);
  }
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      throw new InvalidArgumentError('input', `Invalid argument "input": not valid JSON (${(e as Error).message})`);
    }
  } else if (input === undefined || input === null) {
    parsed = {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidArgumentError('input', 'Invalid argument "input": expected a JSON object');
  }
  return { name, input: parsed };
}

function fromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

function isImageItem(v: unknown): v is { mimeType: string; data: string } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { mimeType?: unknown; data?: unknown };
  return typeof o.mimeType === 'string' && o.mimeType.startsWith('image/') && typeof o.data === 'string';
}

/**
 * Formats a tool result as JSON text. With `images`, base64 image results are split out into
 * image parts and their `data` is replaced in the text by a placeholder.
 */
export function formatResult(result: unknown, images: boolean): ResultPart[] {
  const parts: ResultPart[] = [];
  let shaped = result;
  if (images && typeof result === 'object' && result !== null) {
    const strip = (item: unknown): unknown => {
      if (!isImageItem(item)) return item;
      parts.push({ kind: 'image', mimeType: item.mimeType, data: fromBase64(item.data) });
      return { ...item, data: '[image data returned as an image part]' };
    };
    const r = result as Record<string, unknown>;
    if (isImageItem(r)) shaped = strip(r);
    else if (Array.isArray(r.results)) shaped = { ...r, results: r.results.map(strip) };
  }
  return [{ kind: 'text', text: JSON.stringify(shaped) }, ...parts];
}

function firstSentence(s: string): string {
  const m = /^[^.\n]*\./.exec(s);
  return (m ? m[0] : s).trim();
}

/** What `openboard_workspaces` reports for this window (the LM tools run inside one window). */
export interface WindowInfo {
  workspaceId?: string;
  workspaceName: string;
  folders: string[];
  ide: string;
}

export interface LmSurfaceOptions {
  /** The bundled skill (dist/mcp-skill.json), loaded lazily on first use. */
  skill: () => SkillFile;
  windowInfo: () => WindowInfo;
  log?: (message: string) => void;
}

/** Max characters of script shown in the confirmation prompt. */
export const SCRIPT_PREVIEW_CHARS = 200;

const textPart = (value: unknown): ResultPart[] => [{ kind: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];

/** Runs one of the five exposed tools against the registry. Pure; shared by tests and `registerLmTools`. */
export async function invokeSurfaceTool(
  name: string,
  input: unknown,
  registry: AgentRegistry,
  options: LmSurfaceOptions,
  images: boolean,
): Promise<ResultPart[]> {
  const args = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  switch (name) {
    case TOOL_WORKSPACES: {
      const boards = await registry.invoke(BOARD_LIST_ACTION, {});
      return textPart({ workspaces: [options.windowInfo()], boards });
    }
    case TOOL_READ_SKILL: {
      const r = readSkill(options.skill(), args.topic);
      return r.ok ? textPart(r.text) : textPart({ error: { code: r.code, message: r.message } });
    }
    case TOOL_EXECUTE: {
      const session = new ToolSession();
      const result = await executeScript(
        { code: args.code, board: args.board, timeoutMs: args.timeoutMs },
        {
          invoke: (n, i) => session.invoke(registry, n, i),
          finish: async (commit) => {
            if (commit) session.commit();
            else session.rollback();
          },
        },
      );
      return textPart(result.ok ? { result: result.result, logs: result.logs } : { error: result.error, logs: result.logs, rolledBack: result.rolledBack });
    }
    case TOOL_CALL: {
      const action = resolveAction(registry.list(), args);
      if (!action.ok) return textPart({ error: action.error });
      return formatResult(withSkillHint(await registry.invoke(action.registryName, action.input), action.registryName), images);
    }
    case TOOL_SAVE: {
      const result = await registry.invoke(BOARD_SAVE_ACTION, typeof args.board === 'string' ? { board: args.board } : {});
      if (toolError(result)) return textPart(result);
      return textPart({ saved: (result as { path?: string }).path ?? null });
    }
    default:
      return textPart({ error: { code: 'unknown_tool', message: `Unknown tool "${name}"` } });
  }
}

/** Confirmation prompt for a call, or none (Req 14.17; scripts always ask, destructive actions ask). */
export function prepareSurfaceInvocation(name: string, input: unknown, registry: AgentRegistry): PreparedInvocation {
  const args = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const board = typeof args.board === 'string' && args.board.length > 0 ? args.board : 'the active board';
  if (name === TOOL_EXECUTE) {
    const code = typeof args.code === 'string' ? args.code.replace(/\s+/g, ' ').trim() : '';
    const shown = code.length > SCRIPT_PREVIEW_CHARS ? `${code.slice(0, SCRIPT_PREVIEW_CHARS)}\u2026` : code;
    return { confirmationMessages: { title: name, message: buildConfirmation(name, board, `run script: ${shown}`) } };
  }
  if (name === TOOL_CALL) {
    const action = resolveAction(registry.list(), args);
    if (!action.ok || !isDestructiveInvocation(registry, action.registryName, action.input)) return {};
    const target = typeof action.input.board === 'string' && action.input.board.length > 0 ? action.input.board : 'the active board';
    const effect = firstSentence(registry.def(action.registryName).description);
    return { confirmationMessages: { title: action.registryName, message: buildConfirmation(action.registryName, target, effect) } };
  }
  return {};
}

/**
 * Registers the five exposed tools with `lm`; returns disposables. No per-action code: every
 * registry action is reached through `openboard_call` / `openboard_execute` (Req 14.1).
 */
export function registerLmTools(
  lm: Pick<LmApi, 'registerTool' | 'supportsImages'> | undefined,
  registry: AgentRegistry,
  options: LmSurfaceOptions,
): { dispose(): void }[] {
  const log = options.log ?? (() => {});
  if (!lm || typeof lm.registerTool !== 'function') {
    log('Language model tools API (vscode.lm.registerTool) is unavailable; skipping tool registration.');
    return [];
  }
  const disposables: { dispose(): void }[] = [];
  for (const tool of buildSurface(registry.list(), { workspace: false })) {
    const impl: LmToolImpl = {
      invoke: (callOptions) => invokeSurfaceTool(tool.name, callOptions.input, registry, options, lm.supportsImages),
      prepareInvocation: (callOptions) => prepareSurfaceInvocation(tool.name, callOptions.input, registry),
    };
    disposables.push(lm.registerTool(tool.name, impl));
  }
  return disposables;
}

/** The exported extension API: exactly `list`, `describe`, `invoke` (Req 14.3). */
export interface OpenBoardApi {
  list(): string[];
  describe(name: string): ToolDescription;
  invoke(name: string, input: unknown): Promise<unknown>;
}

export function createApi(registry: AgentRegistry): OpenBoardApi {
  return {
    list: () => registry.list(),
    describe: (name) => registry.describe(name),
    invoke: (name, input) => registry.invoke(name, input),
  };
}

/** Handler for the `openboard.invokeTool` command (Req 14.4, 14.5). */
export function createInvokeToolCommand(registry: AgentRegistry): (name?: unknown, input?: unknown) => Promise<unknown> {
  return async (name, input) => {
    const args = normalizeInvokeArgs(registry, name, input);
    return registry.invoke(args.name, args.input);
  };
}
