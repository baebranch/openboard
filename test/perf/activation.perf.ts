/**
 * Activation-cost proxy (Req 1.7). No fake vscode exists, so this times what activation does
 * without the IDE: importing the composition module and constructing the full tool registry.
 * This file must not import registry-setup statically so the first import measures a cold load.
 */
import { describe, expect, it } from 'vitest';
import { BUDGETS, report, time } from './harness';

describe('activation proxy', () => {
  it('imports and constructs the tool registry within 2000 ms', async () => {
    const t0 = performance.now();
    const { createRegistry } = await import('../../src/host/agent/registry-setup');
    const importMs = performance.now() - t0;
    const boardHost = {
      isOpen: () => undefined,
      exists: () => false,
      openInBackground: () => {
        throw new Error('unused');
      },
      activeBoard: () => undefined,
      openBoards: () => [],
      isWorkspaceTrusted: () => true,
    };
    const exportHost = { rasterize: async () => new Uint8Array(), writeFile: async () => undefined };
    const runs = await time(10, () => {
      const r = createRegistry({ boardHost, exportHost });
      expect(r.list().length).toBeGreaterThan(10);
    });
    // Cold activation proxy = cold import + first construction; reported as the median of constructions plus import.
    const total = runs.map((r) => r + importMs);
    const m = report('activation proxy (import + registry build)', '1.7', total, BUDGETS.activationMs, `cold import ${importMs.toFixed(1)} ms; excludes vscode API and provider registration`);
    expect(m.pass).toBe(true);
  });
});
