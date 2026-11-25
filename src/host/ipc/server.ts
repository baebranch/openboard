/**
 * Per-window local channel for the MCP stdio server. Listens ONLY on a Windows named pipe or a
 * Unix domain socket (never a TCP port), authenticates each request with a per-instance token and
 * routes `invoke` to the window's tool registry (the same pipeline as the API and openboard.invokeTool).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, rmSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { MAX_MESSAGE_BYTES, checkRequest, type InstanceRecord, type IpcResponse } from '../../shared/ipc-protocol';
import { computeWorkspaceId } from '../../shared/workspace-id';
import type { InvokeOptions } from '../../core/tools/registry';
import { SessionManager } from '../../core/tools/session';
import { ensurePrivateDir, removeInstanceRecord, runDir, writeInstanceRecord } from './instances';

/** The registry surface the channel needs (structurally satisfied by DefaultToolRegistry). */
export interface ChannelRegistry {
  list(): string[];
  describe(name: string): unknown;
  invoke(name: string, input: unknown, options?: InvokeOptions): Promise<unknown>;
}

export interface ChannelOptions {
  registry: ChannelRegistry;
  home: string;
  ide: string;
  version: string;
  /** Absolute fs paths of the workspace folders, read on every refresh. */
  folders: () => string[];
  workspaceName: () => string;
  log?: (message: string) => void;
  platform?: NodeJS.Platform;
  maxMessageBytes?: number;
}

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');

function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class IpcChannel {
  readonly instanceId = hex(8);
  readonly token = hex(32);
  readonly endpoint: string;
  private readonly startedAt = new Date().toISOString();
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  private currentWorkspaceId = '';
  private listeners = new Set<(workspaceId: string) => void>();
  private readonly maxBytes: number;
  private readonly log: (m: string) => void;
  private readonly sessions: SessionManager;

  constructor(private readonly options: ChannelOptions) {
    this.sessions = new SessionManager(options.registry);
    const platform = options.platform ?? process.platform;
    const random = hex(8);
    this.endpoint =
      platform === 'win32' ? `\\\\.\\pipe\\openboard-${random}` : path.join(runDir(options.home), `${random}.sock`);
    this.maxBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
    this.log = options.log ?? (() => {});
    this.currentWorkspaceId = this.computeId();
  }

  get workspaceId(): string {
    return this.currentWorkspaceId;
  }

  get running(): boolean {
    return this.server?.listening === true;
  }

  /** Called when the workspace id changes after a refresh. */
  onDidChangeWorkspaceId(listener: (workspaceId: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private computeId(): string {
    return computeWorkspaceId(this.options.folders(), this.instanceId);
  }

  private record(): InstanceRecord {
    return {
      instanceId: this.instanceId,
      workspaceId: this.currentWorkspaceId,
      folders: this.options.folders(),
      workspaceName: this.options.workspaceName(),
      ide: this.options.ide,
      pid: process.pid,
      endpoint: this.endpoint,
      token: this.token,
      version: this.options.version,
      startedAt: this.startedAt,
    };
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (!this.endpoint.startsWith('\\\\.\\pipe\\')) {
      ensurePrivateDir(this.options.home);
      ensurePrivateDir(runDir(this.options.home));
    }
    const server = net.createServer((socket) => this.onConnection(socket));
    this.server = server;
    const endpoint = this.endpoint;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (this.server !== server) {
      // stop() ran while we were still binding: do not publish a record for a closed channel.
      server.close();
      return;
    }
    server.on('error', (e) => this.log(`MCP channel error: ${String(e)}`));
    if (!endpoint.startsWith('\\\\.\\pipe\\')) {
      try {
        chmodSync(endpoint, 0o600);
      } catch {
        /* best effort */
      }
    }
    writeInstanceRecord(this.options.home, this.record());
    this.log(`MCP channel listening (workspace ${this.currentWorkspaceId})`);
  }

  /** Re-reads folders and rewrites the record. Returns true when the workspace id changed. */
  refresh(): boolean {
    const next = this.computeId();
    const changed = next !== this.currentWorkspaceId;
    this.currentWorkspaceId = next;
    if (this.running) writeInstanceRecord(this.options.home, this.record());
    if (changed) for (const l of [...this.listeners]) l(next);
    return changed;
  }

  /** Stops listening, drops connections and removes the record and socket file. Safe to call twice. */
  stop(): void {
    const server = this.server;
    this.server = undefined;
    removeInstanceRecord(this.options.home, this.instanceId);
    this.sessions.dispose(); // scripts that were mid-flight are rolled back
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (!server) return;
    try {
      server.close();
    } catch {
      /* not running */
    }
    if (!this.endpoint.startsWith('\\\\.\\pipe\\')) {
      try {
        unlinkSync(this.endpoint);
      } catch {
        rmSync(this.endpoint, { force: true });
      }
    }
  }

  private onConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let buffer: Buffer = Buffer.alloc(0);
    // Requests on one connection are answered in order.
    let chain: Promise<void> = Promise.resolve();
    const send = (res: IpcResponse): void => {
      if (!socket.destroyed) socket.write(JSON.stringify(res) + '\n');
    };
    socket.on('data', (chunk: Buffer) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      let nl: number;
      while ((nl = buffer.indexOf(0x0a)) !== -1) {
        const line = buffer.subarray(0, nl);
        buffer = buffer.subarray(nl + 1);
        if (line.length > this.maxBytes) return this.tooLarge(socket, send);
        if (line.length === 0) continue;
        const text = line.toString('utf8');
        chain = chain.then(() => this.handleLine(text, send, socket));
      }
      if (buffer.length > this.maxBytes) this.tooLarge(socket, send);
    });
  }

  private tooLarge(socket: net.Socket, send: (r: IpcResponse) => void): void {
    send({ id: null, error: { code: 'too_large', message: 'request exceeds the size limit' } });
    socket.end();
  }

  private async handleLine(text: string, send: (r: IpcResponse) => void, socket: net.Socket): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return send({ id: null, error: { code: 'bad_request', message: 'malformed JSON' } });
    }
    const checked = checkRequest(parsed);
    if (!checked.ok) return send({ id: checked.id, error: { code: 'bad_request', message: checked.message } });
    const req = checked.request;
    if (!tokenMatches(this.token, req.token)) {
      send({ id: req.id, error: { code: 'unauthorized', message: 'unauthorized' } });
      socket.end();
      return;
    }
    const { registry } = this.options;
    try {
      switch (req.method) {
        case 'ping':
          return send({ id: req.id, result: { ok: true, instanceId: this.instanceId, workspaceId: this.currentWorkspaceId } });
        case 'list':
          return send({ id: req.id, result: registry.list() });
        case 'describe':
        case 'invoke': {
          if (!req.name || !registry.list().includes(req.name)) {
            return send({ id: req.id, error: { code: 'not_found', message: `unknown tool "${String(req.name)}"` } });
          }
          if (req.method === 'describe') return send({ id: req.id, result: registry.describe(req.name) });
          const result = req.session
            ? await this.sessions.invoke(req.session, req.name, req.input ?? {})
            : await registry.invoke(req.name, req.input ?? {});
          return send({ id: req.id, result: result === undefined ? null : result });
        }
        case 'end': {
          if (!req.name) return send({ id: req.id, error: { code: 'bad_request', message: 'missing session id' } });
          const commit = (req.input as { commit?: unknown } | null | undefined)?.commit === true;
          return send({ id: req.id, result: { ended: this.sessions.end(req.name, commit), committed: commit } });
        }
      }
    } catch (e) {
      send({ id: req.id, error: { code: 'invoke_failed', message: e instanceof Error ? e.message : String(e) } });
    }
  }
}
