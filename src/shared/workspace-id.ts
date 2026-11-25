/**
 * Pure workspace identity logic for the MCP channel: path normalization and the stable workspace id.
 * No node or vscode imports, so it is shared by the extension host and the MCP stdio server.
 */
import { sha256Hex } from '../core/format/sha256';

/**
 * Normalizes an absolute file system path for comparison and hashing: forward slashes, lowercase
 * drive letter, no trailing slash (a bare root such as `/` or `c:/` is kept).
 */
export function normalizeFolderPath(p: string): string {
  let s = p.replace(/\\/g, '/');
  // Collapse duplicate slashes but keep a leading `//` (UNC).
  const unc = s.startsWith('//');
  s = s.replace(/\/{2,}/g, '/');
  if (unc) s = '/' + s;
  const drive = /^([A-Za-z]):(\/|$)/.exec(s);
  if (drive) s = drive[1]!.toLowerCase() + s.slice(1);
  if (s.length > 1 && s.endsWith('/') && !/^[a-z]:\/$/.test(s)) s = s.replace(/\/+$/, '');
  if (/^[a-z]:$/.test(s)) s += '/';
  return s.length === 0 ? '/' : s;
}

/** Sorted, de-duplicated, normalized folder list. */
export function normalizeFolders(folders: readonly string[]): string[] {
  return [...new Set(folders.map(normalizeFolderPath))].sort();
}

/**
 * Stable short id for a workspace: first 12 hex chars of sha256 over the sorted normalized folders.
 * A window without folders gets `empty-<instanceId>`.
 */
export function computeWorkspaceId(folders: readonly string[], instanceId: string): string {
  if (folders.length === 0) return `empty-${instanceId}`;
  const text = normalizeFolders(folders).join('\n');
  return sha256Hex(new TextEncoder().encode(text)).slice(0, 12);
}

/** True for absolute POSIX, Windows drive or UNC paths (independent of the running platform). */
export function isAbsolutePathLike(p: string): boolean {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(p);
}

/** True when `child` equals `folder` or lies inside it (both already normalized). */
export function isInside(folder: string, child: string, caseInsensitive: boolean): boolean {
  const f = caseInsensitive ? folder.toLowerCase() : folder;
  const c = caseInsensitive ? child.toLowerCase() : child;
  if (c === f) return true;
  const prefix = f.endsWith('/') ? f : f + '/';
  return c.startsWith(prefix);
}
