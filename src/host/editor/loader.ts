/**
 * Pure board loading: size check, read, decode and parse. No vscode imports; the file system is
 * injected (Req 16.7, 2.9, 11.7).
 */
import type { ParseResult } from '../../core/format/parser';
import type { BoardDocument } from '../../core/model/types';

/** 200 MB (Req 16.7). Files strictly larger are declined. */
export const MAX_BOARD_FILE_BYTES = 209_715_200;
/** Boards with more elements than this show a performance notice (Req 17.6). */
export const LARGE_BOARD_ELEMENT_THRESHOLD = 5_000;

export interface LoaderFs<U> {
  stat(uri: U): Promise<{ size: number }>;
  readFile(uri: U): Promise<Uint8Array>;
}

export type InvalidReason =
  | { kind: 'tooLarge'; size: number; limit: number }
  | { kind: 'json'; line: number; column: number; message: string }
  | { kind: 'schema'; path: string; message: string };

export type LoadOutcome =
  | { ok: true; doc: BoardDocument; readOnly: boolean; rawText?: string; migratedFrom?: number }
  | { ok: false; reason: InvalidReason };

export function isTooLarge(size: number): boolean {
  return size > MAX_BOARD_FILE_BYTES;
}

/** Turns bytes into text (UTF-8, BOM stripped) and parses them. */
export function loadFromBytes(bytes: Uint8Array, parse: (text: string) => ParseResult): LoadOutcome {
  const text = new TextDecoder('utf-8').decode(bytes);
  const r = parse(text);
  if (!r.ok) {
    return r.kind === 'json'
      ? { ok: false, reason: { kind: 'json', line: r.line, column: r.column, message: r.message } }
      : { ok: false, reason: { kind: 'schema', path: r.path, message: r.message } };
  }
  const out: LoadOutcome = { ok: true, doc: r.doc, readOnly: r.readOnly };
  if (r.rawText !== undefined) out.rawText = r.rawText;
  if (r.migratedFrom !== undefined) out.migratedFrom = r.migratedFrom;
  return out;
}

/** Stats first (never reads an oversized file), then reads and parses. */
export async function loadBoard<U>(
  fs: LoaderFs<U>,
  uri: U,
  parse: (text: string) => ParseResult,
): Promise<LoadOutcome> {
  const { size } = await fs.stat(uri);
  if (isTooLarge(size)) return { ok: false, reason: { kind: 'tooLarge', size, limit: MAX_BOARD_FILE_BYTES } };
  return loadFromBytes(await fs.readFile(uri), parse);
}

export function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} bytes`;
}

/** Human-readable description of why a board cannot be shown (Req 2.9, 11.7, 16.7). */
export function describeInvalid(reason: InvalidReason): string {
  switch (reason.kind) {
    case 'tooLarge':
      return `This file is ${formatBytes(reason.size)} (${reason.size} bytes), which exceeds the 200 MB (${reason.limit} bytes) limit, so it was not opened in the board editor.`;
    case 'json':
      return `This file is invalid: it is not valid JSON (line ${reason.line}, column ${reason.column}): ${reason.message}`;
    case 'schema':
      return `This file is invalid: ${reason.message} at ${reason.path}`;
  }
}
