import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/model/ranges';
import type { Asset, BoardDocument, Element, ImageElement } from '../../src/core/model/types';
import { arbElement } from '../arbitraries';

const sha = (data: string): string => createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');

type Layout = {
  payloads: string[];
  /** Each asset: which payload it carries (ids are unique, contents may repeat). */
  assetPayload: number[];
  docRefs: number[];
  libRefs: number[][];
  images: ImageElement[];
};

const arbLayout: fc.Arbitrary<Layout> = fc
  .tuple(
    fc.uniqueArray(fc.uint8Array({ minLength: 1, maxLength: 24 }).map((b) => Buffer.from(b).toString('base64')), {
      minLength: 1,
      maxLength: 4,
    }),
    fc.array(fc.nat(), { maxLength: 10 }),
    fc.array(fc.nat(), { maxLength: 8 }),
    fc.array(fc.array(fc.nat(), { maxLength: 3 }), { maxLength: 3 }),
    fc.array(arbElement('image') as fc.Arbitrary<ImageElement>, { minLength: 24, maxLength: 24 }),
  )
  .map(([payloads, ap, docRefs, libRefs, images]) => ({
    payloads,
    assetPayload: ap.map((n) => n % payloads.length),
    docRefs,
    libRefs,
    images,
  }));

function build(l: Layout): { doc: BoardDocument; assets: Asset[] } | undefined {
  if (l.assetPayload.length === 0) return undefined;
  const assets: Asset[] = l.assetPayload.map((p, i) => ({
    id: `asset-${i}`,
    mime: 'image/png',
    hash: sha(l.payloads[p]!),
    width: 10,
    height: 10,
    data: l.payloads[p]!,
  }));
  let n = 0;
  const mk = (ref: number): Element => ({ ...l.images[n]!, id: `img-${n++}`, assetId: assets[ref % assets.length]!.id });
  const elements = l.docRefs.map(mk);
  const library = l.libRefs.map((refs, i) => ({ id: `lib-${i}`, name: `c${i}`, elements: refs.map(mk) }));
  return {
    assets,
    doc: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      meta: { id: 'b' },
      viewport: { x: 0, y: 0, zoom: 1 },
      elements,
      assets,
      library,
    },
  };
}

function imageRefs(els: Element[]): string[] {
  return els.filter((e): e is ImageElement => e.type === 'image').map((e) => e.assetId);
}

// Feature: openboard, Property 7: Assets are stored once and only when referenced
describe('Feature: openboard, Property 7: Assets are stored once and only when referenced', () => {
  it('stores each referenced content once, resolves every reference, and drops unreferenced assets', () => {
    // **Validates: Requirements 7.10, 7.11**
    fc.assert(
      fc.property(arbLayout, (layout) => {
        const built = build(layout);
        if (!built) return;
        const { doc, assets } = built;
        const out = JSON.parse(serialize(doc)) as BoardDocument;

        const byId = new Map(assets.map((a) => [a.id, a]));
        const refs = [...imageRefs(doc.elements), ...doc.library.flatMap((c) => imageRefs(c.elements))];
        const expectedHashes = new Set(refs.map((id) => sha(byId.get(id)!.data)));

        // Each distinct content exactly once; nothing else.
        const outHashes = out.assets.map((a) => sha(a.data));
        expect(outHashes.length).toBe(new Set(outHashes).size);
        expect(new Set(outHashes)).toEqual(expectedHashes);
        expect(new Set(out.assets.map((a) => a.hash))).toEqual(expectedHashes);
        expect(new Set(out.assets.map((a) => a.id)).size).toBe(out.assets.length);

        // Every reference (canvas and library) resolves to an asset with the original content.
        const outById = new Map(out.assets.map((a) => [a.id, a]));
        const check = (before: Element[], after: Element[]): void => {
          const b = imageRefs(before);
          const a = imageRefs(after);
          expect(a.length).toBe(b.length);
          a.forEach((id, i) => {
            const resolved = outById.get(id);
            expect(resolved).toBeDefined();
            expect(sha(resolved!.data)).toBe(sha(byId.get(b[i]!)!.data));
          });
        };
        check(doc.elements, out.elements);
        doc.library.forEach((c, i) => check(c.elements, out.library[i]!.elements));
      }),
      { numRuns: 150 },
    );
  });

  it('keeps assets referenced only by library components', () => {
    const data = Buffer.from([1, 2, 3]).toString('base64');
    const asset: Asset = { id: 'a', mime: 'image/png', hash: sha(data), width: 1, height: 1, data };
    const img = fc.sample(arbElement('image') as fc.Arbitrary<ImageElement>, 1)[0]!;
    const doc: BoardDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      meta: { id: 'b' },
      viewport: { x: 0, y: 0, zoom: 1 },
      elements: [],
      assets: [asset, { ...asset, id: 'unused', data: Buffer.from([9]).toString('base64'), hash: sha(Buffer.from([9]).toString('base64')) }],
      library: [{ id: 'l', name: 'c', elements: [{ ...img, assetId: 'a' }] }],
    };
    const out = JSON.parse(serialize(doc)) as BoardDocument;
    expect(out.assets.map((a) => a.id)).toEqual(['a']);
  });
});
