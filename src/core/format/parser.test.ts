// Test-only: compiles the board validator in-process and wires it into the pure parser.
import { beforeAll, describe, expect, it } from 'vitest';
import { getBoardValidator } from '../../../test/helpers/validator';
import { MigrationRegistry } from './migrations';
import { jsonErrorPosition, parse, setBoardValidator, type BoardValidator } from './parser';
import { serialize } from './serializer';

let validator: BoardValidator;

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const rect = { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5, rotation: 0, style };
const board = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
  ...over,
});

beforeAll(() => {
  validator = getBoardValidator();
  setBoardValidator(validator);
}, 60_000);

describe('parse', () => {
  it('accepts and round-trips settings.grid', () => {
    const settings = { grid: { enabled: false, spacing: 24 }, minimap: true };
    const r = parse(JSON.stringify(board({ settings })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.settings).toEqual(settings);
    const again = parse(serialize(r.doc));
    expect(again.ok && again.doc.settings).toEqual(settings);
  });

  it('returns an empty document for zero-byte input', () => {
    const r = parse('');
    expect(r.ok && r.doc.elements).toEqual([]);
    expect(r.ok && r.readOnly).toBe(false);
  });

  it('reports 1-based line and column for JSON syntax errors', () => {
    const r = parse('{\n  "a": 1,\n  oops\n}');
    expect(r.ok).toBe(false);
    if (!r.ok && r.kind === 'json') {
      expect(r.line).toBe(3);
      expect(r.column).toBeGreaterThanOrEqual(3);
    } else throw new Error('expected json error');
    expect(jsonErrorPosition('ab\ncd', 'Unexpected token at position 4')).toEqual({ line: 2, column: 2 });
  });

  it('reports the path of the first offending property', () => {
    const r = parse(JSON.stringify(board({ elements: [{ ...rect, width: 0 }] })));
    expect(r.ok).toBe(false);
    if (!r.ok && r.kind === 'schema') expect(r.path).toContain('/elements/0');
    else throw new Error('expected schema error');
    const missing = parse(JSON.stringify({ ...board(), viewport: undefined }));
    expect(!missing.ok && missing.kind === 'schema' && missing.path).toBe('/viewport');
  });

  it('does not report migratedFrom when no migration ran, and rejects gaps in the chain', () => {
    const r = parse(JSON.stringify(board()));
    expect(r.ok && r.migratedFrom).toBeUndefined();
    const gap = parse(JSON.stringify(board({ schemaVersion: 0 })), { migrations: new MigrationRegistry([]) });
    expect(gap.ok).toBe(false);
  });

  it('opens newer versions read-only keeping raw text', () => {
    const text = JSON.stringify(board({ schemaVersion: 99, future: true }));
    const r = parse(text);
    expect(r.ok && r.readOnly).toBe(true);
    expect(r.ok && r.rawText).toBe(text);
  });

  it('preserves unknown properties at every level through a round trip', () => {
    const input = board({
      topLevel: { z: 1, a: [1] },
      meta: { id: 'b', m: 1 },
      viewport: { x: 0, y: 0, zoom: 1, v: 2 },
      elements: [{ ...rect, e: 'x', style: { ...style, s: 3 } }],
    });
    const r = parse(JSON.stringify(input));
    if (!r.ok) throw new Error('parse failed');
    expect(r.doc.extra).toEqual({ topLevel: { z: 1, a: [1] } });
    expect(r.doc.elements[0]?.extra).toEqual({ e: 'x' });
    expect((r.doc.elements[0]?.style as { extra?: unknown }).extra).toEqual({ s: 3 });
    expect(JSON.parse(serialize(r.doc))).toEqual(input);
    expect(r.doc.meta).toEqual({ id: 'b', extra: { m: 1 } });
  });
});
