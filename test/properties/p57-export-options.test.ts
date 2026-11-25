import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  EXPORT_FORMATS,
  EXPORT_MAX_PIXELS,
  EXPORT_SCALES,
  DEFAULT_EXPORT_OPTIONS,
  PADDING_RANGE_MESSAGE,
  checkLimits,
  computeOutputSize,
  resolvePadding,
  validateOptions,
  validatePadding,
  type ExportOptions,
} from '../../src/core/export/scope';
import type { Element } from '../../src/core/model/types';

// Feature: openboard, Property 57: Export options and limits
// **Validates: Requirements 12.5, 12.6, 12.12, 12.13**
describe('Feature: openboard, Property 57: Export options and limits', () => {
  const opts = { numRuns: 100 };
  const rect = (width: number, height: number): Element =>
    ({ id: 'e1', type: 'rectangle', x: 10, y: -20, width, height, rotation: 0 }) as unknown as Element;

  it('accepts exactly integers 0..256 as padding', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 256 }), (p) => {
        expect(validatePadding(p)).toBe(true);
        expect(resolvePadding(p, 7)).toEqual({ value: p });
      }),
      opts,
    );
    expect(DEFAULT_EXPORT_OPTIONS.padding).toBe(0);
  });

  it('rejects invalid padding, keeps the previous value, and reports the range', () => {
    const bad = fc.oneof(
      fc.integer({ min: -100000, max: -1 }),
      fc.integer({ min: 257, max: 100000 }),
      fc.double({ min: -300, max: 600, noNaN: true }).filter((n) => !Number.isInteger(n)),
      fc.constantFrom(NaN, Infinity, -Infinity),
      fc.string(),
      fc.constantFrom(null, undefined),
    );
    fc.assert(
      fc.property(bad, fc.integer({ min: 0, max: 256 }), (c, prev) => {
        expect(validatePadding(c)).toBe(false);
        const r = resolvePadding(c, prev);
        expect(r.value).toBe(prev);
        expect(r.error?.code).toBe('invalid-padding');
        expect(r.error?.message).toBe(PADDING_RANGE_MESSAGE);
        expect(r.error?.message).toContain('0');
        expect(r.error?.message).toContain('256');
      }),
      opts,
    );
  });

  it('validateOptions flags out-of-range padding and accepts in-range padding', () => {
    const base = (padding: number): ExportOptions => ({ ...DEFAULT_EXPORT_OPTIONS, padding });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 256 }), fc.oneof(fc.integer({ min: 257, max: 9999 }), fc.integer({ min: -9999, max: -1 })), (ok, bad) => {
        expect(validateOptions(base(ok))).toBeUndefined();
        expect(validateOptions(base(bad))?.code).toBe('invalid-padding');
      }),
      opts,
    );
  });

  it('validateOptions accepts all formats/scales for valid combinations', () => {
    fc.assert(
      fc.property(fc.constantFrom(...EXPORT_FORMATS), fc.constantFrom(...EXPORT_SCALES), (format, scale) => {
        expect(validateOptions({ ...DEFAULT_EXPORT_OPTIONS, format, scale })).toBeUndefined();
      }),
      opts,
    );
  });

  it('output size equals (bounds + 2*padding) * scale', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 256 }),
        fc.constantFrom(...EXPORT_SCALES),
        (w, h, p, s) => {
          expect(computeOutputSize({ width: w, height: h }, p, s)).toEqual({
            w: (w + 2 * p) * s,
            h: (h + 2 * p) * s,
          });
        },
      ),
      opts,
    );
  });

  it('checkLimits fails with size-limit iff either dimension exceeds 16,384', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }),
        fc.integer({ min: 1, max: 20000 }),
        fc.integer({ min: 0, max: 256 }),
        fc.constantFrom(...EXPORT_SCALES),
        (w, h, p, s) => {
          const r = checkLimits([rect(w, h)], p, s);
          const ow = (w + 2 * p) * s;
          const oh = (h + 2 * p) * s;
          if (ow > EXPORT_MAX_PIXELS || oh > EXPORT_MAX_PIXELS) {
            expect(r.ok).toBe(false);
            if (!r.ok) {
              expect(r.error.code).toBe('size-limit');
              expect(r.error.message).toContain('16,384');
            }
          } else {
            expect(r.ok).toBe(true);
            if (r.ok) expect({ w: r.value.w, h: r.value.h }).toEqual({ w: ow, h: oh });
          }
        },
      ),
      opts,
    );
  });

  it('boundary: exactly 16,384 passes, 16,385 fails', () => {
    expect(checkLimits([rect(16384, 10)], 0, 1).ok).toBe(true);
    const r = checkLimits([rect(16385, 10)], 0, 1);
    expect(r.ok).toBe(false);
  });

  it('empty scope aborts with an empty-scope error for any padding/scale', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 256 }), fc.constantFrom(...EXPORT_SCALES), (p, s) => {
        const r = checkLimits([], p, s);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.code).toBe('empty-scope');
          expect(r.error.message).toMatch(/nothing to export/i);
        }
      }),
      opts,
    );
  });
});
