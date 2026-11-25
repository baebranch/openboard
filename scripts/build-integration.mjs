// Bundles the VS Code integration test runner and suite into out-int/ (CommonJS, node).
// `vscode` is provided by the extension host; @vscode/test-electron stays a runtime dependency.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  external: ['vscode', '@vscode/test-electron'],
  logLevel: 'warning',
};

await build({ ...common, entryPoints: ['test/integration/runTest.ts'], outfile: 'out-int/runTest.js' });
await build({ ...common, entryPoints: ['test/integration/suite/index.ts'], outfile: 'out-int/suite/index.js' });
console.log('built out-int/');
