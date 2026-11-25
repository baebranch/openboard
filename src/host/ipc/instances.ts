/**
 * Instance registry on disk: `<home>/instances/<instanceId>.json` (mode 0600, dir 0700).
 * `home` is `~/.openboard`, or `OPENBOARD_HOME` when set (tests, sandboxes). No sockets here.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInstanceRecord, type InstanceRecord } from '../../shared/ipc-protocol';

/** Resolves the OpenBoard data directory. */
export function openboardHome(env: NodeJS.ProcessEnv = process.env, homedir: () => string = os.homedir): string {
  const override = env.OPENBOARD_HOME;
  return override && override.trim().length > 0 ? path.resolve(override) : path.join(homedir(), '.openboard');
}

export const instancesDir = (home: string): string => path.join(home, 'instances');
export const runDir = (home: string): string => path.join(home, 'run');
export const binDir = (home: string): string => path.join(home, 'bin');

/** Creates a directory (and parents) with owner-only permissions where the platform supports it. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best effort (Windows) */
  }
}

const recordPath = (home: string, instanceId: string): string => path.join(instancesDir(home), `${instanceId}.json`);

/** Writes the record atomically (temp file + rename) with mode 0600. */
export function writeInstanceRecord(home: string, record: InstanceRecord): void {
  ensurePrivateDir(home);
  ensurePrivateDir(instancesDir(home));
  const file = recordPath(home, record.instanceId);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

/** Removes the record; missing files are fine. Synchronous so it is safe during deactivate. */
export function removeInstanceRecord(home: string, instanceId: string): void {
  try {
    unlinkSync(recordPath(home, instanceId));
  } catch {
    /* already gone */
  }
}

/** Whether a process exists. EPERM means it exists but belongs to someone else. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ListOptions {
  /** Returns whether the instance's endpoint accepts connections. Omit to skip the probe. */
  isReachable?: (record: InstanceRecord) => Promise<boolean>;
  alive?: (pid: number) => boolean;
}

/** Lists live instances and deletes stale records (dead pid, unreachable endpoint, unreadable file). */
export async function listInstances(home: string, options: ListOptions = {}): Promise<InstanceRecord[]> {
  const dir = instancesDir(home);
  if (!existsSync(dir)) return [];
  const alive = options.alive ?? pidAlive;
  const out: InstanceRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let record: InstanceRecord | undefined;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (isInstanceRecord(parsed)) record = parsed;
    } catch {
      /* unreadable or half-written: treat as stale below only if it is not a fresh temp */
    }
    if (!record) continue;
    let live = alive(record.pid);
    if (live && options.isReachable) live = await options.isReachable(record);
    if (live) out.push(record);
    else {
      try {
        unlinkSync(file);
      } catch {
        /* raced with another cleaner */
      }
    }
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.instanceId.localeCompare(b.instanceId));
}
