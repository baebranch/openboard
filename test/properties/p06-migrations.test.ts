import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, serialize } from '../../src/core/format';
import type { BoardValidator } from '../../src/core/format';
import { MigrationRegistry, type Migration, type RawDoc } from '../../src/core/format/migrations';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/model/ranges';
import { arbBoardDocument } from '../arbitraries';
import { getBoardValidator } from '../helpers/validator';

let validator: BoardValidator;
beforeAll(() => {
  validator = getBoardValidator();
});

/** Synthetic migrations 1..target-1; each appends its source version to a trail (harmless). */
function syntheticRegistry(target: number): MigrationRegistry {
  const ms: Migration[] = [];
  for (let from = 1; from < target; from++) {
    ms.push({
      from,
      migrate: (doc) => ({
        ...doc,
        'x-trail': [...(Array.isArray(doc['x-trail']) ? (doc['x-trail'] as number[]) : []), from],
      }),
    });
  }
  return new MigrationRegistry(ms);
}

const arbCase = fc
  .integer({ min: 1, max: 12 })
  .chain((target) => fc.tuple(fc.constant(target), fc.integer({ min: 1, max: target })));

// Feature: openboard, Property 6: Migration produces a current-version document
describe('Feature: openboard, Property 6: Migration produces a current-version document', () => {
  it('migrates any older version to the target, applying steps in order without mutating input', () => {
    // **Validates: Requirements 11.9**
    fc.assert(
      fc.property(arbCase, fc.jsonValue(), ([target, start], payload) => {
        const input: RawDoc = { schemaVersion: start, payload };
        const snapshot = structuredClone(input);
        const r = syntheticRegistry(target).migrate(input, target);
        expect(input).toEqual(snapshot);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.doc['schemaVersion']).toBe(target);
        expect(r.fromVersion).toBe(start);
        expect(r.applied).toBe(target - start);
        const expected: number[] = [];
        for (let v = start; v < target; v++) expected.push(v);
        expect(r.doc['x-trail'] ?? []).toEqual(expected);
        expect(r.doc['payload']).toEqual(payload);
      }),
      { numRuns: 100 },
    );
  });

  it('reports newer versions and missing migrations without producing a document', () => {
    // **Validates: Requirements 11.9**
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 5 }), (target, extra) => {
        const reg = syntheticRegistry(target);
        const newer = reg.migrate({ schemaVersion: target + extra }, target);
        expect(newer.ok).toBe(false);
        if (!newer.ok) expect(newer.reason).toBe('newer');
        const gap = new MigrationRegistry([]).migrate({ schemaVersion: target }, target + extra);
        expect(gap.ok).toBe(false);
        if (!gap.ok) expect(gap.reason).toBe('missing-migration');
      }),
      { numRuns: 100 },
    );
  });

  it('parse yields a valid current-version document via the migration pipeline', () => {
    // **Validates: Requirements 11.9**
    fc.assert(
      fc.property(arbBoardDocument(10), (doc) => {
        const text = serialize(doc);
        const r = parse(text, {
          validator,
          migrations: syntheticRegistry(CURRENT_SCHEMA_VERSION),
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.readOnly).toBe(false);
        expect(r.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(validator(JSON.parse(serialize(r.doc)))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
