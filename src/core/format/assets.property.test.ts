import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { serialize } from './serializer';
import { sha256OfBase64 } from './sha256';
import type { Asset, BoardDocument, Element } from '../model/types';

/**
 * Feature: mockup-design-features, Property 14: Asset deduplication round trip
 * **Validates: Requirements 9.8**
 */

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;

// Distinct base64 payloads (each decodes to different bytes).
const CONTENTS = ['aGk=', 'Ynll', 'Zm9v', 'YmFy', 'YmF6'];

const imageEl = (id: string, assetId: string): Element =>
  ({ id, type: 'image', x: 0, y: 0, width: 10, height: 10, rotation: 0, style, assetId }) as Element;
const fillEl = (id: string, assetId: string): Element =>
  ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style: { ...style, imageFill: { assetId, fit: 'cover' } } }) as Element;

interface Ref {
  kind: 'image' | 'fill';
  asset: number;
  where: 'board' | 'library';
}

const scenario = fc.record({
  contentOf: fc.array(fc.integer({ min: 0, max: CONTENTS.length - 1 }), { minLength: 1, maxLength: 12 }),
  refs: fc.array(
    fc.record({
      kind: fc.constantFrom('image', 'fill') as fc.Arbitrary<Ref['kind']>,
      asset: fc.nat({ max: 11 }),
      where: fc.constantFrom('board', 'library') as fc.Arbitrary<Ref['where']>,
    }),
    { maxLength: 15 },
  ),
});

describe('Property 14: Asset deduplication round trip', () => {
  it('stores exactly one Asset per distinct referenced content hash and no unreferenced Asset', () => {
    fc.assert(
      fc.property(scenario, ({ contentOf, refs }) => {
        const assets: Asset[] = contentOf.map((c, i) => ({
          id: `a${i}`, mime: 'image/png', hash: 'stale', width: 1, height: 1, data: CONTENTS[c]!,
        }));
        const refList = refs.map((r, i) => ({ ...r, assetId: `a${r.asset % assets.length}`, eid: `e${i}` }));
        const mk = (r: (typeof refList)[number]): Element => (r.kind === 'image' ? imageEl(r.eid, r.assetId) : fillEl(r.eid, r.assetId));
        const doc: BoardDocument = {
          schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 },
          elements: refList.filter((r) => r.where === 'board').map(mk),
          assets,
          library: [{ id: 'l', name: 'l', elements: refList.filter((r) => r.where === 'library').map(mk) } as never],
        };

        const out = JSON.parse(serialize(doc)) as BoardDocument;
        const contentById = new Map(assets.map((a) => [a.id, a.data]));
        const expectedHashes = new Set(refList.map((r) => sha256OfBase64(contentById.get(r.assetId)!)));

        // Exactly one Asset per distinct referenced hash.
        const outHashes = out.assets.map((a) => sha256OfBase64(a.data));
        expect(outHashes).toHaveLength(expectedHashes.size);
        expect(new Set(outHashes)).toEqual(expectedHashes);
        expect(new Set(out.assets.map((a) => a.id)).size).toBe(out.assets.length);

        // No unreferenced Asset; every reference resolves to an Asset with the original content.
        const outRefs: Array<{ id: string; orig: string }> = [];
        const collect = (els: Element[]): void => {
          for (const el of els) {
            const orig = refList.find((r) => r.eid === el.id)!.assetId;
            const id = el.type === 'image' ? el.assetId : el.style.imageFill!.assetId;
            outRefs.push({ id, orig });
          }
        };
        collect(out.elements);
        collect(out.library.flatMap((c) => c.elements));
        expect(outRefs).toHaveLength(refList.length);
        const referenced = new Set(outRefs.map((r) => r.id));
        for (const a of out.assets) expect(referenced.has(a.id)).toBe(true);
        for (const r of outRefs) {
          const target = out.assets.find((a) => a.id === r.id);
          expect(target).toBeDefined();
          expect(target!.data).toBe(contentById.get(r.orig));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('is stable when re-serialized', () => {
    const doc: BoardDocument = {
      schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 },
      elements: [imageEl('e1', 'a1'), fillEl('e2', 'a2')],
      assets: [
        { id: 'a1', mime: 'image/png', hash: 'x', width: 1, height: 1, data: 'aGk=' },
        { id: 'a2', mime: 'image/png', hash: 'x', width: 1, height: 1, data: 'aGk=' },
      ],
      library: [],
    };
    const once = serialize(doc);
    expect(serialize(JSON.parse(once))).toBe(once);
  });
});
