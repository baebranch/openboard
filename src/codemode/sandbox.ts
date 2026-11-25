/**
 * QuickJS (WebAssembly) sandbox for agent-written scripts.
 *
 * The guest gets only the standard ECMAScript globals plus `ob` and `console`, both defined by the
 * prelude in `ob-api.ts`; there is no `require`, `process`, `fetch`, timer, or module loader. The
 * only way out is `__ob_call`, a host function that is captured by the prelude and then deleted
 * from the global object. Limits: wall-clock deadline (interrupt handler + host-side race), heap
 * memory, stack size, result size and log size.
 *
 * Host calls are asynchronous: the guest sees a promise; the host settles it and runs the pending
 * jobs. This uses the plain (non-asyncify) build, which is smaller and faster.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import loaderModule from '@jitl/quickjs-wasmfile-release-sync/emscripten-module';
import { QuickJSFFI } from '@jitl/quickjs-wasmfile-release-sync/ffi';
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSSyncVariant,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 60_000;
export const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_STACK_LIMIT_BYTES = 512 * 1024;
export const DEFAULT_MAX_RESULT_BYTES = 512 * 1024;
export const DEFAULT_MAX_LOG_BYTES = 64 * 1024;

/** Marshalled outcome of one host call, as seen by the guest. */
export type HostCallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; issues?: unknown } };

export type SandboxErrorKind = 'timeout' | 'memory' | 'stack' | 'result_too_large' | 'script_error' | 'internal';

export interface SandboxError {
  kind: SandboxErrorKind;
  message: string;
  /** Guest stack trace, when there is one. */
  stack?: string;
}

export interface SandboxOptions {
  /** Source of the prelude that defines `ob` and `console` (runs before the script). */
  prelude: string;
  /** Body of an async function; its return value is the result. */
  code: string;
  /** Dispatches `ob` calls. Must resolve to a `HostCallResult` (never reject). */
  hostCall: (method: string, args: unknown[]) => Promise<HostCallResult>;
  timeoutMs?: number;
  memoryLimitBytes?: number;
  stackLimitBytes?: number;
  maxResultBytes?: number;
  maxLogBytes?: number;
}

export type SandboxOutcome =
  | { ok: true; result: unknown; logs: string[]; durationMs: number }
  | { ok: false; error: SandboxError; logs: string[]; durationMs: number };

// --- wasm loading -------------------------------------------------------------------------------

const WASM_FILE = 'quickjs.wasm';

function candidateWasmPaths(): string[] {
  const out: string[] = [];
  if (process.env.OPENBOARD_QUICKJS_WASM) out.push(process.env.OPENBOARD_QUICKJS_WASM);
  // Bundled layout: dist/extension.js and dist/mcp.js sit next to dist/quickjs.wasm.
  if (typeof __dirname === 'string') out.push(path.join(__dirname, WASM_FILE));
  try {
    // Development / tests: straight from node_modules.
    const req = createRequire(path.join(process.cwd(), 'package.json'));
    out.push(req.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'));
  } catch {
    /* not installed here */
  }
  return out;
}

function loadWasmBinary(): ArrayBuffer {
  const tried = candidateWasmPaths();
  for (const p of tried) {
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
  throw new Error(`QuickJS WebAssembly file not found (looked for ${tried.join(', ') || WASM_FILE})`);
}

let modulePromise: Promise<QuickJSWASMModule> | undefined;

function getModule(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    const loader = ((loaderModule as unknown as { default?: unknown }).default ?? loaderModule) as never;
    const base: QuickJSSyncVariant = {
      type: 'sync',
      importFFI: () => Promise.resolve(QuickJSFFI as never),
      importModuleLoader: () => Promise.resolve(loader),
    };
    const variant = newVariant(base, { wasmBinary: loadWasmBinary() });
    modulePromise = newQuickJSWASMModuleFromVariant(variant);
    modulePromise.catch(() => {
      modulePromise = undefined; // allow a retry after a transient failure
    });
  }
  return modulePromise;
}

// --- runner -------------------------------------------------------------------------------------

const LOG_TRUNCATED = '[log output truncated]';

function classify(message: string, stack: string | undefined, timedOut: boolean): SandboxError {
  const lower = message.toLowerCase();
  if (timedOut || lower === 'interrupted') return { kind: 'timeout', message: 'Script exceeded its time limit and was stopped' };
  if (lower.includes('out of memory')) return { kind: 'memory', message: 'Script exceeded the memory limit and was stopped' };
  if (lower.includes('stack overflow') || lower.includes('maximum call stack')) {
    return { kind: 'stack', message: 'Script exceeded the maximum call stack size (runaway recursion?)' };
  }
  return stack ? { kind: 'script_error', message, stack } : { kind: 'script_error', message };
}

function describeError(dumped: unknown): { message: string; stack?: string } {
  if (dumped && typeof dumped === 'object') {
    const d = dumped as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown };
    const name = typeof d.name === 'string' && d.name !== 'Error' ? `${d.name}: ` : '';
    const message = typeof d.message === 'string' ? d.message : JSON.stringify(dumped);
    const stack = typeof d.stack === 'string' && d.stack.length > 0 ? d.stack : undefined;
    return stack ? { message: name + message, stack } : { message: name + message };
  }
  return { message: String(dumped) };
}

/** Wraps user code so that it is the body of an async function and its result is JSON text. */
export function wrapScript(code: string): string {
  // Same first line as the user's code so error line numbers match; the trailing newline protects
  // against a final `//` comment.
  return `(async () => { const __r = await (async () => { ${code}\n})(); return __r === undefined ? undefined : JSON.stringify(__r); })()`;
}

export async function runSandbox(options: SandboxOptions): Promise<SandboxOutcome> {
  const started = Date.now();
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
  const maxResult = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
  const maxLog = options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
  const logs: string[] = [];
  let logBytes = 0;
  let logsTruncated = false;
  const finish = (o: { ok: true; result: unknown } | { ok: false; error: SandboxError }): SandboxOutcome => {
    if (logsTruncated) logs.push(LOG_TRUNCATED);
    return { ...o, logs, durationMs: Date.now() - started };
  };

  let mod: QuickJSWASMModule;
  try {
    mod = await getModule();
  } catch (e) {
    return finish({ ok: false, error: { kind: 'internal', message: `Cannot start the sandbox: ${e instanceof Error ? e.message : String(e)}` } });
  }

  const deadline = started + timeoutMs;
  let timedOut = false;
  let disposed = false;
  const runtime = mod.newRuntime({
    memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES,
    maxStackSizeBytes: options.stackLimitBytes ?? DEFAULT_STACK_LIMIT_BYTES,
    interruptHandler: () => {
      if (Date.now() > deadline) {
        timedOut = true;
        return true;
      }
      return false;
    },
  });
  const context: QuickJSContext = runtime.newContext();
  const deferreds: QuickJSDeferredPromise[] = [];
  const inflight = new Set<Promise<void>>();
  // Host calls run one at a time, in call order, so `Promise.all([ob..., ob...])` is deterministic.
  let queue: Promise<unknown> = Promise.resolve();

  try {
    // --- host functions
    const hostCallFn = context.newFunction('__ob_call', (methodHandle, argsHandle) => {
      const method = context.getString(methodHandle);
      const argsJson = context.getString(argsHandle);
      const deferred = context.newPromise();
      deferreds.push(deferred);
      const run = queue.then(async (): Promise<HostCallResult> => {
        if (disposed) return { ok: false, error: { code: 'aborted', message: 'Script was stopped' } };
        let args: unknown[];
        try {
          const parsed = JSON.parse(argsJson) as unknown;
          args = Array.isArray(parsed) ? parsed : [];
        } catch {
          return { ok: false, error: { code: 'invalid_input', message: 'Arguments are not JSON-serializable' } };
        }
        try {
          return await options.hostCall(method, args);
        } catch (e) {
          return { ok: false, error: { code: 'internal', message: e instanceof Error ? e.message : String(e) } };
        }
      });
      queue = run;
      const settle = run.then((res) => {
        if (disposed) return;
        const text = JSON.stringify(res) ?? 'null';
        const h = context.newString(text);
        deferred.resolve(h);
        h.dispose();
      });
      inflight.add(settle);
      void settle.finally(() => inflight.delete(settle));
      return deferred.handle;
    });
    context.setProp(context.global, '__ob_call', hostCallFn);
    hostCallFn.dispose();

    const logFn = context.newFunction('__ob_log', (levelHandle, textHandle) => {
      const level = context.getString(levelHandle);
      const text = context.getString(textHandle);
      const line = level === 'log' ? text : `[${level}] ${text}`;
      if (logsTruncated) return;
      logBytes += line.length + 1;
      if (logBytes > maxLog) logsTruncated = true;
      else logs.push(line);
    });
    context.setProp(context.global, '__ob_log', logFn);
    logFn.dispose();

    // --- prelude, then the script
    const pre = context.evalCode(options.prelude, 'ob-prelude.js');
    if (pre.error) {
      const err = describeError(context.dump(pre.error));
      pre.error.dispose();
      return finish({ ok: false, error: { kind: 'internal', message: `Sandbox prelude failed: ${err.message}` } });
    }
    pre.value.dispose();

    const evaluated = context.evalCode(wrapScript(options.code), 'script.js');
    if (evaluated.error) {
      const err = describeError(context.dump(evaluated.error));
      evaluated.error.dispose();
      return finish({ ok: false, error: classify(err.message, err.stack, timedOut) });
    }
    const promise: QuickJSHandle = evaluated.value;

    // --- drive the event loop until the script settles
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()) + 50);
    });
    try {
      for (;;) {
        const jobs = runtime.executePendingJobs();
        if (jobs.error) {
          const err = describeError(context.dump(jobs.error));
          jobs.error.dispose();
          promise.dispose();
          return finish({ ok: false, error: classify(err.message, err.stack, timedOut) });
        }
        const state = context.getPromiseState(promise);
        if (state.type === 'fulfilled') {
          const value = state.value;
          const type = context.typeof(value);
          const text = type === 'undefined' ? undefined : context.getString(value);
          value.dispose();
          promise.dispose();
          if (text === undefined) return finish({ ok: true, result: null });
          if (text.length > maxResult) {
            return finish({
              ok: false,
              error: {
                kind: 'result_too_large',
                message: `Result is ${text.length} characters, over the ${maxResult} limit; return less (summaries, counts, ids)`,
              },
            });
          }
          return finish({ ok: true, result: JSON.parse(text) as unknown });
        }
        if (state.type === 'rejected') {
          const err = describeError(context.dump(state.error));
          state.error.dispose();
          promise.dispose();
          return finish({ ok: false, error: classify(err.message, err.stack, timedOut) });
        }
        if (timedOut || Date.now() > deadline + 50) {
          promise.dispose();
          return finish({ ok: false, error: classify('interrupted', undefined, true) });
        }
        if (runtime.hasPendingJob()) continue;
        if (inflight.size === 0) {
          promise.dispose();
          return finish({
            ok: false,
            error: { kind: 'script_error', message: 'Script did not finish: it is waiting on a promise that can never resolve (timers are not available)' },
          });
        }
        const raced = await Promise.race([...inflight, timeout]);
        if (raced === 'timeout') {
          timedOut = true;
          promise.dispose();
          return finish({ ok: false, error: classify('interrupted', undefined, true) });
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    return finish({ ok: false, error: classify(e instanceof Error ? e.message : String(e), undefined, timedOut) });
  } finally {
    disposed = true;
    // Let an in-flight host call finish before the caller decides to commit or roll back.
    if (inflight.size > 0) {
      let capTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...inflight]),
        new Promise<void>((resolve) => {
          capTimer = setTimeout(resolve, 5000);
        }),
      ]);
      if (capTimer) clearTimeout(capTimer);
    }
    for (const d of deferreds) {
      try {
        d.dispose();
      } catch {
        /* already disposed */
      }
    }
    try {
      context.dispose();
      runtime.dispose();
    } catch {
      /* leak-check failures on abnormal exits must not mask the outcome */
    }
  }
}
