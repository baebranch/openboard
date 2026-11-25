import { beforeAll, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Asset, BoardDocument, Element } from '../model/types';
import { getBoardValidator } from '../../../test/helpers/validator';
import { parse, setBoardValidator } from '../format/parser';
import { serialize } from '../format/serializer';
import { renderToSvg } from './svg';

const FILL = '#12ab34';
const baseStyle = { fill: FILL, stroke: '#000000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;

const fillTypes = ['rectangle', 'ellipse', 'diamond', 'frame', 'sticky'] as const;
const fits = ['cover', 'contain', 'stretch'] as const;

const idArb = fc.stringMatching(/^[a-z][a-z0-9]{0,11}$/).map((s) => `missing-${s}`);

/** Either no Asset with that id exists, or one exists with undecodable bytes. */
const assetsArb = (id: string): fc.Arbitrary<Asset[]> =>
  fc.oneof(
    fc.constant<Asset[]>([]),
    fc.constantFrom('', 'AAAA', '!!!not-base64!!!', 'iVBORw0KGgo=').map<Asset[]>((data) => [
      { id, mime: 'image/png', hash: 'h', width: 4, height: 4, data },
    ]),
  );

const scenarioArb = fc
  .record({
    id: idArb,
    type: fc.constantFrom(...fillTypes),
    fit: fc.constantFrom(...fits),
    width: fc.integer({ min: 1, max: 400 }),
    height: fc.integer({ min: 1, max: 400 }),
    radius: fc.integer({ min: 0, max: 40 }),
    useImageElement: fc.boolean(),
  })
  .chain((s) => assetsArb(s.id).map((assets) => ({ ...s, assets })));

const buildElement = (s: { id: string; type: (typeof fillTypes)[number]; fit: (typeof fits)[number]; width: number; height: number; radius: number }): Element =>
  ({
    id: 'el1',
    type: s.type,
    x: 0,
    y: 0,
    width: s.width,
    height: s.height,
    rotation: 0,
    style: { ...baseStyle, cornerRadius: s.radius, imageFill: { assetId: s.id, fit: s.fit } },
    ...(s.type === 'frame' ? { name: 'F' } : {}),
    ...(s.type === 'sticky' ? { runs: [{ text: 'x' }], fontFamily: 'sans-serif', fontSize: 16, align: 'left' } : {}),
  }) as unknown as Element;

const buildImage = (assetId: string, w: number, h: number): Element =>
  ({ id: 'img1', type: 'image', x: 0, y: 0, width: w, height: h, rotation: 0, style: { ...baseStyle }, assetId }) as Element;

const docOf = (elements: Element[], assets: Asset[]): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements,
  assets,
  library: [],
});

describe('Feature: mockup-design-features, Property 15: Missing image reference never throws', () => {
  beforeAll(() => {
    setBoardValidator(getBoardValidator());
  }, 60_000);

  it('**Validates: Requirements 9.9, 9.10** rendering falls back to the fill color and never throws', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const el = buildElement(s);
        const unrelated = { id: 'ok', type: 'rectangle', x: 500, y: 0, width: 10, height: 10, rotation: 0, style: { ...baseStyle } } as Element;
        const r = renderToSvg({ elements: [el, unrelated], assets: s.assets }, [el, unrelated]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const svg = r.value.svg;
        // Fallback to the fill color only: the fill paint is present, and the rest of the document still renders.
        expect(svg).toContain(FILL);
        // Decoding happens in the rasterizer, so the SVG string can only omit the image when no Asset exists.
        if (s.assets.length === 0) expect(svg).not.toContain('<image');
      }),
      { numRuns: 100 },
    );
  });

  it('**Validates: Requirements 9.9, 9.10** an image element with a missing asset renders without throwing', () => {
    fc.assert(
      fc.property(idArb, fc.integer({ min: 1, max: 300 }), fc.integer({ min: 1, max: 300 }), (id, w, h) => {
        const el = buildImage(id, w, h);
        expect(() => renderToSvg({ elements: [el], assets: [] }, [el])).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('**Validates: Requirements 9.9, 9.10** serializer and parser preserve the dangling reference unchanged', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const el = s.useImageElement ? buildImage(s.id, s.width, s.height) : buildElement(s);
        const text = serialize(docOf([el], []));
        const parsed = parse(text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const out = parsed.doc.elements[0] as Element & { assetId?: string };
        if (s.useImageElement) expect(out.assetId).toBe(s.id);
        else expect(out.style.imageFill).toEqual({ assetId: s.id, fit: s.fit });
        expect(serialize(parsed.doc)).toBe(text);
      }),
      { numRuns: 100 },
    );
  });
});
