import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToSvg } from '../src/core/export/svg';
import { parse } from '../src/core/format/parser';
import { serialize } from '../src/core/format/serializer';
import { needsDerivedPass } from '../src/core/ops/derived-geometry';
import { BoardModel } from '../src/core/ops/model';
import { UndoHistory } from '../src/core/ops/history';
import { getBoardValidator } from './helpers/validator';

// Guard fixtures (Req 1.2, 1.3, 1.12, 1.13, 1.14, 2.9, 28.6): documents using no Mockup_Field must
// serialize and render byte-identically to the pre-feature build. Expected files were generated
// from the unmodified build; never regenerate them to make this test pass.
const dir = join(__dirname, 'fixtures', 'non-regression');
const read = (f: string): string => readFileSync(join(dir, f), 'utf8');
const names = readdirSync(dir)
  .filter((n) => /^[^.]+\.openboard$/.test(n))
  .map((n) => n.replace(/\.openboard$/, ''));
const FIXED_NOW = '2024-01-01T00:00:00.000Z';

function open(name: string) {
  const r = parse(read(`${name}.openboard`), { validator: getBoardValidator() });
  if (!r.ok) throw new Error(`fixture ${name} failed to parse: ${JSON.stringify(r)}`);
  return r;
}

describe('non-regression guard fixtures', () => {
  it('has at least three fixtures', () => {
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  describe.each(names)('%s', (name) => {
    it('opens without error, read-only state, or modification', () => {
      const r = open(name);
      expect(r.readOnly).toBe(false);
      // Req 3.5: a version 1 file is migrated to version 2 in memory (identity); the serializer
      // still writes version 1 because the document has no Schema_V2_Feature.
      expect(r.migratedFrom).toBe(1);
      expect(r.doc.schemaVersion).toBe(2);
      const model = new BoardModel('x', r.doc, { history: new UndoHistory(), now: () => FIXED_NOW });
      let changes = 0;
      model.onDidChange(() => changes++);
      expect((model.history as UndoHistory).canUndo()).toBe(false);
      expect(changes).toBe(0);
      expect(model.getDocument().meta.modifiedAt).toBe(FIXED_NOW);
    });

    it('serialize() after open is byte-identical to the stored output', () => {
      expect(serialize(open(name).doc)).toBe(read(`${name}.serialized.openboard`));
    });

    it('serialize() after reparse is stable', () => {
      const once = serialize(open(name).doc);
      const again = parse(once, { validator: getBoardValidator() });
      expect(again.ok && serialize(again.doc)).toBe(once);
    });

    it('serialize() after a pre-feature edit is byte-identical, and reverting restores the original', () => {
      const r = open(name);
      const model = new BoardModel('x', r.doc, { now: () => FIXED_NOW });
      const first = r.doc.elements[0]!;
      model.transact('move', (tx) => tx.update(first.id, { x: first.x + 10 }));
      // Guard fixtures use no components or layout, so the Derived_Geometry_Pass produces no patches.
      expect(needsDerivedPass(r.doc)).toBe(false);
      expect(model.takeLastDerivedIds()).toEqual([]);
      expect(serialize(model.getDocument())).toBe(read(`${name}.edited.openboard`));
      model.transact('move back', (tx) => tx.update(first.id, { x: first.x }));
      expect(serialize(model.getDocument())).toBe(read(`${name}.serialized.openboard`));
    });

    it('renderToSvg() is byte-identical to the stored output', () => {
      const doc = open(name).doc;
      const svg = renderToSvg(doc, doc.elements, { padding: 10 });
      expect(svg.ok).toBe(true);
      if (svg.ok) expect(svg.value.svg).toBe(read(`${name}.svg`));
    });
  });
});
