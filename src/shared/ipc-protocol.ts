/**
 * Wire protocol between the MCP stdio server and a window's local channel: newline-delimited JSON.
 * Shared types only; no node or vscode imports.
 */

/** Maximum size of one request or response line, in bytes (64 MB). */
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

/** `end` finishes a session (name = session id, input = { commit: boolean }). */
export type IpcMethod = 'list' | 'describe' | 'invoke' | 'ping' | 'end';

export interface IpcRequest {
  id: string | number;
  token: string;
  method: IpcMethod;
  name?: string;
  input?: unknown;
  /** `invoke` only: id of a session (one atomic, single-undo unit spanning several calls). */
  session?: string;
}

export interface IpcErrorBody {
  code: string;
  message: string;
}

export type IpcResponse = { id: string | number | null; result: unknown } | { id: string | number | null; error: IpcErrorBody };

/** The per-window instance record stored under `<home>/instances/<instanceId>.json`. */
export interface InstanceRecord {
  instanceId: string;
  workspaceId: string;
  folders: string[];
  workspaceName: string;
  ide: string;
  pid: number;
  endpoint: string;
  token: string;
  version: string;
  startedAt: string;
}

const METHODS: readonly string[] = ['list', 'describe', 'invoke', 'ping', 'end'];

/** Validates a parsed JSON value as a request envelope. Returns an error message when invalid. */
export function checkRequest(v: unknown): { ok: true; request: IpcRequest } | { ok: false; id: string | number | null; message: string } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, id: null, message: 'request must be an object' };
  const o = v as Record<string, unknown>;
  const id = typeof o.id === 'string' || typeof o.id === 'number' ? o.id : null;
  if (id === null) return { ok: false, id, message: 'missing id' };
  if (typeof o.token !== 'string') return { ok: false, id, message: 'missing token' };
  if (typeof o.method !== 'string' || !METHODS.includes(o.method)) return { ok: false, id, message: 'unknown method' };
  if (o.name !== undefined && typeof o.name !== 'string') return { ok: false, id, message: 'name must be a string' };
  if (o.session !== undefined && (typeof o.session !== 'string' || o.session.length === 0 || o.session.length > 128)) {
    return { ok: false, id, message: 'session must be a non-empty string' };
  }
  return { ok: true, request: o as unknown as IpcRequest };
}

/** Runtime check for an instance record read from disk. */
export function isInstanceRecord(v: unknown): v is InstanceRecord {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.instanceId === 'string' &&
    typeof o.workspaceId === 'string' &&
    Array.isArray(o.folders) &&
    o.folders.every((f) => typeof f === 'string') &&
    typeof o.pid === 'number' &&
    typeof o.endpoint === 'string' &&
    typeof o.token === 'string'
  );
}
