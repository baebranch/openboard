import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BoardModel } from '../ops';
import type { BoardDocument } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerElementTools } from './element-tools';

const doc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

const TYPES = ['rectangle', 'frame', 'sticky'] as const;
const W = 100;
const H = 80;
const MAX = Math.min(W, H) / 2;

const okNum = fc.double({ min: 0, max: MAX, noNaN: true });
const badNum = fc.oneof(
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.double({ min: -1e6, max: -0.01, noNaN: true }),
  fc.double({ min: MAX + 0.5, max: 1e6, noNaN: true }),
  fc.string(),
);

const badRadii = fc.oneof(
  // non-array
  fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant({ 0: 1, length: 4 })),
  // wrong length
  fc
    .array(okNum, { maxLength: 8 })
    .filter((a) => a.length !== 4),
  // one invalid entry among valid ones
  fc.tuple(fc.integer({ min: 0, max: 3 }), badNum, fc.array(okNum, { minLength: 4, maxLength: 4 })).map(([i, b, a]) => {
    const c: unknown[] = [...a];
    c[i] = b;
    return c;
  }),
);

describe('Property 8: invalid corner radius always rejected', () => {
  /** Validates: Requirements 6.4, 6.5 */
  it('rejects invalid cornerRadii naming the property path and element type, leaving the document unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TYPES), badRadii, async (type, bad) => {
        const model = new BoardModel('/b.openboard', doc());
        const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
        registerElementTools(reg);
        const run = (n: string, i: unknown) => reg.invoke(n, i) as Promise<any>;
        await run('openboard.element.create', {
          elements: [{ type, id: 'e', width: W, height: H, cornerRadii: [1, 2, 3, 4] }],
        });
        const before = JSON.stringify(model.getDocument());
        const r = await run('openboard.element.update', { ids: ['e'], set: { cornerRadii: bad } });
        expect(r.error).toBeDefined();
        expect(r.error.message).toContain('style.cornerRadii');
        expect(r.error.message).toContain(type);
        expect(JSON.stringify(model.getDocument())).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});
