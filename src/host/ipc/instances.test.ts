import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../../shared/ipc-protocol';
import { instancesDir, listInstances, openboardHome, pidAlive, removeInstanceRecord, writeInstanceRecord } from './instances';
import { buildMcpConfig, ensureLauncher, launcherPath, nodeOnPath } from './launcher';

const record = (over: Partial<InstanceRecord> = {}): InstanceRecord => ({
  instanceId: 'i1',
  workspaceId: 'w1',
  folders: ['/a'],
  workspaceName: 'a',
  ide: 'Test',
  pid: process.pid,
  endpoint: '/tmp/x',
  token: 't'.repeat(64),
  version: '1.0.0',
  startedAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'openboard-inst-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('openboardHome', () => {
  it('honors OPENBOARD_HOME and defaults to ~/.openboard', () => {
    expect(openboardHome({ OPENBOARD_HOME: home })).toBe(path.resolve(home));
    expect(openboardHome({}, () => '/home/me')).toBe(path.join('/home/me', '.openboard'));
  });
});

describe('instance records', () => {
  it('writes, lists and removes records', async () => {
    writeInstanceRecord(home, record());
    const file = path.join(instancesDir(home), 'i1.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ instanceId: 'i1', workspaceId: 'w1' });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect((await listInstances(home)).map((r) => r.instanceId)).toEqual(['i1']);
    removeInstanceRecord(home, 'i1');
    expect(existsSync(file)).toBe(false);
    expect(await listInstances(home)).toEqual([]);
  });

  it('overwrites a record when the workspace id changes', async () => {
    writeInstanceRecord(home, record());
    writeInstanceRecord(home, record({ workspaceId: 'w2' }));
    expect((await listInstances(home)).map((r) => r.workspaceId)).toEqual(['w2']);
  });

  it('prunes records whose pid is dead', async () => {
    writeInstanceRecord(home, record({ instanceId: 'dead', pid: 999999 }));
    writeInstanceRecord(home, record({ instanceId: 'live' }));
    const out = await listInstances(home, { alive: (pid) => pid === process.pid });
    expect(out.map((r) => r.instanceId)).toEqual(['live']);
    expect(existsSync(path.join(instancesDir(home), 'dead.json'))).toBe(false);
  });

  it('prunes records whose endpoint is unreachable', async () => {
    writeInstanceRecord(home, record({ instanceId: 'a' }));
    writeInstanceRecord(home, record({ instanceId: 'b', endpoint: '/gone' }));
    const out = await listInstances(home, { isReachable: async (r) => r.endpoint !== '/gone' });
    expect(out.map((r) => r.instanceId)).toEqual(['a']);
    expect(existsSync(path.join(instancesDir(home), 'b.json'))).toBe(false);
  });

  it('ignores unrelated and corrupt files', async () => {
    writeInstanceRecord(home, record());
    writeFileSync(path.join(instancesDir(home), 'junk.json'), '{not json');
    writeFileSync(path.join(instancesDir(home), 'notes.txt'), 'x');
    expect((await listInstances(home)).map((r) => r.instanceId)).toEqual(['i1']);
  });

  it('pidAlive recognizes this process and rejects bogus pids', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-5)).toBe(false);
  });
});

describe('launcher and config', () => {
  it('writes the launcher and rewrites it when the extension path changes', () => {
    const file = ensureLauncher(home, '/ext/1.0.0/dist/mcp.js');
    expect(file).toBe(launcherPath(home));
    expect(readFileSync(file, 'utf8')).toContain('require("/ext/1.0.0/dist/mcp.js")');
    ensureLauncher(home, '/ext/1.1.0/dist/mcp.js');
    expect(readFileSync(file, 'utf8')).toContain('1.1.0');
    expect(readFileSync(file, 'utf8')).not.toContain('1.0.0');
  });

  it('finds node on PATH without a shell', () => {
    const exists = (f: string) => f === '/usr/bin/node';
    expect(nodeOnPath('/bin:/usr/bin', 'linux', exists)).toBe(true);
    expect(nodeOnPath('/bin', 'linux', exists)).toBe(false);
    expect(nodeOnPath(undefined, 'linux', exists)).toBe(false);
    expect(nodeOnPath('C:\\x;"C:\\tools\\"', 'win32', (f) => f === 'C:\\tools\\node.exe')).toBe(true);
  });

  it('builds the config snippet', () => {
    expect(buildMcpConfig({ launcher: '/l.js', execPath: '/ide', hasNode: true })).toEqual({
      mcpServers: { openboard: { command: 'node', args: ['/l.js'] } },
    });
    expect(buildMcpConfig({ launcher: '/l.js', execPath: '/ide', hasNode: false })).toEqual({
      mcpServers: { openboard: { command: '/ide', args: ['/l.js'], env: { ELECTRON_RUN_AS_NODE: '1' } } },
    });
  });
});
