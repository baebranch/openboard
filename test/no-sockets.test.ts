/**
 * Integration test: OpenBoard opens no sockets, spawns no servers, and leaves no
 * lock/port files. Validates Requirements 14.6, 14.7, 19.6.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtomicFileWriter, type AtomicFs } from '../src/host/io/AtomicFileWriter';
import { parse } from '../src/core/format/parser';
import { serialize } from '../src/core/format/serializer';
import { buildFullRegistry } from './helpers/registry';
import { installBoardValidator } from './helpers/validator';

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Source files under src/ excluding unit tests (which may mention banned names as strings). */
const sourceFiles = walk(srcDir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));

/** Remove comments so prose does not trigger the scans. Strings are kept (specifiers live there). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Never allowed anywhere. `net` is allowed only in NET_DIRS (local pipe / Unix socket channel). */
const BANNED = ['http', 'https', 'ws', 'child_process', 'dgram', 'tls', 'http2', 'worker_threads', 'cluster'];
const specifier = BANNED.join('|');
const importRe = new RegExp(
  `(?:from\\s*|import\\s*\\(?\\s*|require\\s*\\(\\s*)['"](?:node:)?(?:${specifier})(?:/[^'"]*)?['"]`,
);
const netImportRe = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:node:)?net(?:\/[^'"]*)?['"]/;
const NET_DIRS = ['src/host/ipc/', 'src/mcp/'];
const inNetDir = (rel: string): boolean => NET_DIRS.some((d) => rel.startsWith(d));
const usageRes: [string, RegExp][] = [
  ['fetch(', /(?<![\w.])fetch\s*\(|\bglobalThis\.fetch\b|\bwindow\.fetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
];

describe('no TCP / no network: static scan of src/', () => {
  it('finds source files to scan', () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it('has no http/https/ws/dgram/fetch/child_process usage anywhere in src', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = path.relative(root, file).replace(/\\/g, '/');
      const text = stripComments(readFileSync(file, 'utf8'));
      if (importRe.test(text)) offenders.push(`${rel}: banned module import`);
      for (const [label, re] of usageRes) if (re.test(text)) offenders.push(`${rel}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });

  it('uses `net` and creates servers only in src/host/ipc and src/mcp', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = path.relative(root, file).replace(/\\/g, '/');
      if (inNetDir(rel)) continue;
      const text = stripComments(readFileSync(file, 'utf8'));
      if (netImportRe.test(text)) offenders.push(`${rel}: net import`);
      if (/\bcreateServer\s*\(/.test(text)) offenders.push(`${rel}: createServer`);
      if (/\.listen\s*\(/.test(text)) offenders.push(`${rel}: listen(`);
    }
    expect(offenders).toEqual([]);
  });

  it('calls listen() only with a pipe/socket path, never a port', () => {
    const calls: { rel: string; args: string }[] = [];
    for (const file of sourceFiles) {
      const rel = path.relative(root, file).replace(/\\/g, '/');
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/\.listen\s*\(([^)]*)\)/g)) calls.push({ rel, args: m[1] ?? '' });
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const { rel, args } of calls) {
      expect(rel.startsWith('src/host/ipc/'), `${rel}: listen outside src/host/ipc`).toBe(true);
      expect(args.split(',')[0]!.trim(), `${rel}: listen must take the \`endpoint\` path`).toBe('endpoint');
      expect(args).not.toMatch(/\bport\b|\bhost\b|\d{2,}/i);
    }
    // No TCP-style options anywhere (`{ port }`, `.listen(8080)`).
    for (const file of sourceFiles) {
      const text = stripComments(readFileSync(file, 'utf8'));
      expect(text, file).not.toMatch(/\bcreateConnection\s*\(\s*(\{|\d)/);
    }
  });

  it('writes no .lock/.port/.pid files; .sock only for the per-window socket in src/host/ipc', () => {
    const offenders: string[] = [];
    const re = /['"`][^'"`\n]*\.(lock|port|pid|sock)['"`]/i;
    for (const file of sourceFiles) {
      const rel = path.relative(root, file).replace(/\\/g, '/');
      const text = stripComments(readFileSync(file, 'utf8'));
      const m = re.exec(text);
      if (!m) continue;
      if (rel.startsWith('src/host/ipc/') && /\.sock['"`]$/i.test(m[0])) continue;
      offenders.push(`${rel}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('no network: built bundles', () => {
  const bundles = ['dist/extension.js', 'dist/webview.js', 'dist/mcp.js'];
  const bundleRe = new RegExp(`require\\(\\s*["'](?:node:)?(?:${specifier})(?:/[^"']*)?["']\\s*\\)`);
  const netRe = /require\(\s*["'](?:node:)?net["']\s*\)/;

  it('contain no network module requires (net only in the extension and MCP bundles)', () => {
    if (bundles.some((b) => !existsSync(path.join(root, b)))) {
      try {
        execFileSync(process.execPath, ['esbuild.config.mjs'], { cwd: root, stdio: 'pipe' });
      } catch (e) {
        console.warn(`SKIP bundle scan: bundles missing and build failed (${(e as Error).message})`);
        return;
      }
    }
    const offenders: string[] = [];
    for (const b of bundles) {
      const p = path.join(root, b);
      if (!existsSync(p)) {
        console.warn(`SKIP ${b}: not present after build`);
        continue;
      }
      const text = readFileSync(p, 'utf8');
      const m = bundleRe.exec(text);
      if (m) offenders.push(`${b}: ${m[0]}`);
      if (b === 'dist/webview.js' && netRe.test(text)) offenders.push(`${b}: net`);
      if (/new\s+WebSocket\s*\(|new\s+XMLHttpRequest\s*\(|new\s+EventSource\s*\(/.test(text)) {
        offenders.push(`${b}: browser network constructor`);
      }
    }
    expect(offenders).toEqual([]);
  }, 120_000);
});

/** Node-fs backed AtomicFs over plain path strings. */
const nodeAtomicFs: AtomicFs<string> = {
  writeFile: (p, bytes) => writeFile(p, bytes),
  rename: (a, b) => rename(a, b),
  delete: (p) => rm(p, { force: true }),
  tempUriFor: (t, id) => `${t}.openboard.${id}.tmp`,
};

const LOCKISH = /openboard.*\.(lock|port|pid|sock)$/i;
const lockish = (dir: string): string[] => readdirSync(dir).filter((n) => LOCKISH.test(n)).sort();

describe('no sockets / no lock files: dynamic headless run', () => {
  let tmp: string | undefined;
  afterEach(() => {
    vi.restoreAllMocks();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('opens no sockets and creates no lock/port files during a full core scenario', async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'openboard-nosock-'));
    await mkdir(path.join(tmp, 'work'));
    const work = path.join(tmp, 'work');
    const tmpBefore = lockish(os.tmpdir());

    const spies = {
      listen: vi.spyOn(net.Server.prototype, 'listen'),
      connect: vi.spyOn(net.Socket.prototype, 'connect'),
      dgram: vi.spyOn(dgram, 'createSocket'),
      httpReq: vi.spyOn(http, 'request'),
      httpsReq: vi.spyOn(https, 'request'),
      httpGet: vi.spyOn(http, 'get'),
      httpsGet: vi.spyOn(https, 'get'),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const written: { path: string; bytes: Uint8Array }[] = [];
    const { registry, model } = buildFullRegistry({
      host: {
        rasterize: async () => new Uint8Array(),
        writeFile: async (p, bytes) => {
          written.push({ path: p, bytes });
        },
      },
    });
    const run = (name: string, input: unknown) => registry.invoke(name, input) as Promise<any>;

    const created = await run('openboard.element.create', {
      elements: [
        { type: 'rectangle', id: 'r1', x: 0, y: 0, width: 50, height: 30 },
        { type: 'rectangle', id: 'r2', x: 200, y: 10, width: 50, height: 30 },
        { type: 'rectangle', id: 'r3', x: 90, y: 150, width: 50, height: 30 },
      ],
    });
    expect(created.error).toBeUndefined();
    expect(created.ids).toEqual(['r1', 'r2', 'r3']);
    await run('openboard.element.update', { ids: ['r1'], set: { x: 10 } });
    await run('openboard.element.arrange', { ids: ['r1', 'r2', 'r3'], action: 'align', alignment: 'left' });
    await run('openboard.connect', { connections: [{ sourceId: 'r1', targetId: 'r2' }] });
    await run('openboard.layout', { direction: 'LR' });
    await run('openboard.batch', {
      operations: [{ tool: 'openboard.element.update', input: { ids: ['r2'], set: { y: 40 } } }],
    });
    const exported = await run('openboard.export', { format: 'svg', path: path.join(work, 'out.svg') });
    expect(exported.error).toBeUndefined();
    expect(written.length).toBe(1);

    // serialize + parse round trip
    const text = serialize(model.getDocument());
    installBoardValidator();
    const parsed = parse(text);
    expect(parsed.ok).toBe(true);

    // atomic file write against the real file system
    const target = path.join(work, 'board.openboard');
    await new AtomicFileWriter<string>(nodeAtomicFs).write(target, new TextEncoder().encode(text));
    expect(readFileSync(target, 'utf8')).toBe(text);
    expect(readdirSync(work)).toEqual(['board.openboard']);

    for (const [name, spy] of Object.entries({ ...spies, fetch: fetchSpy })) {
      expect(spy.mock.calls.length, `${name} calls`).toBe(0);
    }

    // no lock/port/pid files in the working dir or os.tmpdir()
    expect(readdirSync(work).filter((n) => /\.(lock|port|pid|sock)$/i.test(n))).toEqual([]);
    expect(lockish(os.tmpdir())).toEqual(tmpBefore);
  });
});

describe('code mode (QuickJS sandbox) opens no sockets and spawns nothing', () => {
  it('src/codemode and src/mcp/skill import only fs, module, path and the QuickJS packages', () => {
    const files = sourceFiles.filter((f) => /[\\/]src[\\/](codemode|mcp[\\/]skill)[\\/]/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(6);
    const allowedNode = new Set(['node:fs', 'node:module', 'node:path']);
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/(?<![\w'"`.])(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
        const spec = m[1] as string;
        if (spec.startsWith('.')) continue;
        const ok = allowedNode.has(spec) || spec.startsWith('quickjs-emscripten-core') || spec.startsWith('@jitl/quickjs-wasmfile-release-sync');
        expect(ok, `${path.relative(root, file)} imports ${spec}`).toBe(true);
      }
    }
  });

  it('scripts that try fetch / require / process make no network or process calls', async () => {
    const { runSandbox } = await import('../src/codemode/sandbox');
    const { GUEST_PRELUDE } = await import('../src/codemode/ob-api');
    const spies = {
      connect: vi.spyOn(net.Socket.prototype, 'connect'),
      listen: vi.spyOn(net.Server.prototype, 'listen'),
      dgram: vi.spyOn(dgram, 'createSocket'),
      httpReq: vi.spyOn(http, 'request'),
      httpsReq: vi.spyOn(https, 'request'),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const hostCall = async () => ({ ok: true as const, value: null });
    for (const code of [
      'await fetch("http://127.0.0.1:9/")',
      'require("net").connect(9)',
      'process.binding("tcp_wrap")',
      'new WebSocket("ws://127.0.0.1:9/")',
      'new XMLHttpRequest()',
      'this.constructor.constructor("return process")().exit()',
    ]) {
      const r = await runSandbox({ prelude: GUEST_PRELUDE, code, hostCall, timeoutMs: 3000 });
      expect(r.ok, code).toBe(false);
    }
    const loop = await runSandbox({ prelude: GUEST_PRELUDE, code: 'for (;;) {}', hostCall, timeoutMs: 200 });
    expect(loop).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    for (const [name, spy] of Object.entries({ ...spies, fetch: fetchSpy })) {
      expect(spy.mock.calls.length, `${name} calls`).toBe(0);
    }
    vi.restoreAllMocks();
  }, 30_000);
});

/** Runs eslint and returns stdout regardless of exit status (non-zero only means diagnostics exist). */
function eslint(args: string[], input?: string): string {
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules/eslint/bin/eslint.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!r.stdout) throw new Error(`eslint produced no output: ${r.stderr}`);
  return r.stdout;
}

describe('eslint no-restricted-imports rule: allowed dirs', () => {
  const probe = (file: string, code: string): boolean => {
    const out = eslint(['--stdin', '--stdin-filename', file, '-f', 'json'], code);
    const results = JSON.parse(out) as { messages: { ruleId: string | null }[] }[];
    return results[0]!.messages.some((m) => m.ruleId === 'no-restricted-imports');
  };
  it('allows net (only) in src/host/ipc and src/mcp', () => {
    for (const dir of ['src/host/ipc', 'src/mcp']) {
      expect(probe(`${dir}/__probe.ts`, "import net from 'node:net';\nexport default net;\n")).toBe(false);
      expect(probe(`${dir}/__probe.ts`, "import http from 'node:http';\nexport default http;\n")).toBe(true);
      expect(probe(`${dir}/__probe.ts`, "import cp from 'child_process';\nexport default cp;\n")).toBe(true);
    }
    expect(probe('src/host/__probe.ts', "import net from 'net';\nexport default net;\n")).toBe(true);
  }, 120_000);
});

describe('eslint no-restricted-imports rule', () => {
  it('reports zero errors for src/', () => {
    const out = eslint(['src', '-f', 'json']);
    const results = JSON.parse(out) as { filePath: string; messages: { ruleId: string | null; severity: number }[] }[];
    expect(results.length).toBeGreaterThan(20);
    // Other pre-existing diagnostics (e.g. a missing react-hooks plugin) are out of scope here.
    const restricted = results.flatMap((r) =>
      r.messages.filter((m) => m.ruleId === 'no-restricted-imports').map(() => r.filePath),
    );
    expect(restricted).toEqual([]);
  }, 120_000);

  it('flags a banned import (proves the rule is active for src/)', () => {
    const out = eslint(['--stdin', '--stdin-filename', 'src/core/__probe.ts', '-f', 'json'], "import net from 'node:net';\nexport default net;\n");
    const results = JSON.parse(out) as { messages: { ruleId: string | null }[] }[];
    expect(results[0]!.messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  }, 120_000);

  it('is configured to forbid the network/process modules', () => {
    const cfg = readFileSync(path.join(root, 'eslint.config.mjs'), 'utf8');
    for (const m of ['net', 'http', 'https', 'ws', 'child_process', 'dgram']) expect(cfg).toContain(`'${m}'`);
    expect(cfg).toContain('no-restricted-imports');
  });
});
