import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { unionBounds } from '../../src/core/model/geometry';
import { COORD_RANGE, ZOOM_RANGE } from '../../src/core/model/ranges';
import type { Bounds, Viewport } from '../../src/core/model/types';
import { FIT_MARGIN, fitBounds, zoomToFit, zoomToSelection } from '../../src/core/viewport';

// Feature: openboard, Property 31: Fit viewport contains all content
// **Validates: Requirements 3.6, 3.7, 3.8, 3.9, 3.10**

const EPS = 1e-6;
const { min: Z_MIN, max: Z_MAX } = ZOOM_RANGE;

const boundsArb: fc.Arbitrary<Bounds> = fc
  .record({
    x: fc.double({ min: COORD_RANGE.min, max: COORD_RANGE.max, noNaN: true }),
    y: fc.double({ min: COORD_RANGE.min, max: COORD_RANGE.max, noNaN: true }),
    width: fc.double({ min: 1, max: 2_000_000, noNaN: true }),
    height: fc.double({ min: 1, max: 2_000_000, noNaN: true }),
  })
  .map((b) => ({ ...b }));

// Mix of small (fits at high zoom) and huge bounds (unfittable) per case.
const boundsListArb = fc.array(
  fc.oneof(
    boundsArb,
    fc.record({
      x: fc.double({ min: -1000, max: 1000, noNaN: true }),
      y: fc.double({ min: -1000, max: 1000, noNaN: true }),
      width: fc.double({ min: 1, max: 500, noNaN: true }),
      height: fc.double({ min: 1, max: 500, noNaN: true }),
    }),
  ),
  { minLength: 1, maxLength: 8 },
);

const screenArb = fc.record({
  width: fc.integer({ min: 100, max: 4000 }),
  height: fc.integer({ min: 100, max: 3000 }),
});

const viewportArb: fc.Arbitrary<Viewport> = fc.record({
  x: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
  y: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
  zoom: fc.double({ min: Z_MIN, max: Z_MAX, noNaN: true }),
});

function checkFit(result: Viewport, list: Bounds[], screen: { width: number; height: number }) {
  const u = unionBounds(list)!;
  const z = result.zoom;
  expect(z).toBeGreaterThanOrEqual(Z_MIN);
  expect(z).toBeLessThanOrEqual(Z_MAX);

  const left = u.x * z + result.x;
  const top = u.y * z + result.y;
  const right = (u.x + u.width) * z + result.x;
  const bottom = (u.y + u.height) * z + result.y;

  const fitsAtMin =
    u.width * Z_MIN <= screen.width - 2 * FIT_MARGIN && u.height * Z_MIN <= screen.height - 2 * FIT_MARGIN;

  if (fitsAtMin) {
    // All content visible with >= 32 px margin on every side.
    const tol = EPS * Math.max(1, Math.abs(left), Math.abs(right), Math.abs(top), Math.abs(bottom));
    expect(left).toBeGreaterThanOrEqual(FIT_MARGIN - tol);
    expect(top).toBeGreaterThanOrEqual(FIT_MARGIN - tol);
    expect(screen.width - right).toBeGreaterThanOrEqual(FIT_MARGIN - tol);
    expect(screen.height - bottom).toBeGreaterThanOrEqual(FIT_MARGIN - tol);
    // Highest zoom: either capped at 800% or a margin is tight on one axis.
    if (z < Z_MAX - EPS) {
      const slackW = screen.width - 2 * FIT_MARGIN - u.width * z;
      const slackH = screen.height - 2 * FIT_MARGIN - u.height * z;
      expect(Math.min(slackW, slackH)).toBeLessThanOrEqual(1e-4 * Math.max(1, screen.width, screen.height));
    }
  } else {
    // Unfittable: 2% zoom, centered on the combined bounds.
    expect(z).toBe(Z_MIN);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    expect(Math.abs(cx - screen.width / 2)).toBeLessThanOrEqual(1e-6 * Math.max(1, screen.width));
    expect(Math.abs(cy - screen.height / 2)).toBeLessThanOrEqual(1e-6 * Math.max(1, screen.height));
  }
}

describe('Feature: openboard, Property 31: Fit viewport contains all content', () => {
  it('zoomToFit shows all content with >= 32px margin at the highest zoom, or 2% centered', () => {
    fc.assert(
      fc.property(viewportArb, boundsListArb, screenArb, (v, list, screen) => {
        checkFit(zoomToFit(v, list, screen), list, screen);
      }),
      { numRuns: 200 },
    );
  });

  it('zoomToSelection behaves like fit for the selected bounds', () => {
    fc.assert(
      fc.property(viewportArb, boundsListArb, screenArb, (v, list, screen) => {
        const r = zoomToSelection(v, list, screen);
        checkFit(r, list, screen);
        expect(r).toEqual(zoomToFit(v, list, screen));
      }),
      { numRuns: 100 },
    );
  });

  it('fitBounds on a single bounds satisfies the same property', () => {
    fc.assert(
      fc.property(boundsArb, screenArb, (b, screen) => {
        checkFit(fitBounds(b, screen), [b], screen);
      }),
      { numRuns: 100 },
    );
  });

  it('empty set leaves the viewport unchanged', () => {
    fc.assert(
      fc.property(viewportArb, screenArb, (v, screen) => {
        expect(zoomToFit(v, [], screen)).toEqual(v);
        expect(zoomToSelection(v, [], screen)).toEqual(v);
      }),
      { numRuns: 100 },
    );
  });

  it('unfittable content gets exactly 2% zoom centered on the combined bounds', () => {
    fc.assert(
      fc.property(
        viewportArb,
        screenArb,
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (v, screen, x, y) => {
          // Wider than the screen can show at 2%.
          const width = (screen.width - 2 * FIT_MARGIN) / Z_MIN + 1000;
          const b: Bounds = { x, y, width, height: 10 };
          const r = zoomToFit(v, [b], screen);
          expect(r.zoom).toBe(Z_MIN);
          expect((x + width / 2) * r.zoom + r.x).toBeCloseTo(screen.width / 2, 6);
          expect((y + 5) * r.zoom + r.y).toBeCloseTo(screen.height / 2, 6);
        },
      ),
      { numRuns: 100 },
    );
  });
});
