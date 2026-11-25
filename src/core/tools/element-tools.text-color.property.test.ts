import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BoardModel } from '../ops';
import type { BoardDocument, Element } from '../model/types';
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

const TYPES = ['text', 'sticky', 'flowNode'] as const;
const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => '#' + n.toString(16).padStart(6, '0'));
const textColor = fc.oneof(hex, fc.constant('theme:default'));

describe('Property 10: Text color and stroke color independence', () => {
  /** **Validates: Requirements 7.6, 7.7, 7.12** */
  it('setting textColor leaves stroke unchanged and setting stroke leaves textColor unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TYPES), hex, textColor, textColor, hex, async (type, stroke0, tc0, tc1, stroke1) => {
        const model = new BoardModel('/b.openboard', doc());
        const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
        registerElementTools(reg);
        const run = (n: string, i: unknown) => reg.invoke(n, i) as Promise<any>;
        const get = (): any => model.getDocument().elements[0] as Element;

        const c = await run('openboard.element.create', {
          elements: [{ type, id: 'e', stroke: stroke0, textColor: tc0 }],
        });
        expect(c.error).toBeUndefined();
        expect(get().style.stroke).toBe(stroke0);
        expect(get().textColor).toBe(tc0);

        const u1 = await run('openboard.element.update', { ids: ['e'], set: { textColor: tc1 } });
        expect(u1.error).toBeUndefined();
        expect(get().textColor).toBe(tc1);
        expect(get().style.stroke).toBe(stroke0);

        const u2 = await run('openboard.element.update', { ids: ['e'], set: { stroke: stroke1 } });
        expect(u2.error).toBeUndefined();
        expect(get().style.stroke).toBe(stroke1);
        expect(get().textColor).toBe(tc1);
      }),
      { numRuns: 100 },
    );
  });
});
