import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  BUILTIN_PALETTES,
  THEME_CSS_VARIABLES,
  THEME_DEFAULT_COLOR,
  THEME_KINDS,
  contrastRatio,
  pickContrastColor,
  resolveElementColor,
  resolvePalette,
} from '../../src/core/theme';

// Feature: openboard, Property 55: Theme colors
// **Validates: Requirements 4.4, 4.5, 4.9**
describe('Feature: openboard, Property 55: Theme colors', () => {
  const kindArb = fc.constantFrom(...THEME_KINDS);
  const hexArb = fc
    .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
    .map(([r, g, b]) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''));
  const rgbaArb = fc
    .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 100 }))
    .map(([r, g, b, a]) => `rgba(${r}, ${g}, ${b}, ${a / 100})`);
  const anyValueArb = fc.oneof(
    hexArb,
    rgbaArb,
    fc.string(),
    fc.constant(''),
    fc.constant('   '),
    fc.constant(undefined),
    fc.constant(null),
  );
  const varNames = Object.values(THEME_CSS_VARIABLES);
  const keys = Object.keys(THEME_CSS_VARIABLES) as (keyof typeof THEME_CSS_VARIABLES)[];

  it('default stroke/text keep >= 4.5:1 contrast against the background for any theme and variables', () => {
    fc.assert(
      fc.property(kindArb, fc.array(anyValueArb, { minLength: varNames.length, maxLength: varNames.length }), (kind, values) => {
        const map = new Map(varNames.map((n, i) => [n, values[i]]));
        const p = resolvePalette(kind, (n) => map.get(n));
        expect(contrastRatio(p.defaultStroke, p.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.defaultText, p.background)).toBeGreaterThanOrEqual(4.5);
      }),
      { numRuns: 100 },
    );
  });

  it('pickContrastColor reaches 4.5:1 for any background and candidates', () => {
    fc.assert(
      fc.property(fc.oneof(hexArb, rgbaArb), fc.array(fc.oneof(hexArb, fc.string()), { maxLength: 4 }), (bg, cands) => {
        const c = pickContrastColor(bg, cands);
        expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(4.5);
      }),
      { numRuns: 100 },
    );
  });

  it('missing or empty variables fall back to built-ins and never throw', () => {
    fc.assert(
      fc.property(
        kindArb,
        fc.array(fc.option(hexArb, { nil: undefined }), { minLength: keys.length, maxLength: keys.length }),
        fc.constantFrom('', '  ', undefined as string | undefined, null as string | null),
        (kind, present, missing) => {
          const vals = new Map<string, string | null | undefined>();
          keys.forEach((k, i) => vals.set(THEME_CSS_VARIABLES[k], present[i] ?? missing));
          const p = resolvePalette(kind, (n) => vals.get(n));
          keys.forEach((k, i) => {
            const expected = present[i] ?? BUILTIN_PALETTES[kind][k];
            expect(p[k]).toBe(expected);
          });
          // throwing reader also yields built-ins
          const q = resolvePalette(kind, () => {
            throw new Error('boom');
          });
          keys.forEach((k) => expect(q[k]).toBe(BUILTIN_PALETTES[kind][k]));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('theme:default follows the theme kind; explicit colors are unchanged', () => {
    fc.assert(
      fc.property(kindArb, kindArb, fc.oneof(hexArb, rgbaArb, fc.string()), (k1, k2, explicit) => {
        fc.pre(explicit !== THEME_DEFAULT_COLOR);
        const p1 = resolvePalette(k1);
        const p2 = resolvePalette(k2);
        for (const role of ['stroke', 'text'] as const) {
          expect(resolveElementColor(THEME_DEFAULT_COLOR, p1, role)).toBe(role === 'text' ? p1.defaultText : p1.defaultStroke);
          expect(resolveElementColor(THEME_DEFAULT_COLOR, p2, role)).toBe(role === 'text' ? p2.defaultText : p2.defaultStroke);
          expect(resolveElementColor(explicit, p1, role)).toBe(explicit);
          expect(resolveElementColor(explicit, p2, role)).toBe(explicit);
        }
      }),
      { numRuns: 100 },
    );
  });
});
