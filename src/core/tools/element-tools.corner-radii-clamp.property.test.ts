import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BoardModel } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerElementTools } from './element-tools';
import { buildCornerCommit } from '../../webview/properties/model';

const doc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

const TYPES = ['rectangle', 'frame', 'sticky'] as const;
const dim = fc.integer({ min: 20, max: 400 });
const frac = fc.double({ min: 0, max: 1, noNaN: true });

function setup() {
  const model = new BoardModel('/b.openboard', doc());
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerElementTools(reg);
  const run = (n: string, i: unknown) => reg.invoke(n, i) as Promise<any>;
  const get = (): Element => model.getDocument().elements[0] as Element;
  return { run, get };
}

describe('Property 7: Corner radius clamp and independence', () => {
  /** **Validates: Requirements 6.9, 6.11, 6.12** */
  it('keeps every radius within [0, max(newW, newH)] after a resize', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TYPES),
        dim,
        dim,
        fc.tuple(frac, frac, frac, frac),
        dim,
        dim,
        async (type, w, h, fr, nw, nh) => {
          const { run, get } = setup();
          const max = Math.min(w, h) / 2;
          const radii = fr.map((f) => f * max);
          const c = await run('openboard.element.create', {
            elements: [{ type, id: 'e', width: w, height: h, cornerRadii: radii }],
          });
          expect(c.error).toBeUndefined();
          const u = await run('openboard.element.update', { ids: ['e'], set: { width: nw, height: nh } });
          expect(u.error).toBeUndefined();
          const el = get();
          const newMax = Math.min(nw, nh) / 2;
          const out = (el.style as { cornerRadii?: number[] }).cornerRadii!;
          expect(out).toHaveLength(4);
          for (const r of out) {
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThanOrEqual(newMax);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('changing one corner leaves the other three unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TYPES),
        dim,
        dim,
        fc.tuple(frac, frac, frac, frac),
        fc.constantFrom(0, 1, 2, 3 as const),
        frac,
        async (type, w, h, fr, slot, nf) => {
          const { run, get } = setup();
          const max = Math.min(w, h) / 2;
          const radii = fr.map((f) => f * max);
          await run('openboard.element.create', {
            elements: [{ type, id: 'e', width: w, height: h, cornerRadii: radii }],
          });
          const value = Math.round(nf * max * 100) / 100;
          const commit = buildCornerCommit([get()], slot as 0 | 1 | 2 | 3, String(value));
          expect(commit.ok).toBe(true);
          if (!commit.ok) return;
          const r = await run(commit.op.tool, commit.op.input);
          expect(r.error).toBeUndefined();
          const out = (get().style as { cornerRadii?: number[] }).cornerRadii!;
          expect(out[slot]).toBe(value);
          for (let i = 0; i < 4; i++) if (i !== slot) expect(out[i]).toBe(radii[i]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
