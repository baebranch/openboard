/**
 * Build-time schema pipeline (no runtime eval, no runtime schema compilation):
 *  1. Bundle src/core/schema (TS) and evaluate it to obtain the JSON Schemas.
 *  2. Write src/core/schema/board.schema.json (registered via `jsonValidation`).
 *  3. Compile standalone Ajv validators and bundle them (with Ajv runtime helpers
 *     inlined) into dist/validators.js.
 */
import { build } from 'esbuild';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Optional output dir (argv[2]): build validators there and leave the repo untouched.
const outDir = process.argv[2];
const tmp = await mkdtemp(join(tmpdir(), 'openboard-schema-'));

try {
  // 1. Evaluate the TS schema builders.
  const builderOut = join(tmp, 'schema.mjs');
  await build({
    entryPoints: [join(root, 'src/core/schema/index.ts')],
    outfile: builderOut,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(builderOut).href);

  const boardSchema = mod.buildBoardSchema();
  const validators = { validateBoard: boardSchema };
  // Additional schemas (tool input/output, host messages) register here via `extraSchemas`.
  if (typeof mod.buildExtraSchemas === 'function') Object.assign(validators, mod.buildExtraSchemas());

  // 2. Publish the JSON Schema file.
  if (!outDir) {
    await writeFile(
      join(root, 'src/core/schema/board.schema.json'),
      JSON.stringify(boardSchema, null, 2) + '\n',
    );
  }

  // 3. Standalone validators.
  const ajv = new Ajv({
    allErrors: false,
    strict: true,
    discriminator: true,
    code: { source: true, esm: false },
  });
  const refs = {};
  for (const [name, schema] of Object.entries(validators)) {
    ajv.addSchema(schema, name);
    refs[name] = name;
  }
  const code = standaloneCode(ajv, refs);
  const generated = join(tmp, 'validators.cjs');
  await writeFile(generated, code);

  const distDir = outDir ? resolve(outDir) : join(root, 'dist');
  await mkdir(distDir, { recursive: true });
  await build({
    entryPoints: [generated],
    outfile: join(distDir, 'validators.js'),
    bundle: true,
    platform: 'neutral',
    format: 'cjs',
    target: 'es2022',
    nodePaths: [join(root, 'node_modules')],
    logLevel: 'silent',
  });
  console.log(`built validators: ${Object.keys(refs).join(', ')}`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
