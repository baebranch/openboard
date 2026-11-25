import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AtomicFileWriter, SaveFailed, type AtomicFs } from '../../src/host/io/AtomicFileWriter';

// Feature: openboard, Property 27: Atomic writes survive any failure
// **Validates: Requirements 15.10, 15.11, 11.16**

type Step = 'write' | 'rename' | 'delete';

class FakeFs implements AtomicFs<string> {
  readonly files = new Map<string, Uint8Array>();
  constructor(private readonly failAt: ReadonlySet<Step>, private readonly partialWrite: boolean) {}

  async writeFile(uri: string, bytes: Uint8Array): Promise<void> {
    if (this.failAt.has('write')) {
      // A failed write may leave a truncated temp file behind.
      if (this.partialWrite) this.files.set(uri, bytes.slice(0, Math.floor(bytes.length / 2)));
      throw new Error('write failed');
    }
    this.files.set(uri, bytes.slice());
  }
  async rename(from: string, to: string, options: { overwrite: boolean }): Promise<void> {
    if (this.failAt.has('rename')) throw new Error('rename failed');
    const data = this.files.get(from);
    if (!data) throw new Error('missing source');
    if (!options.overwrite && this.files.has(to)) throw new Error('exists');
    this.files.delete(from);
    this.files.set(to, data);
  }
  async delete(uri: string): Promise<void> {
    if (this.failAt.has('delete')) throw new Error('delete failed');
    this.files.delete(uri);
  }
  tempUriFor(target: string, id: string): string {
    return `${target}.openboard.${id}.tmp`;
  }
}

const bytesArb = fc.uint8Array({ maxLength: 64 });
const stepsArb = fc.subarray(['write', 'rename', 'delete'] as Step[]);

describe('Feature: openboard, Property 27: Atomic writes survive any failure', () => {
  it('original is untouched, SaveFailed thrown, no temp left (when delete works); success writes new bytes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(bytesArb, { nil: undefined }),
        bytesArb,
        stepsArb,
        fc.boolean(),
        async (original, next, failSteps, partial) => {
          const target = 'file.openboard';
          const fail = new Set<Step>(failSteps);
          const fs = new FakeFs(fail, partial);
          if (original) fs.files.set(target, original.slice());
          const writer = new AtomicFileWriter(fs, () => 'id1');

          const mustFail = fail.has('write') || fail.has('rename');
          let thrown: unknown;
          try {
            await writer.write(target, next);
          } catch (e) {
            thrown = e;
          }
          const temps = [...fs.files.keys()].filter((k) => k !== target);

          if (mustFail) {
            expect(thrown).toBeInstanceOf(SaveFailed);
            const now = fs.files.get(target);
            if (original) expect(Array.from(now ?? [])).toEqual(Array.from(original));
            else expect(now).toBeUndefined();
            if (!fail.has('delete')) expect(temps).toEqual([]);
          } else {
            expect(thrown).toBeUndefined();
            expect(Array.from(fs.files.get(target) ?? [])).toEqual(Array.from(next));
            expect(temps).toEqual([]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
