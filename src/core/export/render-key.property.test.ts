import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import type { Asset, Element, ImageElement } from '../model/types';
import { builtinPalette } from '../theme';
import { renderContextKey } from './render-key';

const renderSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./svg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./svg')>();
  return {
    ...actual,
    renderElementToSvg: (...args: Parameters<typeof actual.renderElementToSvg>) => {
      renderSpy.calls++;
      return actual.renderElementToSvg(...args);
    },
  };
});

import { svgFor } from '../../webview/canvas/ElementNode';

const palette = builtinPalette('dark');
/** Stable asset list: svgFor compares the assets array by identity. */
const NO_ASSETS: readonly Asset[] = [];

const baseStyle = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, strokeStyle: 'solid', opacity: 1, cornerRadius: 0 } as const;

const rectArb: fc.Arbitrary<Element> = fc
  .record({
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
    width: fc.integer({ min: 1, max: 500 }),
    height: fc.integer({ min: 1, max: 500 }),
    rotation: fc.integer({ min: 0, max: 359 }),
    strokeWidth: fc.integer({ min: 1, max: 8 }),
    opacity: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map(
    (r) =>
      ({
        id: 'e1',
        type: 'rectangle',
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        rotation: r.rotation,
        style: { ...baseStyle, strokeWidth: r.strokeWidth, opacity: r.opacity },
      }) as Element,
  );

/** Mutate exactly one JSON leaf (numeric leaves of the element or its style). */
const LEAVES = ['x', 'y', 'width', 'height', 'rotation', 'style.strokeWidth', 'style.opacity'] as const;
function mutateLeaf(el: Element, leaf: (typeof LEAVES)[number]): Element {
  const copy = structuredClone(el) as Element & Record<string, any>;
  if (leaf.startsWith('style.')) {
    const k = leaf.slice(6) as 'strokeWidth' | 'opacity';
    copy.style[k] = k === 'opacity' ? (copy.style[k] > 0.5 ? 0.25 : 0.75) : copy.style[k] + 1;
  } else {
    copy[leaf] = copy[leaf] + 1;
  }
  return copy;
}

const makeAsset = (data: string): Asset => ({
  id: 'a1',
  mime: 'image/png',
  hash: createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex'),
  width: 4,
  height: 4,
  data,
});

const imageEl = (): ImageElement =>
  ({ id: 'i1', type: 'image', x: 0, y: 0, width: 10, height: 10, rotation: 0, style: { ...baseStyle }, assetId: 'a1' }) as ImageElement;

describe('Feature: mockup-design-features, Property 6: Render_Cache key completeness', () => {
  beforeEach(() => {
    renderSpy.calls = 0;
  });

  /** **Validates: Requirements 5.4** */
  it('mutating one JSON leaf of an element is a cache miss', () => {
    fc.assert(
      fc.property(rectArb, fc.constantFrom(...LEAVES), (el, leaf) => {
        svgFor(el, NO_ASSETS, undefined, palette);
        const before = renderSpy.calls;
        svgFor(el, NO_ASSETS, undefined, palette);
        expect(renderSpy.calls).toBe(before); // unchanged element hits
        svgFor(mutateLeaf(el, leaf), NO_ASSETS, undefined, palette);
        expect(renderSpy.calls).toBe(before + 1); // mutated element misses
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 5.4** */
  it('mutating one resolved context value changes the key and misses the cache', () => {
    fc.assert(
      fc.property(
        rectArb,
        fc.dictionary(fc.stringMatching(/^[a-z]{1,6}$/), fc.stringMatching(/^#[0-9a-f]{6}$/), { minKeys: 1, maxKeys: 5 }),
        fc.nat(),
        fc.stringMatching(/^[0-9a-z]{1,6}$/),
        (el, tokens, pick, newVal) => {
          const names = Object.keys(tokens);
          const name = names[pick % names.length]!;
          fc.pre(tokens[name] !== newVal);
          const mutated = { ...tokens, [name]: newVal };
          expect(renderContextKey(el, { tokens })).not.toBe(renderContextKey(el, { tokens: mutated }));

          svgFor(el, NO_ASSETS, undefined, palette, { tokens });
          const before = renderSpy.calls;
          svgFor(el, NO_ASSETS, undefined, palette, { tokens: { ...tokens } });
          expect(renderSpy.calls).toBe(before);
          svgFor(el, NO_ASSETS, undefined, palette, { tokens: mutated });
          expect(renderSpy.calls).toBe(before + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 5.4** */
  it('mutating the bytes of a referenced Asset changes the key and misses the cache', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 32 }), fc.nat(), (bytes, idx) => {
        const other = Uint8Array.from(bytes);
        const i = idx % other.length;
        other[i] = other[i]! ^ 0xff;
        const a1 = makeAsset(Buffer.from(bytes).toString('base64'));
        const a2 = makeAsset(Buffer.from(other).toString('base64'));
        const el = imageEl();
        expect(renderContextKey(el, { assets: [a1] })).not.toBe(renderContextKey(el, { assets: [a2] }));

        svgFor(el, [a1], undefined, palette);
        const before = renderSpy.calls;
        svgFor(el, [a2], undefined, palette);
        expect(renderSpy.calls).toBe(before + 1);
      }),
      { numRuns: 100 },
    );
  });
});
