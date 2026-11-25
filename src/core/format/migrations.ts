import { CURRENT_SCHEMA_VERSION } from '../model/ranges';

/** Raw JSON object as read from disk, before validation. */
export type RawDoc = Record<string, unknown>;

/** Migrates a raw document from `from` to `from + 1`. May mutate or return a new object. */
export interface Migration {
  readonly from: number;
  readonly migrate: (doc: RawDoc) => RawDoc;
}

export type MigrationResult =
  | { ok: true; doc: RawDoc; fromVersion: number; applied: number }
  | { ok: false; reason: 'invalid-version' | 'newer' | 'missing-migration'; version: unknown };

export class MigrationRegistry {
  private readonly byFrom = new Map<number, Migration>();

  constructor(migrations: readonly Migration[] = []) {
    for (const m of migrations) this.register(m);
  }

  register(m: Migration): void {
    if (!Number.isInteger(m.from) || m.from < 1) throw new Error(`Invalid migration source version: ${m.from}`);
    if (this.byFrom.has(m.from)) throw new Error(`Duplicate migration from version ${m.from}`);
    this.byFrom.set(m.from, m);
  }

  get(from: number): Migration | undefined {
    return this.byFrom.get(from);
  }

  /**
   * Runs v(n) -> v(n+1) in order until `target`. Input is not mutated.
   * Versions above target are reported as 'newer' (caller opens read-only, Req 11.10).
   */
  migrate(input: RawDoc, target: number = CURRENT_SCHEMA_VERSION): MigrationResult {
    const version = input['schemaVersion'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return { ok: false, reason: 'invalid-version', version };
    }
    if (version > target) return { ok: false, reason: 'newer', version };
    let doc: RawDoc = structuredClone(input);
    let applied = 0;
    for (let v = version; v < target; v++) {
      const m = this.byFrom.get(v);
      if (!m) return { ok: false, reason: 'missing-migration', version: v };
      doc = { ...m.migrate(doc), schemaVersion: v + 1 };
      applied++;
    }
    return { ok: true, doc, fromVersion: version, applied };
  }
}

/** Built-in migrations. Empty while the current schema version is 1. */
export const MIGRATIONS: readonly Migration[] = [];

export const defaultMigrationRegistry = new MigrationRegistry(MIGRATIONS);

export function migrateToCurrent(input: RawDoc): MigrationResult {
  return defaultMigrationRegistry.migrate(input, CURRENT_SCHEMA_VERSION);
}
