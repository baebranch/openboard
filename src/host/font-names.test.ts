import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bufferReader, familyFromNameTable, readFontFamilies } from './font-names';
import { fontDirectories, normalizeFamilies, scanFontFamilies } from './fonts';

interface NameRec {
  platform: number;
  encoding: number;
  language: number;
  nameId: number;
  text: string;
}

const utf16 = (s: string): number[] => [...s].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]);
const latin = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

function nameTable(recs: NameRec[]): number[] {
  const strings: number[] = [];
  const records: number[] = [];
  for (const r of recs) {
    const bytes = r.platform === 1 ? latin(r.text) : utf16(r.text);
    records.push(...be16(r.platform), ...be16(r.encoding), ...be16(r.language), ...be16(r.nameId), ...be16(bytes.length), ...be16(strings.length));
    strings.push(...bytes);
  }
  return [...be16(0), ...be16(recs.length), ...be16(6 + recs.length * 12), ...records, ...strings];
}

/** One sfnt (header + directory with a single `name` table) whose table data sits at `dataAt`. */
function sfnt(table: number[], base: number): number[] {
  const nameOffset = base + 12 + 16;
  return [
    ...be32(0x00010000), ...be16(1), ...be16(16), ...be16(0), ...be16(0),
    ...latin('name'), ...be32(0), ...be32(nameOffset), ...be32(table.length),
    ...table,
  ];
}

const win = (nameId: number, text: string, language = 0x409): NameRec => ({ platform: 3, encoding: 1, language, nameId, text });

describe('font name parsing', () => {
  it('prefers the typographic family over the legacy family, and US English', () => {
    const t = new Uint8Array(nameTable([win(1, 'Inter Display SemiBold'), win(16, 'Inter Display', 0x407), win(16, 'Inter')]));
    expect(familyFromNameTable(t)).toBe('Inter');
  });

  it('falls back to Mac Roman names', () => {
    const t = new Uint8Array(nameTable([{ platform: 1, encoding: 0, language: 0, nameId: 1, text: 'Geneva' }]));
    expect(familyFromNameTable(t)).toBe('Geneva');
  });

  it('reads a single font file', async () => {
    const buf = new Uint8Array(sfnt(nameTable([win(1, 'Segoe UI')]), 0));
    expect(await readFontFamilies(bufferReader(buf))).toEqual(['Segoe UI']);
  });

  it('reads every font of a collection, deduplicated', async () => {
    const a = nameTable([win(1, 'Cambria')]);
    const b = nameTable([win(1, 'Cambria Math')]);
    const header = 12 + 3 * 4;
    const first = sfnt(a, header);
    const second = sfnt(b, header + first.length);
    const third = sfnt(a, header + first.length + second.length);
    const ttc = [...latin('ttcf'), ...be32(0x00010000), ...be32(3), ...be32(header), ...be32(header + first.length), ...be32(header + first.length + second.length), ...first, ...second, ...third];
    expect(await readFontFamilies(bufferReader(new Uint8Array(ttc)))).toEqual(['Cambria', 'Cambria Math']);
  });

  it('returns nothing for non-font or truncated data, never throwing', async () => {
    expect(await readFontFamilies(bufferReader(new Uint8Array([1, 2, 3])))).toEqual([]);
    const full = sfnt(nameTable([win(1, 'Arial')]), 0);
    expect(await readFontFamilies(bufferReader(new Uint8Array(full.slice(0, 30))))).toEqual([]);
    expect(await readFontFamilies(async () => Promise.reject(new Error('io')))).toEqual([]);
  });
});

describe('font folder scanning', () => {
  it('lists the standard folders per platform', () => {
    expect(fontDirectories('win32', { WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u')).toEqual([
      join('C:\\Windows', 'Fonts'),
      join('C:\\Users\\u\\AppData\\Local', 'Microsoft', 'Windows', 'Fonts'),
    ]);
    expect(fontDirectories('darwin', {}, '/Users/u')).toContain('/Library/Fonts');
    expect(fontDirectories('linux', {}, '/home/u')).toContain('/usr/share/fonts');
  });

  it('sorts, dedupes case-insensitively and drops hidden families', () => {
    expect(normalizeFamilies(['b', 'Arial', 'arial', '.SF NS', '  ', 'Courier New'])).toEqual(['Arial', 'b', 'Courier New']);
  });

  it('scans nested folders, ignores other files and missing folders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ob-fonts-'));
    try {
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'a.ttf'), new Uint8Array(sfnt(nameTable([win(1, 'Alpha')]), 0)));
      writeFileSync(join(dir, 'sub', 'b.OTF'), new Uint8Array(sfnt(nameTable([win(1, 'Beta')]), 0)));
      writeFileSync(join(dir, 'readme.txt'), 'not a font');
      writeFileSync(join(dir, 'broken.ttf'), 'garbage');
      expect(await scanFontFamilies([dir, join(dir, 'missing')])).toEqual(['Alpha', 'Beta']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
