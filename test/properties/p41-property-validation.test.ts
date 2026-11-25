import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Element } from '../../src/core/model/types';
import { PROPERTY_DESCRIPTORS, validateProperty } from '../../src/core/properties';
import { buildFullRegistry } from '../helpers/registry';

const RUNS = { numRuns: 100 };
const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Values that are never valid for any numeric property. */
const nonNumeric = fc.oneof(
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.string(),
  fc.constantFrom('abc', '12', '', 'NaN', '1e3'),
  fc.constant(null),
  fc.boolean(),
);

async function setup(extra: Record<string, unknown>[] = []) {
  const f = buildFullRegistry({ spy: false });
  const created = (await f.registry.invoke('openboard.element.create', {
    elements: [{ type: 'rectangle', id: 'r', x: 10, y: 20, width: 80, height: 60 }, ...extra],
  })) as any;
  expect(created.error).toBeUndefined();
  const update = (id: string, set: Record<string, unknown>) =>
    f.registry.invoke('openboard.element.update', { ids: [id], set }) as Promise<any>;
  const get = (id: string) => f.model.getDocument().elements.find((e) => e.id === id) as Element & Record<string, any>;
  return { f, update, get };
}

// Feature: openboard, Property 41: Property validation
describe('Feature: openboard, Property 41: Property validation', () => {
  it('x/y inside range are applied rounded to 2 decimals', async () => {
    // **Validates: Requirements 6.6, 6.7, 9.7**
    const { update, get } = await setup();
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('x', 'y'), finite(-1_000_000, 1_000_000), async (key, v) => {
        const r = await update('r', { [key]: v });
        expect(r.error).toBeUndefined();
        expect(get('r')[key]).toBe(round2(v));
        const d = validateProperty('rectangle', key, v);
        expect(d).toEqual({ ok: true, value: round2(v) });
      }),
      RUNS,
    );
  });

  it('width/height >= 1 are applied rounded; below 1 rejected with previous value retained', async () => {
    // **Validates: Requirements 6.6, 6.7, 9.7**
    const { update, get, f } = await setup();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('width', 'height'),
        finite(1, 100_000),
        finite(-1000, 0.999),
        async (key, good, bad) => {
          const r = await update('r', { [key]: good });
          expect(r.error).toBeUndefined();
          expect(get('r')[key]).toBe(round2(good));
          expect(get('r')[key]).toBeGreaterThanOrEqual(1);
          const before = f.model.getDocument();
          const rb = await update('r', { [key]: bad });
          expect(rb.error?.code).toBe('invalid_property');
          expect(f.model.getDocument()).toBe(before);
        },
      ),
      RUNS,
    );
  });

  it('out-of-range numbers are rejected and the document is unchanged', async () => {
    // **Validates: Requirements 6.9, 9.8**
    const { update, f } = await setup();
    const outside = fc.oneof(
      fc.tuple(fc.constantFrom('x', 'y'), fc.oneof(finite(1_000_000.01, 1e9), finite(-1e9, -1_000_000.01))),
      fc.tuple(fc.constant('rotation'), fc.oneof(finite(360.01, 1e6), finite(-1e6, -360.01))),
      fc.tuple(fc.constant('strokeWidth'), fc.oneof(finite(100.01, 1e6), finite(-1e6, -0.01))),
      fc.tuple(fc.constant('opacity'), fc.oneof(finite(100.01, 1e6), finite(-1e6, -0.01))),
    );
    await fc.assert(
      fc.asyncProperty(outside, async ([key, v]) => {
        const before = f.model.getDocument();
        const r = await update('r', { [key]: v });
        expect(r.error?.code).toBe('invalid_property');
        expect(typeof r.error.message).toBe('string');
        expect(f.model.getDocument()).toBe(before);
        expect(validateProperty('rectangle', key, v).ok).toBe(false);
      }),
      RUNS,
    );
  });

  it('NaN, infinities and non-numeric values are rejected for every numeric property', async () => {
    // **Validates: Requirements 6.9, 9.8**
    const { update, f } = await setup();
    const numericKeys = Object.values(PROPERTY_DESCRIPTORS)
      .filter((d) => d.kind === 'number' && !d.appliesTo)
      .map((d) => d.name);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...numericKeys), nonNumeric, async (key, v) => {
        const before = f.model.getDocument();
        const r = await update('r', { [key]: v });
        expect(r.error?.code).toBe('invalid_property');
        expect(f.model.getDocument()).toBe(before);
        expect(validateProperty('rectangle', key, v, { width: 80, height: 60 }).ok).toBe(false);
      }),
      RUNS,
    );
  });

  it('in-range rotation, strokeWidth and opacity are applied', async () => {
    // **Validates: Requirements 6.6, 6.7**
    const { update, get } = await setup();
    await fc.assert(
      fc.asyncProperty(finite(-360, 360), finite(0, 100), finite(0, 100), async (rot, sw, op) => {
        const r = await update('r', { rotation: rot, strokeWidth: sw, opacity: op });
        expect(r.error).toBeUndefined();
        expect(get('r').rotation).toBe(rot);
        expect(get('r').style.strokeWidth).toBe(sw);
        expect(get('r').style.opacity).toBe(op);
      }),
      RUNS,
    );
  });

  it('corner radius is bounded by half of the shorter side', async () => {
    // **Validates: Requirements 6.6, 6.7, 6.9**
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 500, noNaN: true, noDefaultInfinity: true }),
        async (w, h, frac, extra) => {
          const { update, get, f } = await setup();
          await update('r', { width: w, height: h });
          const max = Math.min(w, h) / 2;
          const ok = await update('r', { cornerRadius: max * frac });
          expect(ok.error).toBeUndefined();
          expect(get('r').style.cornerRadius).toBe(max * frac);
          const before = f.model.getDocument();
          const bad = await update('r', { cornerRadius: max + extra });
          expect(bad.error?.code).toBe('invalid_property');
          expect(f.model.getDocument()).toBe(before);
          expect(validateProperty('rectangle', 'cornerRadius', max + extra, { width: w, height: h }).ok).toBe(false);
          expect(validateProperty('rectangle', 'cornerRadius', max, { width: w, height: h }).ok).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it('freehand width is 1-100 and opacity is 0-100', async () => {
    // **Validates: Requirements 9.7, 9.8**
    const { update, get, f } = await setup([
      { type: 'freehand', id: 'p', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    ]);
    await fc.assert(
      fc.asyncProperty(
        finite(1, 100),
        finite(0, 100),
        fc.oneof(finite(-1000, 0.99), finite(100.01, 1000), nonNumeric),
        fc.oneof(finite(-1000, -0.01), finite(100.01, 1000), nonNumeric),
        async (w, op, badW, badOp) => {
          const ok = await update('p', { baseWidth: w, opacity: op });
          expect(ok.error).toBeUndefined();
          expect(get('p').baseWidth).toBe(w);
          expect(get('p').style.opacity).toBe(op);
          const before = f.model.getDocument();
          for (const set of [{ baseWidth: badW }, { opacity: badOp }]) {
            const r = await update('p', set);
            expect(r.error?.code).toBe('invalid_property');
            expect(f.model.getDocument()).toBe(before);
          }
        },
      ),
      RUNS,
    );
  });
});
