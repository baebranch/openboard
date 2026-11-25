import { describe, expect, it } from 'vitest';
import {
  detectImageType,
  validateImageFile,
  validateImageBatch,
  sizeForNaturalDimensions,
  replaceImageSource,
  isValidAltText,
  MAX_IMAGE_BYTES,
} from '../src/core/image';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');

describe('image validation', () => {
  it('detects types by magic bytes', () => {
    expect(detectImageType(png)).toBe('image/png');
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageType(new TextEncoder().encode('GIF89a..'))).toBe('image/gif');
    expect(detectImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectImageType(svg)).toBe('image/svg+xml');
    expect(detectImageType(new TextEncoder().encode('hello'))).toBeUndefined();
  });

  it('accepts exactly 25 MB and rejects one byte more', () => {
    expect(validateImageFile(png, MAX_IMAGE_BYTES).ok).toBe(true);
    const r = validateImageFile(png, MAX_IMAGE_BYTES + 1);
    expect(r.ok).toBe(false);
  });

  it('judges batch files independently', () => {
    const res = validateImageBatch([{ bytes: png }, { bytes: new Uint8Array([1, 2]) }, { bytes: svg }]);
    expect(res.map((r) => r.ok)).toEqual([true, false, true]);
  });
});

describe('image sizing', () => {
  it('keeps small sizes and scales large ones proportionally', () => {
    expect(sizeForNaturalDimensions(800, 1024)).toEqual({ width: 800, height: 1024 });
    expect(sizeForNaturalDimensions(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(sizeForNaturalDimensions(1000, 4096)).toEqual({ width: 250, height: 1024 });
  });

  it('replace keeps x, y, rotation, width and adjusts height', () => {
    const el = { x: 5, y: 6, rotation: 30, width: 200, height: 100 };
    expect(replaceImageSource(el, { width: 100, height: 400 })).toEqual({ ...el, height: 800 });
  });

  it('alt text limit is 500', () => {
    expect(isValidAltText('a'.repeat(500))).toBe(true);
    expect(isValidAltText('a'.repeat(501))).toBe(false);
  });
});
