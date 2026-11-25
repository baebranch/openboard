/**
 * AtomicFileWriter: write to a temp file, then rename over the target.
 * The file system is injected so this module is testable without vscode.
 */

export class SaveFailed extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Save failed: ${msg}`);
    this.name = 'SaveFailed';
    this.cause = cause;
  }
}

/** Minimal file-system surface needed by the writer (U is the URI type). */
export interface AtomicFs<U> {
  writeFile(uri: U, bytes: Uint8Array): Promise<void>;
  rename(from: U, to: U, options: { overwrite: boolean }): Promise<void>;
  delete(uri: U): Promise<void>;
  /** Build a sibling temp URI for `target`, e.g. `<path>.openboard.<id>.tmp`. */
  tempUriFor(target: U, id: string): U;
}

export type IdGenerator = () => string;

const defaultId: IdGenerator = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export class AtomicFileWriter<U> {
  constructor(
    private readonly fs: AtomicFs<U>,
    private readonly newId: IdGenerator = defaultId,
  ) {}

  async write(uri: U, bytes: Uint8Array): Promise<void> {
    const tmp = this.fs.tempUriFor(uri, this.newId());
    try {
      await this.fs.writeFile(tmp, bytes);
      await this.fs.rename(tmp, uri, { overwrite: true });
    } catch (e) {
      await this.fs.delete(tmp).catch(() => undefined); // best effort
      throw new SaveFailed(e);
    }
  }
}

/** Structural subset of vscode.Uri / vscode.workspace.fs used by the adapter. */
interface UriLike {
  path: string;
  with(change: { path: string }): UriLike;
}

/** Adapter over vscode.workspace.fs (pass `vscode.workspace.fs`). */
export function vscodeAtomicFs<U extends UriLike>(wfs: unknown): AtomicFs<U> {
  const f = wfs as {
    writeFile(uri: U, bytes: Uint8Array): PromiseLike<void>;
    rename(from: U, to: U, options?: { overwrite?: boolean }): PromiseLike<void>;
    delete(uri: U): PromiseLike<void>;
  };
  return {
    writeFile: async (u, b) => { await f.writeFile(u, b); },
    rename: async (a, b, o) => { await f.rename(a, b, o); },
    delete: async (u) => { await f.delete(u); },
    tempUriFor: (t, id) => t.with({ path: `${t.path}.openboard.${id}.tmp` }) as U,
  };
}
