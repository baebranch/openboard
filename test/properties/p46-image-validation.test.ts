import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateImageFile, validateImageBatch, detectImageType, MAX_IMAGE_BYTES } from '../../src/core/image';

// Feature: openboard, Property 46: Image validation
// **Validates: Requirements 7.2, 7.3, 7.4, 7.7**
describe('Feature: openboard, Property 46: Image validation', () => {
  const enc = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const heads: Record<string, number[]> = {
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    jpeg: [0xff, 0xd8, 0xff, 0xe0],
    gif: enc('GIF89a'),
    webp: [...enc('RIFF'), 1, 2, 3, 4, ...enc('WEBP')],
    svg: enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  };
  const supported = fc
    .tuple(fc.constantFrom(...Object.keys(heads)), fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 32 }))
    .map(([k, tail]) => new Uint8Array([...heads[k]!, ...(k === 'svg' ? [] : tail)]));
  // Junk starting with a byte that cannot begin any supported signature.
  const unsupported = fc
    .tuple(fc.constantFrom(0x00, 0x25, 0x50, 0x42, 0x7b), fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 32 }))
    .map(([h, t]) => new Uint8Array([h, ...t]));
  const sizeArb = fc.oneof(
    fc.integer({ min: 0, max: MAX_IMAGE_BYTES }),
    fc.integer({ min: MAX_IMAGE_BYTES + 1, max: MAX_IMAGE_BYTES * 4 }),
    fc.constantFrom(MAX_IMAGE_BYTES - 1, MAX_IMAGE_BYTES, MAX_IMAGE_BYTES + 1),
  );

  it('accepts iff type supported (by content) and size <= 25 MB', () => {
    fc.assert(
      fc.property(fc.oneof(supported, unsupported), sizeArb, (bytes, size) => {
        const r = validateImageFile(bytes, size);
        const typeOk = detectImageType(bytes) !== undefined;
        expect(r.ok).toBe(typeOk && size <= MAX_IMAGE_BYTES);
        if (!r.ok) expect(r.reason).toBe(typeOk ? 'too-large' : 'unsupported-type');
      }),
      { numRuns: 200 },
    );
  });

  it('exact 25 MB accepted, one byte more rejected', () => {
    fc.assert(
      fc.property(supported, (bytes) => {
        expect(validateImageFile(bytes, MAX_IMAGE_BYTES).ok).toBe(true);
        expect(validateImageFile(bytes, MAX_IMAGE_BYTES + 1).ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('type is determined by content, unaffected by anything else', () => {
    expect(detectImageType(new Uint8Array(heads.png!))).toBe('image/png');
    expect(detectImageType(new Uint8Array(heads.jpeg!))).toBe('image/jpeg');
    expect(detectImageType(new Uint8Array(heads.gif!))).toBe('image/gif');
    expect(detectImageType(new Uint8Array(heads.webp!))).toBe('image/webp');
    expect(detectImageType(new Uint8Array(heads.svg!))).toBe('image/svg+xml');
  });

  it('batch files are judged independently and in order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ bytes: fc.oneof(supported, unsupported), size: sizeArb }), { maxLength: 12 }),
        (files) => {
          const batch = validateImageBatch(files);
          expect(batch).toHaveLength(files.length);
          files.forEach((f, i) => expect(batch[i]).toEqual(validateImageFile(f.bytes, f.size)));
        },
      ),
      { numRuns: 100 },
    );
  });
});
