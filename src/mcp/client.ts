/**
 * Client side of the per-window local channel (named pipe / Unix socket). `net` is allowed here
 * and in src/host/ipc only; it is only ever given an endpoint path, never a port.
 */
import net from 'node:net';
import { MAX_MESSAGE_BYTES, type InstanceRecord, type IpcMethod } from '../shared/ipc-protocol';

export class IpcCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IpcCallError';
  }
}

export interface CallOptions {
  name?: string;
  input?: unknown;
  /** 0 disables the timeout (tool invocations can run long). */
  timeoutMs?: number;
  /** `invoke`: run inside this session (see ToolSession). */
  session?: string;
}

let nextId = 1;

/** Sends one request and resolves with `result`, or rejects with an IpcCallError. */
export function ipcCall(instance: Pick<InstanceRecord, 'endpoint' | 'token'>, method: IpcMethod, options: CallOptions = {}): Promise<unknown> {
  const id = nextId++;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    const endpoint = instance.endpoint;
    const socket = net.createConnection(endpoint);
    let buffer: Buffer = Buffer.alloc(0);
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      fn();
    };
    if (timeoutMs > 0) timer = setTimeout(() => finish(() => reject(new IpcCallError('timeout', `OpenBoard window did not answer within ${timeoutMs} ms`))), timeoutMs);
    socket.on('connect', () => {
      const request = { id, token: instance.token, method, name: options.name, input: options.input, session: options.session };
      socket.write(JSON.stringify(request) + '\n');
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      const nl = buffer.indexOf(0x0a);
      if (nl === -1) {
        if (buffer.length > MAX_MESSAGE_BYTES) finish(() => reject(new IpcCallError('too_large', 'response exceeds the size limit')));
        return;
      }
      let res: { error?: { code?: string; message?: string }; result?: unknown };
      try {
        res = JSON.parse(buffer.subarray(0, nl).toString('utf8'));
      } catch {
        return finish(() => reject(new IpcCallError('bad_response', 'malformed response from OpenBoard window')));
      }
      if (res.error) finish(() => reject(new IpcCallError(res.error?.code ?? 'error', res.error?.message ?? 'error')));
      else finish(() => resolve(res.result));
    });
    socket.on('error', (e) => finish(() => reject(new IpcCallError('unreachable', `Cannot reach the OpenBoard window: ${e.message}`))));
    socket.on('close', () => finish(() => reject(new IpcCallError('closed', 'OpenBoard window closed the connection'))));
  });
}

/** True when the endpoint accepts a connection (no request is sent). */
export function probeEndpoint(instance: Pick<InstanceRecord, 'endpoint'>, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(instance.endpoint);
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}
