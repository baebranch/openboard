/**
 * The agent-facing tool surface: five polymorphic tools, identical for the MCP server and the VS
 * Code language model tools. The internal registry (25 tools) is reached through `openboard_call`
 * (one action per call), `openboard_execute` (scripts) and nothing else. Pure; no node/vscode.
 */
import { toolError, TOOL_PREFIX } from './ob-api';

export const TOOL_WORKSPACES = 'openboard_workspaces';
export const TOOL_READ_SKILL = 'openboard_read_skill';
export const TOOL_EXECUTE = 'openboard_execute';
export const TOOL_CALL = 'openboard_call';
export const TOOL_SAVE = 'openboard_save';
export const EXPOSED_TOOL_NAMES = [TOOL_WORKSPACES, TOOL_READ_SKILL, TOOL_EXECUTE, TOOL_CALL, TOOL_SAVE] as const;

/** Registry tools the surface itself calls (everything else is dispatched generically). */
export const BOARD_LIST_ACTION = `${TOOL_PREFIX}board.list`;
export const BOARD_SAVE_ACTION = `${TOOL_PREFIX}board.save`;

export const SKILL_TOPIC_IDS = ['overview', 'elements', 'editing', 'flowcharts', 'export', 'library', 'code-mode', 'actions'] as const;

export interface SurfaceTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SkillTopic {
  id: string;
  summary: string;
  content: string;
}

/** The bundled skill (dist/mcp-skill.json). */
export interface SkillFile {
  version: string;
  topics: SkillTopic[];
}

export const SERVER_INSTRUCTIONS = [
  'OpenBoard: infinite-canvas whiteboards in the IDE.',
  'Call openboard_read_skill first (no topic = index); read `code-mode` before scripting.',
  'Prefer openboard_execute for multi-step edits (one undo step, rolled back on error); use openboard_call for a single action.',
  'With several IDE windows open, pass `workspace` (ids from openboard_workspaces).',
  'Save with openboard_save.',
].join('\n');

const WORKSPACE_PROP = {
  type: 'string',
  description: 'Window: workspaceId from openboard_workspaces or a path inside it. Optional with one window.',
};

/** `openboard.element.create` -> `element.create`. */
export function shortAction(registryName: string): string {
  return registryName.startsWith(TOOL_PREFIX) ? registryName.slice(TOOL_PREFIX.length) : registryName;
}

export function buildSurface(registryNames: string[], options: { workspace: boolean }): SurfaceTool[] {
  const actions = registryNames.map(shortAction);
  const ws = options.workspace ? { workspace: WORKSPACE_PROP } : {};
  return [
    {
      name: TOOL_WORKSPACES,
      description: options.workspace
        ? 'List running OpenBoard windows: workspaceId, workspaceName, folders, ide.'
        : 'Describe this OpenBoard window (workspaceId, workspaceName, folders, ide) and its open boards.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: TOOL_READ_SKILL,
      description: 'Read OpenBoard usage docs. Without `topic` returns the topic index; read it first.',
      inputSchema: {
        type: 'object',
        properties: { topic: { type: 'string', description: 'Topic id from the index, e.g. code-mode.' } },
        additionalProperties: false,
      },
    },
    {
      name: TOOL_EXECUTE,
      description:
        'Run JavaScript (async function body; `return` JSON) in a sandbox with a global `ob` API to read and edit boards. All edits of one run are a single undo step and roll back if the code throws. Read topic `code-mode` first.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Function body, e.g. const [a] = await ob.board().create({type:"rectangle"}); return a;' },
          board: { type: 'string', description: 'Board file path for ob.board(); default: active board.' },
          timeoutMs: { type: 'integer', minimum: 1, maximum: 60000, description: 'Default 10000.' },
          ...ws,
        },
        required: ['code'],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_CALL,
      description: `Run one OpenBoard action. Actions: ${actions.join(', ')}. Read topic \`actions\` for each input schema.`,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: actions },
          input: { type: 'object', additionalProperties: true },
          ...ws,
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    {
      name: TOOL_SAVE,
      description: 'Save a board to disk (default: the active board). Returns the saved path.',
      inputSchema: {
        type: 'object',
        properties: { board: { type: 'string', description: 'Board file path; default: active board.' }, ...ws },
        additionalProperties: false,
      },
    },
  ];
}

/** Serialized size of descriptions and input schemas (budget asserted in tests). */
export function surfaceSize(tools: SurfaceTool[]): number {
  return tools.reduce((n, t) => n + t.name.length + t.description.length + JSON.stringify(t.inputSchema).length, 0);
}

// --- skill reading ------------------------------------------------------------------------------

export function skillIndex(skill: SkillFile): string {
  const lines = skill.topics.map((t) => `- ${t.id}: ${t.summary}`);
  return `OpenBoard skill topics (call openboard_read_skill with topic=<id>):\n${lines.join('\n')}`;
}

export type SkillReadResult = { ok: true; text: string } | { ok: false; code: 'unknown_topic'; message: string };

export function readSkill(skill: SkillFile, topic: unknown): SkillReadResult {
  if (topic === undefined || topic === null || topic === '') return { ok: true, text: skillIndex(skill) };
  if (typeof topic !== 'string') return { ok: false, code: 'unknown_topic', message: '`topic` must be a string' };
  const found = skill.topics.find((t) => t.id === topic.trim().toLowerCase());
  if (found) return { ok: true, text: found.content };
  return {
    ok: false,
    code: 'unknown_topic',
    message: `Unknown topic "${topic}". Available: ${skill.topics.map((t) => t.id).join(', ')}`,
  };
}

// --- openboard_call -----------------------------------------------------------------------------

export type ActionResolution = { ok: true; registryName: string; input: Record<string, unknown> } | { ok: false; error: { code: string; message: string } };

/** Resolves `{ action, input }` to a registry tool name and object input. */
export function resolveAction(registryNames: string[], args: { action?: unknown; input?: unknown }): ActionResolution {
  const action = args.action;
  if (typeof action !== 'string' || action.length === 0) {
    return { ok: false, error: { code: 'invalid_input', message: '`action` is required. Read topic `actions` for the list.' } };
  }
  const registryName = registryNames.find((n) => n === action || shortAction(n) === action);
  if (!registryName) {
    return {
      ok: false,
      error: { code: 'unknown_action', message: `Unknown action "${action}". Actions: ${registryNames.map(shortAction).join(', ')}` },
    };
  }
  let input = args.input;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return { ok: false, error: { code: 'invalid_input', message: '`input` is not valid JSON' } };
    }
  }
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: { code: 'invalid_input', message: '`input` must be an object' } };
  }
  return { ok: true, registryName, input: input as Record<string, unknown> };
}

/** Adds a pointer to the `actions` skill topic to validation errors. */
export function withSkillHint(result: unknown, registryName: string): unknown {
  const err = toolError(result);
  if (!err) return result;
  const validation = err.issues !== undefined || /^(invalid_|unknown_property)/.test(err.code);
  if (!validation) return result;
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.issues !== undefined ? { issues: err.issues } : {}),
      hint: `Read openboard_read_skill topic "actions" for the input schema of ${shortAction(registryName)}.`,
    },
  };
}
