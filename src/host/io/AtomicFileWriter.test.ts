import { describe, expect, it } from 'vitest';
import { AtomicFileWriter, SaveFailed, type AtomicFs } from './AtomicFileWriter';

function memFs(opts: { failWrite?: boolean; failRename?: boolean; failDelete?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const fs: AtomicFs<string> = {
    async writeFile(u, b) {
      if (opts.failWrite) throw new Error('disk full');
      files.set(u, b);
    },
    async rename(a, b) {
      if (opts.failRename) throw new Error('rename denied');
      files.set(b, files.get(a)!);
      files.delete(a);
    },
    async delete(u) {
      if (opts.failDelete) throw new Error('nope');
      files.delete(u);
    },
    tempUriFor: (t, id) => `${t}.openboard.${id}.tmp`,
  };
  return { files, fs };
}

describe('AtomicFileWriter', () => {
  it('writes via temp and overwrites the target, leaving no temp', async () => {
    const { files, fs } = memFs();
    files.set('a.openboard', new Uint8Array([9]));
    await new AtomicFileWriter(fs, () => 'x').write('a.openboard', new Uint8Array([1, 2]));
    expect([...files.keys()]).toEqual(['a.openboard']);
    expect([...files.get('a.openboard')!]).toEqual([1, 2]);
  });

  it('on rename failure deletes temp, keeps original, throws SaveFailed', async () => {
    const { files, fs } = memFs({ failRename: true });
    files.set('a.openboard', new Uint8Array([9]));
    await expect(new AtomicFileWriter(fs, () => 'x').write('a.openboard', new Uint8Array([1]))).rejects.toBeInstanceOf(SaveFailed);
    expect([...files.keys()]).toEqual(['a.openboard']);
    expect([...files.get('a.openboard')!]).toEqual([9]);
  });

  it('throws SaveFailed even when temp cleanup fails', async () => {
    const { fs } = memFs({ failWrite: true, failDelete: true });
    await expect(new AtomicFileWriter(fs).write('a', new Uint8Array())).rejects.toBeInstanceOf(SaveFailed);
  });
});
