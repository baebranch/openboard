import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Requirement 23.2: the Icon_Set adds at most 150 KB to the built extension bundle. */
const ICON_SET_BUDGET_BYTES = 153_600;

// Requirements 23.2
describe('Icon_Set bundle size budget', () => {
  it('stays within 153,600 bytes when bundled and minified on its own', async () => {
    const entry = fileURLToPath(new URL('./index.ts', import.meta.url));
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'silent',
    });
    expect(result.outputFiles).toHaveLength(1);
    // The module alone is an upper bound on its contribution to any larger bundle.
    const bytes = result.outputFiles[0]!.contents.byteLength;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(ICON_SET_BUDGET_BYTES);
  });
});
