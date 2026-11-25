import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveSetting,
  resolveSettings,
  SETTING_DESCRIPTORS,
  SETTING_KEYS,
  type SettingKey,
} from '../../src/core/settings';

// Feature: openboard, Property 61: Settings fall back to defaults
// **Validates: Requirements 18.3, 18.5**
describe('Feature: openboard, Property 61: Settings fall back to defaults', () => {
  const runs = { numRuns: 150 };
  const ctxArb = fc.record({ ideFontFamily: fc.oneof(fc.string({ maxLength: 150 }), fc.constant('Fira Code')) });
  const keyArb = fc.constantFrom(...SETTING_KEYS);
  const rawArb: fc.Arbitrary<unknown> = fc.oneof(
    fc.anything(),
    fc.constantFrom(undefined, null, NaN, Infinity, -Infinity, 0, -1, 1.5, 3, 4, 5, 1000, '', 'theme', 'white', 'transparent', 'horizontal', 'vertical', 'bogus'),
    fc.integer({ min: -50, max: 300 }),
    fc.string({ maxLength: 150 }),
  );

  it('valid values pass through, anything else yields the default', () => {
    fc.assert(
      fc.property(keyArb, rawArb, ctxArb, (key, raw, ctx) => {
        const d = SETTING_DESCRIPTORS[key] as { validate: (v: unknown) => boolean; getDefault: (c: typeof ctx) => unknown };
        const out = resolveSetting(key, raw, ctx);
        if (d.validate(raw)) expect(out).toBe(raw);
        else expect(out).toBe(d.getDefault(ctx));
        expect(d.validate(out)).toBe(true);
      }),
      runs,
    );
  });

  it('resolveSettings never writes back, reads only, and leaves input unmodified', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom(...SETTING_KEYS), rawArb), ctxArb, (store, ctx) => {
        const snapshot = Object.entries(store).map(([k, v]) => [k, v] as const);
        const reads: SettingKey[] = [];
        const reader = (k: SettingKey) => {
          reads.push(k);
          return (store as Record<string, unknown>)[k];
        };
        const out = resolveSettings(reader, ctx);
        for (const k of SETTING_KEYS) {
          expect(out[k]).toBe(resolveSetting(k, (store as Record<string, unknown>)[k], ctx));
        }
        expect(new Set(reads)).toEqual(new Set(SETTING_KEYS));
        expect(Object.keys(store).length).toBe(snapshot.length);
        for (const [k, v] of snapshot) expect(Object.is((store as Record<string, unknown>)[k], v)).toBe(true);
      }),
      runs,
    );
  });

  it('all-missing settings yield defaults', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const out = resolveSettings(() => undefined, ctx);
        for (const k of SETTING_KEYS) expect(out[k]).toBe(SETTING_DESCRIPTORS[k].getDefault(ctx));
      }),
      runs,
    );
  });
});
