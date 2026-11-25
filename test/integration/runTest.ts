/**
 * Launches a real VS Code (downloaded once by @vscode/test-electron into .vscode-test/, which needs
 * network the first time) with this extension under development and runs the suite in
 * test/integration/suite inside the extension host. Built by scripts/build-integration.mjs into
 * out-int/; run with `npm run test:integration`.
 *
 * Env: OPENBOARD_VSCODE_VERSION (default "stable"), OPENBOARD_VSCODE_EXECUTABLE (use an installed
 * VS Code instead of downloading; then no network is needed at all).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'openboard-int-'));
  const userData = mkdtempSync(path.join(os.tmpdir(), 'openboard-int-user-'));
  try {
    await runTests({
      version: process.env.OPENBOARD_VSCODE_VERSION ?? 'stable',
      vscodeExecutablePath: process.env.OPENBOARD_VSCODE_EXECUTABLE || undefined,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, 'out-int', 'suite', 'index.js'),
      extensionTestsEnv: { OPENBOARD_INT_WORKSPACE: workspace },
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        `--user-data-dir=${userData}`,
      ],
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('Integration tests failed:', err);
  process.exit(1);
});
