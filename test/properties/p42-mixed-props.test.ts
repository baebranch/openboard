import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { summarizeProperty } from '../../src/core/properties';
import { buildFullRegistry } from '../helpers/registry';

const RUNS = { numRuns: 100 };

// Integer values avoid 2-decimal rounding differences.
const values = fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 8 });
const keys = fc.constantFrom('x', 'y', 'width', 'height', 'rotation', 'opacity', 'strokeWidth');

const elementsFor = (key: string, vals: number[]) =>
  vals.map((v, i) => {
    const base: Record<string, unknown> = { type: 'rectangle', id: `r${i}`, x: 0, y: 0, width: 50, height: 50 };
    base[key] = Math.max(v, key === 'width' || key === 'height' ? 1 : 0);
    return base;
  });

// Feature: openboard, Property 42: Mixed property display and bulk apply
describe('Feature: openboard, Property 42: Mixed property display and bulk apply', () => {
  it('summarizeProperty is mixed iff values differ, else the common value', () => {
    // **Validates: Requirements 6.8**
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 8 }), (vals) => {
        const els = vals.map((v) => ({ style: { opacity: v } }));
        const s = summarizeProperty(els, 'opacity');
        const distinct = new Set(vals).size;
        expect(s.mixed).toBe(distinct > 1);
        if (distinct === 1) expect(s.value).toBe(vals[0]);
        else expect(s.value).toBeUndefined();
      }),
      RUNS,
    );
  });

  it('bulk update applies a single value to every selected element, then not mixed', async () => {
    // **Validates: Requirements 6.8**
    await fc.assert(
      fc.asyncProperty(keys, values, fc.integer({ min: 1, max: 100 }), async (key, vals, target) => {
        const f = buildFullRegistry({ spy: false });
        const created = (await f.registry.invoke('openboard.element.create', {
          elements: elementsFor(key, vals),
        })) as any;
        expect(created.error).toBeUndefined();
        const ids = vals.map((_, i) => `r${i}`);
        const select = () => f.model.getDocument().elements.filter((e) => ids.includes(e.id));
        expect(select()).toHaveLength(vals.length);
        const normalized = elementsFor(key, vals).map((e) => e[key]);
        expect(summarizeProperty(select(), key).mixed).toBe(new Set(normalized).size > 1);

        const r = (await f.registry.invoke('openboard.element.update', { ids, set: { [key]: target } })) as any;
        expect(r.error).toBeUndefined();
        const after = select();
        const summary = summarizeProperty(after, key);
        expect(summary.mixed).toBe(false);
        expect(summary.value).toBe(target);
      }),
      RUNS,
    );
  });
});
