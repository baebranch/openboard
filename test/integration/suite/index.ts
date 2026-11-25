/** Entry point loaded by VS Code inside the extension host (`extensionTestsPath`). */
import { runAll } from './harness';
import './extension.itest';

export function run(): Promise<void> {
  return runAll();
}
