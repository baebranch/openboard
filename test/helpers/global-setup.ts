/**
 * Vitest global setup: runs once in the main process, before any test file.
 *
 * Builds dist/validators.js, which the extension-host tests load the same way the extension does
 * (test/host/extension.test.ts). dist/ is not committed, so a fresh clone (or CI) has none, and an
 * existing copy may be stale after a schema change; building here makes `npm test` self-contained.
 * Passing an output directory makes the script write only the validators, leaving the committed
 * src/core/schema/board.schema.json untouched.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default function setup(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  execFileSync(process.execPath, [path.join(root, 'scripts/build-schemas.mjs'), path.join(root, 'dist')], {
    cwd: root,
    stdio: 'pipe',
  });
}
