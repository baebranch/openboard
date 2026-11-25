import { build } from 'esbuild';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Requirement 23.2: the Icon_Set may add at most 150 KiB to a minified bundle.
const BUDGET_BYTES = 153_600;

describe('Icon_Set bundle budget', () => {
  it('stays within 153,600 bytes when bundled and minified', async () => {
    const result = await build({
      entryPoints: [resolve(__dirname, 'index.ts')],
      bundle: true,
      minify: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
    });
    const bytes = result.outputFiles[0]!.contents.byteLength;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES);
  });
});
