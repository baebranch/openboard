import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/core/format/parser';
import { serialize } from '../src/core/format/serializer';
import { MigrationRegistry, MIGRATIONS } from '../src/core/format/migrations';
import { hasSchemaV2Feature } from '../src/core/format/schema-version';
import { loadFromBytes } from '../src/host/editor/loader';
import { BoardDocumentState } from '../src/host/editor/state';
import { getBoardValidator } from './helpers/validator';

// Req 3.7, 3.8, 3.9, 28.9, 28.10: migration to v2 in memory, v2 files, newer files, older-build preservation.
const fx = (n: string): string => readFileSync(join(__dirname, 'fixtures', 'migrations', n), 'utf8');
const open = (text: string) => parse(text, { validator: getBoardValidator() });
const json = (s: string) => JSON.parse(s) as Record<string, any>;

const rect = (extra: Record<string, unknown> = {}, style: Record<string, unknown> = {}) => ({
  id: 'r1',
  type: 'rectangle',
  x: 1,
  y: 2,
  width: 30,
  height: 40,
  rotation: 0,
  style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, strokeStyle: 'solid', opacity: 1, cornerRadius: 0, ...style },
  ...extra,
});
const board = (version: number, elements: unknown[] = [], more: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: version,
    meta: { id: '7b1f4a52-3c1e-4d0a-9a55-0c2f6c1e8a10' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements,
    assets: [],
    library: [],
    ...more,
  });

describe('v1 files open as v2 in memory (Req 3.7)', () => {
  it('opens the v1 fixture silently as version 2, writable', () => {
    const r = open(fx('v1.json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.schemaVersion).toBe(2);
    expect(r.readOnly).toBe(false);
    expect(r.migratedFrom).toBe(1);
  });

  it('re-saves as version 1 when no Schema_V2_Feature is used', () => {
    const r = open(fx('v1.json'));
    if (!r.ok) throw new Error('parse failed');
    expect(hasSchemaV2Feature(r.doc)).toBe(false);
    expect(json(serialize(r.doc))['schemaVersion']).toBe(1);
  });

  it('re-saves as version 2 once a Schema_V2_Feature is added', () => {
    const r = open(fx('v1.json'));
    if (!r.ok) throw new Error('parse failed');
    const doc = { ...r.doc, tokens: { colors: { brand: '#336699' } } };
    expect(json(serialize(doc))['schemaVersion']).toBe(2);
  });
});

describe('v2 files with a Schema_V2_Feature (Req 3.8)', () => {
  it('opens the v2 fixture unmigrated, writable, and keeps version 2 on save', () => {
    const r = open(fx('v2.json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readOnly).toBe(false);
    expect(r.migratedFrom).toBeUndefined();
    expect(r.doc.schemaVersion).toBe(2);
    expect(hasSchemaV2Feature(r.doc)).toBe(true);
    const out = json(serialize(r.doc));
    expect(out['schemaVersion']).toBe(2);
    expect(out['tokens']).toEqual({ colors: { brand: '#336699' } });
  });

  it('opens a v2 file using a layout/sizing field', () => {
    const r = open(board(2, [rect({ sizing: { width: 'fill', height: 'hug' } })]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.readOnly).toBe(false);
  });
});

describe('files newer than the current build open read-only (Req 3.9)', () => {
  const text = board(3, [rect({ futureThing: { a: 1 } })], { futureRoot: [1, 2, 3] });

  it('parses as read-only with the raw text retained', () => {
    const r = open(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readOnly).toBe(true);
    expect(r.rawText).toBe(text);
  });

  it('refuses edits and rewrites the original bytes unchanged', () => {
    const outcome = loadFromBytes(new TextEncoder().encode(text), (t) => open(t));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const state = new BoardDocumentState('mem', outcome);
    expect(state.readOnly).toBe(true);
    expect(state.canEdit).toBe(false);
    expect(new TextDecoder().decode(state.toBytes())).toBe(text);
  });

  it('simulates an older build (current = 1) refusing a schema 2 file', () => {
    const registry = new MigrationRegistry(MIGRATIONS);
    const input = json(fx('v2.json'));
    const before = JSON.stringify(input);
    const res = registry.migrate(input, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('newer');
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('older build preserves unknown Mockup_Fields as extras (Req 28.9, 28.10)', () => {
  const doc = board(
    1,
    [
      rect(
        { futureBase: { k: [1, 2] }, parentId: undefined },
        { futureStyle: 'zzz' },
      ),
    ],
    { futureRoot: { deep: true } },
  );

  it('keeps unknown element, style and root properties through open and save', () => {
    const r = open(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const el = r.doc.elements[0] as any;
    expect(el.extra).toEqual({ futureBase: { k: [1, 2] } });
    expect(el.style.extra).toEqual({ futureStyle: 'zzz' });
    const out = json(serialize(r.doc));
    expect(out['futureRoot']).toEqual({ deep: true });
    expect(out['elements'][0]['futureBase']).toEqual({ k: [1, 2] });
    expect(out['elements'][0]['style']['futureStyle']).toBe('zzz');
    expect(out['elements'][0]['extra']).toBeUndefined();
  });

  it('round-trips Phase 1 fields unchanged', () => {
    const src = json(doc);
    const r = open(doc);
    if (!r.ok) throw new Error('parse failed');
    const out = json(serialize(r.doc));
    expect(out['schemaVersion']).toBe(1);
    expect(out['elements']).toEqual(src['elements']);
    expect(out['meta']).toEqual(src['meta']);
    expect(out['viewport']).toEqual(src['viewport']);
  });

  it('save is stable: reopening a saved file and saving again is byte-identical', () => {
    const r1 = open(doc);
    if (!r1.ok) throw new Error('parse failed');
    const s1 = serialize(r1.doc);
    const r2 = open(s1);
    if (!r2.ok) throw new Error('reparse failed');
    expect(serialize(r2.doc)).toBe(s1);
  });
});
