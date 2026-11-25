import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectiveSchemaVersion, hasSchemaV2Feature } from '../src/core/format/schema-version';
import { parse } from '../src/core/format/parser';
import { serialize } from '../src/core/format/serializer';
import { MOCKUP_FIELD_SPECS } from '../src/core/model/mockup-fields';
import { getBoardValidator } from './helpers/validator';

// Req 1.2, 3.1, 3.3: documents without a Schema_V2_Feature serialize as version 1, with no Mockup_Field key.
const dir = join(__dirname, 'fixtures', 'non-regression');
const read = (f: string): string => readFileSync(join(dir, f), 'utf8');
const names = readdirSync(dir)
  .filter((n) => /^[^.]+\.openboard$/.test(n))
  .map((n) => n.replace(/\.openboard$/, ''));

function open(name: string) {
  const r = parse(read(`${name}.openboard`), { validator: getBoardValidator() });
  if (!r.ok) throw new Error(`fixture ${name} failed to parse`);
  return r.doc;
}

/** Collect every object key appearing anywhere in a JSON value. */
function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  }
  return out;
}

describe('schema-version selection and serializer output', () => {
  it('has guard fixtures', () => {
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  describe.each(names)('%s', (name) => {
    it('has no Schema_V2_Feature and selects version 1', () => {
      const doc = open(name);
      expect(hasSchemaV2Feature(doc)).toBe(false);
      expect(effectiveSchemaVersion(doc)).toBe(1);
    });

    it('serializes with schemaVersion 1 and no Mockup_Field key', () => {
      const out = serialize(open(name));
      const json = JSON.parse(out) as { schemaVersion: number };
      expect(json.schemaVersion).toBe(1);
      const keys = allKeys(json);
      // `name` is the Icon's own field but also a native Frame property, so Frames legitimately write it.
      for (const spec of MOCKUP_FIELD_SPECS.filter((s) => s.name !== 'name')) expect(keys.has(spec.name)).toBe(false);
    });

    it('writes version 1 even though the parser migrated the in-memory doc to version 2', () => {
      const doc = open(name);
      expect(doc.schemaVersion).toBe(2);
      expect((JSON.parse(serialize(doc)) as { schemaVersion: number }).schemaVersion).toBe(1);
    });

    it('is byte-identical to the stored guard fixture', () => {
      expect(serialize(open(name))).toBe(read(`${name}.serialized.openboard`));
    });
  });
});
