/**
 * ExternalChangeHandler: reacts to on-disk changes of an open board (Req 2.7, 2.8, 15.4-15.6).
 * Pure logic; every side effect is injected so it is testable without vscode.
 */
import { sha256Hex } from '../../core/format/sha256';
import type { Viewport } from '../../core/model/types';
import type { LoadOutcome } from '../editor/loader';

export const CHOICE_KEEP_LOCAL = 'Keep local';
export const CHOICE_LOAD_DISK = 'Load disk version';
export const CHOICE_COMPARE = 'Compare as JSON text';
export const CONFLICT_CHOICES = [CHOICE_KEEP_LOCAL, CHOICE_LOAD_DISK, CHOICE_COMPARE] as const;
export type ConflictChoice = (typeof CONFLICT_CHOICES)[number];

export const CONFLICT_MESSAGE =
  'This board was changed on disk, but you have unsaved edits. Which version do you want to keep?';

/** Maximum time to show an external change in the editor when there are no local edits (Req 2.7). */
export const RELOAD_DEADLINE_MS = 2000;

export interface WriteFingerprint {
  size: number;
  hash: string;
}

/** Remembers the size and content hash of the last bytes this extension wrote, per file. */
export class OwnWriteRegistry {
  private readonly writes = new Map<string, WriteFingerprint>();

  constructor(private readonly hash: (bytes: Uint8Array) => string = sha256Hex) {}

  /** Call before the write starts: watcher events can arrive before the write promise settles. */
  recordOwnWrite(key: string, bytes: Uint8Array): void {
    this.writes.set(key, { size: bytes.length, hash: this.hash(bytes) });
  }

  /** True if `bytes` equals what we last wrote to `key`. */
  isOwnWrite(key: string, bytes: Uint8Array): boolean {
    const w = this.writes.get(key);
    return !!w && w.size === bytes.length && w.hash === this.hash(bytes);
  }

  forget(key: string): void {
    this.writes.delete(key);
  }
}

export interface ExternalChangeDeps {
  readFile(): Promise<Uint8Array>;
  hash(bytes: Uint8Array): string;
  parse(bytes: Uint8Array): LoadOutcome;
  /** True while the document has unsaved edits. */
  isDirty(): boolean;
  /** True if `bytes` is what this extension last wrote to the file. */
  isOwnWrite(bytes: Uint8Array): boolean;
  /** Called when our own-write fingerprint no longer matches the disk (a real external change). */
  forgetOwnWrite(): void;
  getViewport(): Viewport | undefined;
  /** Replaces the model content and sends `reset` to every session; false if it was refused. */
  applyDisk(outcome: Extract<LoadOutcome, { ok: true }>): boolean;
  showPrompt(message: string, choices: readonly ConflictChoice[]): Promise<ConflictChoice | undefined>;
  openDiff(): Promise<void>;
  now(): number;
  warn(message: string): void;
}

export type ExternalChangeResult =
  | { kind: 'ignored-own-write' }
  | { kind: 'ignored-duplicate' }
  | { kind: 'reloaded'; elapsedMs: number }
  | { kind: 'unreadable'; message: string }
  | { kind: 'invalid-on-disk' }
  | { kind: 'conflict'; choice: 'keep-local' | 'load-disk' | 'dismissed' | 'load-failed' };

export class ExternalChangeHandler {
  private prompting = false;
  private declinedHash: string | undefined;

  constructor(private readonly deps: ExternalChangeDeps) {}

  /** Handle one FileSystemWatcher change/create event for the board. */
  async handleChange(): Promise<ExternalChangeResult> {
    const d = this.deps;
    if (this.prompting) return { kind: 'ignored-duplicate' };
    const start = d.now();
    let bytes: Uint8Array;
    try {
      bytes = await d.readFile();
    } catch (e) {
      return { kind: 'unreadable', message: e instanceof Error ? e.message : String(e) };
    }
    if (d.isOwnWrite(bytes)) return { kind: 'ignored-own-write' };
    d.forgetOwnWrite();

    if (!d.isDirty()) {
      this.declinedHash = undefined;
      const r = this.reload(bytes);
      if (r !== 'ok') return { kind: 'invalid-on-disk' };
      return { kind: 'reloaded', elapsedMs: d.now() - start };
    }

    const hash = d.hash(bytes);
    if (hash === this.declinedHash) return { kind: 'ignored-duplicate' };
    return this.conflict(hash);
  }

  private reload(bytes: Uint8Array): 'ok' | 'fail' {
    const d = this.deps;
    const outcome = d.parse(bytes);
    if (!outcome.ok) {
      d.warn('Ignored external change: the file on disk is not a valid board');
      return 'fail';
    }
    const viewport = d.getViewport();
    const doc = viewport ? { ...outcome.doc, viewport } : outcome.doc;
    if (!d.applyDisk({ ...outcome, doc })) {
      d.warn('Ignored external change: the document could not be updated');
      return 'fail';
    }
    return 'ok';
  }

  private async conflict(hash: string): Promise<ExternalChangeResult> {
    const d = this.deps;
    this.prompting = true;
    try {
      for (;;) {
        const choice = await d.showPrompt(CONFLICT_MESSAGE, CONFLICT_CHOICES);
        if (choice === CHOICE_COMPARE) {
          await d.openDiff();
          continue; // local document is untouched; ask again
        }
        if (choice === CHOICE_LOAD_DISK) {
          try {
            return this.reload(await d.readFile()) === 'ok'
              ? { kind: 'conflict', choice: 'load-disk' }
              : { kind: 'conflict', choice: 'load-failed' };
          } catch (e) {
            d.warn(`Could not read the disk version: ${e instanceof Error ? e.message : String(e)}`);
            return { kind: 'conflict', choice: 'load-failed' };
          }
        }
        this.declinedHash = hash;
        return { kind: 'conflict', choice: choice === CHOICE_KEEP_LOCAL ? 'keep-local' : 'dismissed' };
      }
    } finally {
      this.prompting = false;
    }
  }
}
