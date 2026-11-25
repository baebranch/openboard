/**
 * Lists the font families installed on this machine for the font picker. Scans the standard
 * system and per-user font folders and reads each file's `name` table (see font-names.ts) with
 * small positional reads. No processes are spawned and nothing leaves the machine. The result is
 * computed once per extension host and cached; failures yield an empty list.
 */
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFontFamilies, type ByteReader } from './font-names';

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;
/** Bounds for very large or deeply nested font trees (mostly Linux). */
const MAX_FILES = 6000;
const MAX_DEPTH = 5;
const CONCURRENCY = 16;

/** Standard font folders for a platform; missing folders are skipped. */
export function fontDirectories(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === 'win32') {
    const windir = env['WINDIR'] ?? env['SystemRoot'] ?? 'C:\\Windows';
    const local = env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
    return [join(windir, 'Fonts'), join(local, 'Microsoft', 'Windows', 'Fonts')];
  }
  if (platform === 'darwin') {
    return ['/System/Library/Fonts', '/Library/Fonts', join(home, 'Library', 'Fonts')];
  }
  const dataHome = env['XDG_DATA_HOME'] ?? join(home, '.local', 'share');
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(dataHome, 'fonts'), join(home, '.fonts')];
}

async function collectFiles(dirs: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if ((e.isFile() || e.isSymbolicLink()) && FONT_FILE.test(e.name)) {
        const key = p.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(p);
        }
      }
    }
  };
  for (const d of dirs) await walk(d, 0);
  return out;
}

async function familiesOfFile(path: string): Promise<string[]> {
  let handle: import('node:fs/promises').FileHandle | undefined;
  try {
    handle = await fs.open(path, 'r');
    const h = handle;
    const read: ByteReader = async (offset, length) => {
      const buf = new Uint8Array(Math.max(0, length));
      const { bytesRead } = await h.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead);
    };
    return await readFontFamilies(read);
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Sorted, case-insensitively deduplicated family names. Hidden system families (names that start
 * with a dot, such as macOS UI fonts) are left out because CSS cannot select them by name.
 */
export function normalizeFamilies(names: Iterable<string>): string[] {
  const byKey = new Map<string, string>();
  for (const raw of names) {
    const n = raw.trim();
    if (n === '' || n.startsWith('.') || n.length > 256) continue;
    const k = n.toLowerCase();
    if (!byKey.has(k)) byKey.set(k, n);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Scans `dirs` and returns their font families. */
export async function scanFontFamilies(dirs: readonly string[]): Promise<string[]> {
  const files = await collectFiles(dirs);
  const names: string[] = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = await Promise.all(files.slice(i, i + CONCURRENCY).map(familiesOfFile));
    for (const b of batch) names.push(...b);
  }
  return normalizeFamilies(names);
}

let cached: Promise<string[]> | undefined;

/** Installed font families on this machine (computed once, then cached). Never rejects. */
export function listInstalledFonts(): Promise<string[]> {
  cached ??= scanFontFamilies(fontDirectories(process.platform, process.env, homedir())).catch(() => []);
  return cached;
}
