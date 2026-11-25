import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZOOM_RANGE } from '../../src/core/model/ranges';
import { clampZoom, screenToBoard, zoomAround, zoomByFactor } from '../../src/core/viewport/viewport';

// Feature: openboard, Property 28: Zoom is clamped
// **Validates: Requirements 3.4, 3.5**

const zoomArb = fc.double({ min: ZOOM_RANGE.min, max: ZOOM_RANGE.max, noNaN: true });
const factorArb = fc.double({ min: 0.001, max: 1000, noNaN: true });
const coord = fc.double({ min: -5000, max: 5000, noNaN: true });
const viewportArb = fc.record({ x: coord, y: coord, zoom: zoomArb });
const pointArb = fc.record({ x: coord, y: coord });

describe('Feature: openboard, Property 28: Zoom is clamped', () => {
  it('result zoom is within [2%, 800%] for any zoom and factor', () => {
    fc.assert(
      fc.property(viewportArb, pointArb, factorArb, (v, p, f) => {
        const r = zoomByFactor(v, p, f);
        expect(r.zoom).toBeGreaterThanOrEqual(ZOOM_RANGE.min);
        expect(r.zoom).toBeLessThanOrEqual(ZOOM_RANGE.max);
      }),
      { numRuns: 200 },
    );
  });

  it('keeps the viewport center (pointer point) fixed, and clamping is idempotent', () => {
    fc.assert(
      fc.property(viewportArb, pointArb, factorArb, (v, p, f) => {
        const r = zoomByFactor(v, p, f);
        const before = screenToBoard(v, p);
        const after = screenToBoard(r, p);
        expect(after.x).toBeCloseTo(before.x, 4);
        expect(after.y).toBeCloseTo(before.y, 4);
        // Idempotent: re-applying the same request changes nothing.
        const again = zoomAround(r, p, v.zoom * f);
        expect(again.zoom).toBe(r.zoom);
        expect(clampZoom(clampZoom(v.zoom * f))).toBe(clampZoom(v.zoom * f));
      }),
      { numRuns: 200 },
    );
  });

  it('out-of-range requests clamp to the bounds', () => {
    fc.assert(
      fc.property(viewportArb, pointArb, fc.double({ min: 8.0001, max: 1e6, noNaN: true }), (v, p, big) => {
        expect(zoomAround(v, p, big).zoom).toBe(ZOOM_RANGE.max);
        expect(zoomAround(v, p, 1 / big / 1000).zoom).toBe(ZOOM_RANGE.min);
      }),
      { numRuns: 100 },
    );
  });
});
