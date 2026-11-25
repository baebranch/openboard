// Test-only: runs the build script to produce dist/validators.js.
// eslint-disable-next-line no-restricted-imports
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ELEMENT_TYPES } from '../model/types';
import { buildBoardSchema, buildElementSchemas, s } from './index';

const root = resolve(__dirname, '../../..');

interface Validator {
  (data: unknown): boolean;
  errors?: { instancePath: string; keyword: string }[] | null;
}
let validateBoard: Validator;

const style = {
  fill: '#fff',
  stroke: 'theme:default',
  strokeWidth: 1,
  strokeStyle: 'solid',
  opacity: 100,
  cornerRadius: 0,
};
const rect = { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5, rotation: 0, style };
const board = (elements: unknown[] = [], viewport: unknown = { x: 0, y: 0, zoom: 1 }) => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport,
  elements,
  assets: [],
  library: [],
});

let outDir: string;
let validatorsFile: string;

beforeAll(() => {
  // Build into a private temp dir so no other suite races on dist/validators.js.
  outDir = mkdtempSync(join(tmpdir(), 'openboard-validators-'));
  execFileSync(process.execPath, ['scripts/build-schemas.mjs', outDir], { cwd: root });
  validatorsFile = join(outDir, 'validators.js');
  const req = createRequire(import.meta.url);
  validateBoard = req(validatorsFile).validateBoard as Validator;
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('Board_File schema', () => {
  it('has a schema per element type', () => {
    expect(Object.keys(buildElementSchemas()).sort()).toEqual([...ELEMENT_TYPES].sort());
    expect(buildBoardSchema()['$defs']).toBeDefined();
  });

  it('accepts a valid board and preserves unknown properties', () => {
    expect(validateBoard(board([{ ...rect, unknownProp: 1 }]))).toBe(true);
  });

  it('reports the path of an out-of-range property', () => {
    expect(validateBoard(board([], { x: 0, y: 0, zoom: 99 }))).toBe(false);
    expect(validateBoard.errors?.[0]?.instancePath).toBe('/viewport/zoom');
  });

  it('reports the path inside an element', () => {
    expect(validateBoard(board([{ ...rect, width: 0 }]))).toBe(false);
    expect(validateBoard.errors?.[0]?.instancePath).toBe('/elements/0/width');
  });

  it('rejects an unknown element type', () => {
    expect(validateBoard(board([{ ...rect, type: 'bogus' }]))).toBe(false);
  });

  it('generates validators without eval or Function', () => {
    const code = readFileSync(validatorsFile, 'utf8');
    expect(code).not.toMatch(/\beval\s*\(|new Function\s*\(/);
  });
});

describe('schema builder', () => {
  it('marks properties required unless optional', () => {
    const o = s.object({ a: s.string(), b: s.opt(s.number()) });
    expect(o['required']).toEqual(['a']);
    expect(o['additionalProperties']).toBe(true);
  });
});
