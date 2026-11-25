import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deflateSync } from 'node:zlib';
import { embedDocument, extractDocument, crc32 } from '../../src/core/export/png-chunk';

// Feature: openboard, Property 59: PNG metadata round trip
// **Validates: Requirements 12.8**
describe('Feature: openboard, Property 59: PNG metadata round trip', () => {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  function join(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  function buildPng(w: number, h: number, pixels: Uint8Array, extra: Uint8Array[]): Uint8Array {
    const ihdr = new Uint8Array(13);
    const v = new DataView(ihdr.buffer);
    v.setUint32(0, w);
    v.setUint32(4, h);
    ihdr[8] = 8;
    ihdr[9] = 0; // grayscale
    // raw scanlines: filter byte 0 + w bytes per row
    const raw = new Uint8Array(h * (w + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = pixels[(y * w + x) % pixels.length] as number;
    return join([
      Uint8Array.from(SIG),
      chunk('IHDR', ihdr),
      ...extra,
      chunk('IDAT', new Uint8Array(deflateSync(raw))),
      chunk('IEND', new Uint8Array(0)),
    ]);
  }

  interface C {
    type: string;
    data: Uint8Array;
    raw: Uint8Array;
    crcOk: boolean;
  }
  function parse(png: Uint8Array): C[] {
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const out: C[] = [];
    let p = 8;
    while (p < png.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
      const data = png.slice(p + 8, p + 8 + len);
      const crc = dv.getUint32(p + 8 + len);
      out.push({
        type,
        data,
        raw: png.slice(p, p + 12 + len),
        crcOk: crc === crc32(png.subarray(p + 4, p + 8 + len)),
      });
      p += 12 + len;
    }
    return out;
  }

  const pngArb = fc.record({
    w: fc.integer({ min: 1, max: 16 }),
    h: fc.integer({ min: 1, max: 16 }),
    pixels: fc.uint8Array({ minLength: 1, maxLength: 64 }),
    extra: fc.array(
      fc.record({
        type: fc.constantFrom('tEXt', 'pHYs', 'gAMA', 'zzZz'),
        data: fc.uint8Array({ maxLength: 20 }),
      }),
      { maxLength: 3 },
    ),
  });
  const build = (r: { w: number; h: number; pixels: Uint8Array; extra: { type: string; data: Uint8Array }[] }) =>
    buildPng(r.w, r.h, r.pixels, r.extra.map((e) => chunk(e.type, e.data)));

  const jsonArb = fc.oneof(fc.json(), fc.string({ unit: 'binary' }).map((s) => JSON.stringify({ s })), fc.string({ unit: 'grapheme' }));

  it('extract(embed(png, json)) returns json; other chunks unchanged; CRCs valid', () => {
    fc.assert(
      fc.property(pngArb, jsonArb, (r, json) => {
        const png = build(r);
        const out = embedDocument(png, json);
        expect(extractDocument(out)).toBe(json);
        const before = parse(png);
        const after = parse(out);
        expect(after.every((c) => c.crcOk)).toBe(true);
        const others = after.filter((c) => c.type !== 'iTXt');
        expect(others.length).toBe(before.length);
        others.forEach((c, i) => expect(Array.from(c.raw)).toEqual(Array.from((before[i] as C).raw)));
        expect(after[after.length - 1]?.type).toBe('IEND');
      }),
      { numRuns: 100 },
    );
  });

  it('re-embedding replaces the previous chunk', () => {
    fc.assert(
      fc.property(pngArb, jsonArb, jsonArb, (r, a, b) => {
        const png = build(r);
        const once = embedDocument(png, a);
        const twice = embedDocument(once, b);
        expect(extractDocument(twice)).toBe(b);
        expect(parse(twice).filter((c) => c.type === 'iTXt').length).toBe(1);
        expect(parse(twice).every((c) => c.crcOk)).toBe(true);
        expect(Array.from(embedDocument(once, b))).toEqual(Array.from(twice));
        expect(Array.from(twice)).toEqual(Array.from(embedDocument(png, b)));
      }),
      { numRuns: 100 },
    );
  });

  it('returns undefined when no document is embedded', () => {
    expect(extractDocument(buildPng(2, 2, Uint8Array.of(1, 2), []))).toBeUndefined();
  });
});
