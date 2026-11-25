/**
 * Tiny runner: bundles a TypeScript script with esbuild into a temp file, imports it and calls its
 * exported `main(args)`. Usage: node scripts/run-ts.mjs scripts/gen-manifest.ts [args...]
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error('usage: run-ts.mjs <script.ts> [args...]');
  process.exit(2);
}
const tmp = await mkdtemp(join(tmpdir(), 'openboard-run-'));
try {
  const out = join(tmp, 'script.mjs');
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    logLevel: 'silent',
    nodePaths: [join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  const mod = await import(pathToFileURL(out).href);
  process.exitCode = await mod.main(args);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
