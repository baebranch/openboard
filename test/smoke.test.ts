import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

describe('scaffold smoke test', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs fast-check', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
      { numRuns: 100 },
    );
  });
});
