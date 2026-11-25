import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_ACTIVE_BOARD_MESSAGE } from '../src/host/commands';
import { CONFLICT_CHOICES, CONFLICT_MESSAGE } from '../src/host/io/external-change';

const root = resolve(__dirname, '..');
const pkgRaw = readFileSync(join(root, 'package.json'), 'utf8');
const nls = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
const bundle = JSON.parse(readFileSync(join(root, 'l10n/bundle.l10n.json'), 'utf8')) as Record<string, string>;

function hostSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...hostSources(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('localization', () => {
  it('every %key% used in package.json resolves in package.nls.json', () => {
    const keys = [...pkgRaw.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1] as string);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(nls[k], k).toBeTruthy();
  });

  it('package.json points at the l10n bundle folder and the schema is registered', () => {
    const pkg = JSON.parse(pkgRaw) as Record<string, any>;
    expect(pkg.l10n).toBe('./l10n');
    expect(pkg.contributes.jsonValidation).toEqual([
      { fileMatch: '*.openboard', url: './src/core/schema/board.schema.json' },
    ]);
  });

  it('every literal vscode.l10n.t(...) string in src/host is in the l10n bundle', () => {
    const found: string[] = [];
    for (const file of hostSources(join(root, 'src/host'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) found.push(m[1] as string);
    }
    expect(found.length).toBeGreaterThan(0);
    for (const s of found) expect(bundle[s], s).toBeDefined();
  });

  it('dynamic user-facing host strings are in the l10n bundle', () => {
    for (const s of [NO_ACTIVE_BOARD_MESSAGE, CONFLICT_MESSAGE, ...CONFLICT_CHOICES]) {
      expect(bundle[s], s).toBeDefined();
    }
  });
});
