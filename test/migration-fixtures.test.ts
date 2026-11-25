import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/core/format/parser';
import { CURRENT_SCHEMA_VERSION } from '../src/core/model/ranges';
import { getBoardValidator } from './helpers/validator';

// Req 19.7: every stored prior-version fixture must load at the current version.
const dir = join(__dirname, 'fixtures', 'migrations');
const fixtures = readdirSync(dir)
  .map((n) => /^v(\d+)\.json$/.exec(n))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({ name: m[0], version: Number(m[1]) }))
  .sort((a, b) => a.version - b.version);

describe('migration fixtures (Req 19.7)', () => {
  it('has a fixture for every schema version 1..CURRENT_SCHEMA_VERSION', () => {
    const have = new Set(fixtures.map((f) => f.version));
    for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) expect(have.has(v), `missing v${v}.json`).toBe(true);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s loads at the current version without error', (_n, f) => {
    const text = readFileSync(join(dir, f.name), 'utf8');
    const r = parse(text, { validator: getBoardValidator() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readOnly).toBe(false);
      expect(r.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    }
  });
});
