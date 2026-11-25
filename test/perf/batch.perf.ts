/** Batch of 1,000 Element creations via openboard.batch (Req 17.4, 17.7). */
import { describe, expect, it } from 'vitest';
import { buildFullRegistry } from '../helpers/registry';
import { BUDGETS, report, time } from './harness';

/** One batch: 500 operations (the batch maximum) x 2 elements each = 1,000 creations. */
function batchInput() {
  const operations = Array.from({ length: 500 }, (_, i) => ({
    tool: 'openboard.element.create',
    input: {
      elements: [
        { type: 'rectangle', x: (i % 25) * 120, y: Math.floor(i / 25) * 120, width: 100, height: 80 },
        { type: 'sticky', x: (i % 25) * 120, y: Math.floor(i / 25) * 120 + 2400, width: 100, height: 80, text: `n${i}` },
      ],
    },
  }));
  return { operations };
}

describe('openboard.batch creating 1,000 Elements', () => {
  it('completes within the 5 s target (median of 5)', async () => {
    const input = batchInput();
    const runs = await time(5, async () => {
      const { registry, model } = buildFullRegistry({ spy: false });
      const out = (await registry.invoke('openboard.batch', input)) as { ok: boolean; exceededTimeTarget?: boolean };
      expect(out.ok).toBe(true);
      expect(model.getDocument().elements).toHaveLength(1000);
    });
    const m = report('batch 1000 element creations', '17.4', runs, BUDGETS.batch1000Ms);
    expect(m.pass).toBe(true);
  });
});
