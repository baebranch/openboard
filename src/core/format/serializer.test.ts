import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { serialize } from './serializer';
import { sha256Hex, base64Decode } from './sha256';
import type { Asset, BoardDocument, Element } from '../model/types';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const img = (id: string, assetId: string, extra?: Record<string, unknown>): Element => ({
  id, type: 'image', x: 0, y: 0, width: 10, height: 10, rotation: 0, style, assetId, ...(extra ? { extra } : {}),
});
const asset = (id: string, data: string): Asset => ({ id, mime: 'image/png', hash: 'x', width: 1, height: 1, data });
const doc = (p: Partial<BoardDocument>): BoardDocument => ({
  schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [], assets: [], library: [], ...p,
});

describe('serialize', () => {
  it('sha256 matches node:crypto', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(1000)]) {
      expect(sha256Hex(new TextEncoder().encode(s))).toBe(createHash('sha256').update(s).digest('hex'));
    }
    expect(base64Decode('aGk=')).toEqual(new Uint8Array([104, 105]));
  });

  it('sorts keys, indents by 2, ends with newline, keeps z-order', () => {
    const out = serialize(doc({ elements: [img('b', 'a1'), img('a', 'a1')], assets: [asset('a1', 'aGk=')] }));
    expect(out.endsWith('}\n')).toBe(true);
    expect(out.indexOf('"assets"')).toBeLessThan(out.indexOf('"elements"'));
    expect(out.indexOf('"id": "b"')).toBeLessThan(out.indexOf('"id": "a"', out.indexOf('"elements"')));
    expect(out).toContain('\n  "schemaVersion": 1');
    expect(serialize(JSON.parse(out))).toBe(out);
  });

  it('dedupes assets by hash, remaps refs, and drops unreferenced', () => {
    const out = JSON.parse(
      serialize(doc({ elements: [img('e1', 'a1'), img('e2', 'a2')], assets: [asset('a1', 'aGk='), asset('a2', 'aGk='), asset('a3', 'Ynll')] })),
    );
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0].id).toBe('a1');
    expect(out.assets[0].hash).toBe(createHash('sha256').update('hi').digest('hex'));
    expect(out.elements[1].assetId).toBe('a1');
  });

  it('keeps assets referenced by imageFill (elements and library), remapping duplicates', () => {
    const rect = (id: string, assetId: string): Element =>
      ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style: { ...style, imageFill: { assetId, fit: 'cover' } } }) as Element;
    const out = JSON.parse(
      serialize(
        doc({
          elements: [rect('r1', 'a1')],
          library: [{ id: 'l', name: 'l', elements: [rect('r2', 'a2')] } as never],
          assets: [asset('a1', 'aGk='), asset('a2', 'aGk='), asset('a3', 'Ynll')],
        }),
      ),
    );
    expect(out.assets.map((a: Asset) => a.id)).toEqual(['a1']);
    expect(out.library[0].elements[0].style.imageFill.assetId).toBe('a1');
  });

  it('flattens extra bags to their original location', () => {
    const out = JSON.parse(
      serialize(doc({ extra: { zzz: { b: 1, a: 2 } }, elements: [img('e1', 'a1', { custom: 5 })], assets: [asset('a1', 'aGk=')] })),
    );
    expect(out.zzz).toEqual({ a: 2, b: 1 });
    expect(out.elements[0].custom).toBe(5);
    expect(out.extra).toBeUndefined();
    expect(out.elements[0].extra).toBeUndefined();
  });
});
