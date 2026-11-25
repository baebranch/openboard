import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COORD_RANGE, ZOOM_RANGE, inRange } from '../../src/core/model/ranges';
import { ELEMENT_TYPES } from '../../src/core/model/types';
import { arbBoardDocument, arbBounds, arbEditSequence, arbElement, arbViewport } from './index';

describe('shared arbitraries', () => {
  it('arbBoardDocument produces valid documents', () => {
    fc.assert(
      fc.property(arbBoardDocument(), (doc) => {
        const ids = new Set(doc.elements.map((e) => e.id));
        expect(ids.size).toBe(doc.elements.length);
        expect(doc.elements.length).toBeLessThanOrEqual(500);
        const byId = new Map(doc.elements.map((e) => [e.id, e]));
        const assetIds = new Set(doc.assets.map((a) => a.id));
        for (const e of doc.elements) {
          if (e.parentId !== undefined) expect(byId.get(e.parentId)?.type).toBe('frame');
          if (e.type === 'edge') {
            expect(byId.has(e.sourceId)).toBe(true);
            expect(byId.has(e.targetId)).toBe(true);
            expect(byId.get(e.sourceId)?.type).not.toBe('edge');
          }
          if (e.type === 'image') expect(assetIds.has(e.assetId)).toBe(true);
          expect(inRange(e.x, COORD_RANGE)).toBe(true);
          expect(e.width).toBeGreaterThanOrEqual(1);
          expect(e.style.cornerRadius).toBeLessThanOrEqual(Math.min(e.width, e.height) / 2);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('arbElement covers every type', () => {
    for (const t of ELEMENT_TYPES) {
      const [el] = fc.sample(arbElement(t), 1);
      expect(el!.type).toBe(t);
    }
  });

  it('bounds, viewport and edit sequences are in range', () => {
    fc.assert(
      fc.property(arbBounds, arbViewport, arbEditSequence(), (b, v, ops) => {
        expect(b.width).toBeGreaterThanOrEqual(1);
        expect(inRange(v.zoom, ZOOM_RANGE)).toBe(true);
        expect(ops.length).toBeLessThanOrEqual(30);
      }),
    );
  });
});
