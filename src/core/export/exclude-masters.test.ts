import { describe, expect, it } from 'vitest';
import { omitComponentMasters, prepareExport, selectFrameScopes, DEFAULT_EXPORT_OPTIONS } from './scope';
import type { Element } from '../model/types';

const base = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
const els = [
  { ...base, id: 'm', type: 'frame', component: 'Card' },
  { ...base, id: 'mc', type: 'rect', parentId: 'm' },
  { ...base, id: 'f', type: 'frame', x: 500 },
  { ...base, id: 'i', type: 'frame', x: 500, instanceOf: 'm' },
  { ...base, id: 'r', type: 'rect', x: 520 },
  { ...base, id: 'e1', type: 'edge', sourceId: 'mc', targetId: 'r' },
  { ...base, id: 'e2', type: 'edge', sourceId: 'i', targetId: 'r' },
] as unknown as Element[];
const doc = { elements: els };

describe('exclude component masters (Req 17)', () => {
  it('omits masters, descendants and attached edges but keeps instances', () => {
    const ids = omitComponentMasters(doc).elements.map((e) => e.id);
    expect(ids).toEqual(['f', 'i', 'r', 'e2']);
  });

  it('produces no file for master frames in all-frames scope', () => {
    expect(selectFrameScopes(doc, { excludeMasters: true }).map((s) => s.frame.id)).toEqual(['f', 'i']);
    expect(selectFrameScopes(doc).map((s) => s.frame.id)).toEqual(['m', 'f', 'i']);
  });

  it('reports an empty scope when only masters remain', () => {
    const only = { elements: els.slice(0, 2) };
    const r = prepareExport(only, { ...DEFAULT_EXPORT_OPTIONS, excludeMasters: true });
    expect(r.ok).toBe(false);
    expect(prepareExport(only, DEFAULT_EXPORT_OPTIONS).ok).toBe(true);
  });

  it('is a no-op without masters', () => {
    const d = { elements: els.slice(2) };
    expect(omitComponentMasters(d)).toBe(d);
  });
});
