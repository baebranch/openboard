import { build, context } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const watch = process.argv.includes('--watch');

/** QuickJS sandbox (code mode): the emscripten loader is bundled; its .wasm is copied next to the bundles. */
const QUICKJS_DIR = 'node_modules/@jitl/quickjs-wasmfile-release-sync/dist';
const quickjsAlias = { '@jitl/quickjs-wasmfile-release-sync/emscripten-module': `./${QUICKJS_DIR}/emscripten-module.cjs` };
mkdirSync('dist', { recursive: true });
copyFileSync(`${QUICKJS_DIR}/emscripten-module.wasm`, 'dist/quickjs.wasm');
const minify = process.argv.includes('--minify');

/** Extension host bundle: Node, CommonJS, `vscode` provided by the host. */
const host = {
  entryPoints: ['src/host/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  alias: quickjsAlias,
  sourcemap: true,
  minify,
};

/** Webview bundle: browser, IIFE, no eval. */
const webview = {
  entryPoints: ['src/webview/main.tsx'],
  outfile: 'dist/webview.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  minify,
  jsx: 'automatic',
  // Imported CSS is emitted next to the script as dist/webview.css.
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development') },
  // Build-time standalone Ajv validators (no runtime eval); produced by scripts/build-schemas.mjs.
  alias: { 'openboard-validators': './dist/validators.js' },
};

if (existsSync(webview.entryPoints[0]) && !existsSync('dist/validators.js')) {
  execFileSync(process.execPath, ['scripts/build-schemas.mjs'], { stdio: 'inherit' });
}

/** MCP stdio server: Node, CommonJS, self-contained (the official SDK is bundled). */
const mcp = {
  entryPoints: ['src/mcp/main.ts'],
  outfile: 'dist/mcp.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  alias: quickjsAlias,
  sourcemap: true,
  minify,
  banner: { js: '#!/usr/bin/env node' },
};

// Build-time tool catalog and skill for the MCP server (tools/list and the docs work without any IDE window).
if (!watch || !existsSync('dist/mcp-tools.json') || !existsSync('dist/mcp-skill.json')) {
  execFileSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/gen-mcp-tools.ts'], { stdio: 'inherit' });
}

const configs = [host, webview, mcp].filter((c) => existsSync(c.entryPoints[0]));

if (watch) {
  for (const c of configs) {
    const ctx = await context(c);
    await ctx.watch();
  }
  console.log('watching...');
} else {
  for (const c of configs) await build(c);
  console.log(`built ${configs.length} bundle(s)`);
}
