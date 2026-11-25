/**
 * Picks the OpenBoard window (instance) a tool call belongs to. Pure and unit-tested.
 *
 * Order: explicit `workspace` id -> explicit `workspace` absolute path -> `input.board` absolute path
 * (only when `workspace` is omitted) -> OPENBOARD_WORKSPACE_ID -> the only running instance -> error.
 */
import { isAbsolutePathLike, isInside, normalizeFolderPath } from './workspace-id';

export interface ResolvableInstance {
  workspaceId: string;
  folders: string[];
  workspaceName?: string;
}

export interface ResolveInput<T extends ResolvableInstance> {
  workspace?: unknown;
  /** The tool input's `board` value, when present. */
  board?: unknown;
  envWorkspaceId?: string | undefined;
  instances: readonly T[];
  caseInsensitive: boolean;
}

export type Resolution<T> = { ok: true; instance: T } | { ok: false; message: string };

/** Turns a `file:` URI into a path; other strings are returned unchanged. */
function toPath(value: string): string {
  if (!/^file:/i.test(value)) return value;
  try {
    let p = decodeURIComponent(new URL(value).pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  } catch {
    return value;
  }
}

/** The instance with the longest folder containing `path`, if any. */
export function instanceForPath<T extends ResolvableInstance>(
  instances: readonly T[],
  path: string,
  caseInsensitive: boolean,
): T | undefined {
  const target = normalizeFolderPath(toPath(path));
  let best: { instance: T; length: number } | undefined;
  for (const instance of instances) {
    for (const folder of instance.folders) {
      const f = normalizeFolderPath(folder);
      if (isInside(f, target, caseInsensitive) && (!best || f.length > best.length)) best = { instance, length: f.length };
    }
  }
  return best?.instance;
}

export function describeInstances(instances: readonly ResolvableInstance[]): string {
  if (instances.length === 0) return 'none';
  return instances
    .map((i) => `- ${i.workspaceId}${i.workspaceName ? ` (${i.workspaceName})` : ''}: ${i.folders.length ? i.folders.join(', ') : '(no folders)'}`)
    .join('\n');
}

export function resolveWorkspace<T extends ResolvableInstance>(input: ResolveInput<T>): Resolution<T> {
  const { instances, caseInsensitive } = input;
  if (instances.length === 0) {
    return {
      ok: false,
      message: 'No OpenBoard window is running. Open a folder or board in an IDE with the OpenBoard extension (MCP channel enabled) and retry.',
    };
  }
  const explicit = typeof input.workspace === 'string' && input.workspace.trim().length > 0 ? input.workspace.trim() : undefined;
  if (explicit !== undefined) {
    const byId = instances.find((i) => i.workspaceId === explicit);
    if (byId) return { ok: true, instance: byId };
    if (isAbsolutePathLike(toPath(explicit))) {
      const byPath = instanceForPath(instances, explicit, caseInsensitive);
      if (byPath) return { ok: true, instance: byPath };
    }
    return {
      ok: false,
      message: `Unknown workspace "${explicit}". Pass a workspace id from openboard_workspaces or an absolute path inside the workspace. Running workspaces:\n${describeInstances(instances)}`,
    };
  }
  if (typeof input.board === 'string' && isAbsolutePathLike(toPath(input.board))) {
    const byBoard = instanceForPath(instances, input.board, caseInsensitive);
    if (byBoard) return { ok: true, instance: byBoard };
  }
  if (input.envWorkspaceId) {
    const byEnv = instances.find((i) => i.workspaceId === input.envWorkspaceId);
    if (byEnv) return { ok: true, instance: byEnv };
  }
  if (instances.length === 1) return { ok: true, instance: instances[0] as T };
  return {
    ok: false,
    message: `Multiple OpenBoard windows are running; pass the "workspace" argument (a workspace id or an absolute path inside the workspace). Running workspaces:\n${describeInstances(instances)}`,
  };
}
