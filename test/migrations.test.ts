import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MigrationRegistry, migrateToCurrent, type RawDoc } from '../src/core/format/migrations';
import { CURRENT_SCHEMA_VERSION } from '../src/core/model/ranges';

const dir = join(__dirname, 'fixtures', 'migrations');

describe('migrations', () => {
  it('every stored fixture (v<N>.json) migrates to the current version', () => {
    for (const f of readdirSync(dir).filter((n) => /^v\d+\.json$/.test(n))) {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as RawDoc;
      const r = migrateToCurrent(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.doc['schemaVersion']).toBe(CURRENT_SCHEMA_VERSION);
    }
  });

  it('chains registered migrations in order without mutating input', () => {
    const reg = new MigrationRegistry([
      { from: 2, migrate: (d) => ({ ...d, b: 'two' }) },
      { from: 1, migrate: (d) => ({ ...d, a: 'one' }) },
    ]);
    const input = { schemaVersion: 1 };
    const r = reg.migrate(input, 3);
    expect(r).toMatchObject({ ok: true, applied: 2, doc: { schemaVersion: 3, a: 'one', b: 'two' } });
    expect(input).toEqual({ schemaVersion: 1 });
  });

  it('reports newer, invalid and missing', () => {
    const reg = new MigrationRegistry();
    expect(reg.migrate({ schemaVersion: 9 }, 1)).toMatchObject({ ok: false, reason: 'newer' });
    expect(reg.migrate({}, 1)).toMatchObject({ ok: false, reason: 'invalid-version' });
    expect(reg.migrate({ schemaVersion: 1 }, 2)).toMatchObject({ ok: false, reason: 'missing-migration' });
  });

  it('rejects duplicate registrations', () => {
    const reg = new MigrationRegistry([{ from: 1, migrate: (d) => d }]);
    expect(() => reg.register({ from: 1, migrate: (d) => d })).toThrow();
  });
});
