import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readFcEnv } from '../helpers/fast-check-setup';

describe('property-test failure reporting', () => {
  it('reports the seed, path and shrunk counterexample of a failing property', () => {
    let message = '';
    try {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (n) => n < 10),
        { seed: 42, numRuns: 200 },
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('seed: 42');
    expect(message).toMatch(/path: "/);
    expect(message).toContain('Counterexample: [10]');
  });

  it('reads numRuns and seed from environment variables', () => {
    const p = readFcEnv({ OPENBOARD_FC_NUM_RUNS: '500', OPENBOARD_FC_SEED: '7' });
    expect(p.numRuns).toBe(500);
    expect(p.seed).toBe(7);
    const d = readFcEnv({});
    expect(d.numRuns).toBeUndefined();
    expect(d.seed).toBeUndefined();
  });
});
