/**
 * MCP server logic (transport-agnostic): exposes the five-tool surface (workspaces, read_skill,
 * execute, call, save) plus the skill topics as resources, and routes calls to the right OpenBoard
 * window. Scripts run in the QuickJS sandbox in THIS process; their tool calls travel over the
 * local channel inside one session so they commit or roll back as one unit.
 * Never writes to stdout itself; diagnostics go to `log` (stderr).
 */
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { executeScript, type ExecuteResult } from '../codemode/execute';
import {
  BOARD_SAVE_ACTION,
  SERVER_INSTRUCTIONS,
  TOOL_CALL,
  TOOL_EXECUTE,
  TOOL_READ_SKILL,
  TOOL_SAVE,
  TOOL_WORKSPACES,
  readSkill,
  resolveAction,
  withSkillHint,
  type SkillFile,
} from '../codemode/surface';
import { listInstances } from '../host/ipc/instances';
import type { InstanceRecord } from '../shared/ipc-protocol';
import { resolveWorkspace } from '../shared/workspace-resolve';
import type { CatalogFile } from './catalog';
import { IpcCallError, ipcCall, probeEndpoint } from './client';
import { errorResult, mapResult, registryError, type McpToolResult } from './results';

export const SKILL_URI_PREFIX = 'openboard://skill/';

export interface McpServerDeps {
  catalog: CatalogFile;
  skill: SkillFile;
  /** OpenBoard data directory (`~/.openboard` or OPENBOARD_HOME). */
  home: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  log?: (message: string) => void;
}

const textResult = (text: string): McpToolResult => ({ content: [{ type: 'text', text }] });
const jsonResult = (value: unknown): McpToolResult => textResult(JSON.stringify(value));

function executeToMcp(r: ExecuteResult): McpToolResult {
  if (r.ok) return jsonResult({ result: r.result, logs: r.logs });
  const { error, logs, rolledBack } = r;
  return { content: [{ type: 'text', text: JSON.stringify({ error, logs, rolledBack }) }], isError: true };
}

export function createMcpServer(deps: McpServerDeps): Server {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const log = deps.log ?? ((m: string) => console.error(`[openboard-mcp] ${m}`));

  const server = new Server(
    { name: 'openboard', version: deps.catalog.version },
    { capabilities: { tools: {}, resources: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const instances = (): Promise<InstanceRecord[]> =>
    listInstances(deps.home, { isReachable: (r) => probeEndpoint(r) });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: deps.catalog.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: 'object' } })),
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: deps.skill.topics.map((t) => ({
      uri: `${SKILL_URI_PREFIX}${t.id}`,
      name: `OpenBoard skill: ${t.id}`,
      description: t.summary,
      mimeType: 'text/markdown',
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const id = uri.startsWith(SKILL_URI_PREFIX) ? uri.slice(SKILL_URI_PREFIX.length) : '';
    const topic = deps.skill.topics.find((t) => t.id === id);
    if (!topic) throw new Error(`Unknown resource: ${uri}`);
    return { contents: [{ uri, mimeType: 'text/markdown', text: topic.content }] };
  });

  /** Resolves the target window from `workspace`/`board`; an error result when it cannot. */
  async function pickWindow(args: Record<string, unknown>): Promise<{ instance: InstanceRecord } | { error: McpToolResult }> {
    const resolved = resolveWorkspace({
      workspace: args.workspace,
      board: args.board,
      envWorkspaceId: env.OPENBOARD_WORKSPACE_ID,
      instances: await instances(),
      caseInsensitive: platform === 'win32',
    });
    return resolved.ok ? { instance: resolved.instance } : { error: errorResult('workspace_unresolved', resolved.message) };
  }

  const invokeIn = async (instance: InstanceRecord, name: string, input: unknown, session?: string): Promise<unknown> => {
    try {
      return await ipcCall(instance, 'invoke', { name, input, timeoutMs: 0, ...(session ? { session } : {}) });
    } catch (e) {
      if (e instanceof IpcCallError) return { error: { code: e.code, message: e.message } };
      throw e;
    }
  };

  async function callTool(name: string, rawArgs: unknown): Promise<McpToolResult> {
    if (rawArgs !== undefined && (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))) {
      return errorResult('invalid_input', 'Tool arguments must be a JSON object');
    }
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    switch (name) {
      case TOOL_WORKSPACES: {
        const list = await instances();
        return jsonResult({
          workspaces: list.map((i) => ({ workspaceId: i.workspaceId, workspaceName: i.workspaceName, folders: i.folders, ide: i.ide })),
        });
      }

      case TOOL_READ_SKILL: {
        const r = readSkill(deps.skill, args.topic);
        return r.ok ? textResult(r.text) : errorResult(r.code, r.message);
      }

      case TOOL_EXECUTE: {
        const target = await pickWindow(args);
        if ('error' in target) return target.error;
        const session = randomUUID();
        const result = await executeScript(
          { code: args.code, board: args.board, timeoutMs: args.timeoutMs },
          {
            invoke: (n, i) => invokeIn(target.instance, n, i, session),
            async finish(commit) {
              await ipcCall(target.instance, 'end', { name: session, input: { commit }, timeoutMs: 15_000 });
            },
          },
        );
        return executeToMcp(result);
      }

      case TOOL_CALL: {
        const action = resolveAction(deps.catalog.actions, args);
        if (!action.ok) return errorResult(action.error.code, action.error.message);
        const target = await pickWindow({ workspace: args.workspace, board: action.input.board });
        if ('error' in target) return target.error;
        const result = await invokeIn(target.instance, action.registryName, action.input);
        return mapResult(withSkillHint(result, action.registryName));
      }

      case TOOL_SAVE: {
        const target = await pickWindow(args);
        if ('error' in target) return target.error;
        const result = await invokeIn(target.instance, BOARD_SAVE_ACTION, typeof args.board === 'string' ? { board: args.board } : {});
        if (registryError(result)) return mapResult(result);
        return jsonResult({ saved: (result as { path?: string }).path ?? null });
      }

      default:
        return errorResult('unknown_tool', `Unknown tool "${name}"`);
    }
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callTool(request.params.name, request.params.arguments);
    } catch (e) {
      log(`tool ${request.params.name} failed: ${String(e)}`);
      return errorResult('internal', e instanceof Error ? e.message : String(e));
    }
  });

  return server;
}
