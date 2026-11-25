/**
 * Reads font family names from TrueType / OpenType files and collections (.ttf, .otf, .ttc, .otc)
 * through a random-access reader, so only the header, the table directory and the `name` table are
 * read, never whole font files. Pure: no fs, vscode, or process access.
 */

/** Reads `length` bytes at `offset`; may return fewer at the end of the file. */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

const TAG_TTCF = 0x74746366; // 'ttcf'
const TAG_NAME = 0x6e616d65; // 'name'
const SFNT_VERSIONS = new Set([0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */, 0x74797031 /* typ1 */]);

/** Upper bounds that keep a malformed or hostile file from causing large reads. */
const MAX_FONTS_IN_COLLECTION = 64;
const MAX_TABLES = 512;
const MAX_NAME_TABLE_BYTES = 512 * 1024;

const NAME_TYPOGRAPHIC_FAMILY = 16;
const NAME_FAMILY = 1;
const LANG_EN_US = 0x0409;

const u16 = (b: Uint8Array, o: number): number => (o + 2 <= b.length ? (b[o]! << 8) | b[o + 1]! : -1);
const u32 = (b: Uint8Array, o: number): number => (o + 4 <= b.length ? ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]! : -1);

function utf16be(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i]! << 8) | b[i + 1]!);
  return s;
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

interface NameCandidate {
  text: string;
  /** Lower is better. */
  rank: number;
}

/**
 * Picks the family name from a `name` table: the typographic family (ID 16) before the legacy
 * family (ID 1), Windows/Unicode US-English before other languages, Unicode before Mac Roman.
 */
export function familyFromNameTable(table: Uint8Array): string | undefined {
  const count = u16(table, 2);
  const stringOffset = u16(table, 4);
  if (count < 0 || stringOffset < 0) return undefined;
  let best: NameCandidate | undefined;
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = u16(table, r);
    const encoding = u16(table, r + 2);
    const language = u16(table, r + 4);
    const nameId = u16(table, r + 6);
    const length = u16(table, r + 8);
    const offset = u16(table, r + 10);
    if (offset < 0) break;
    if (nameId !== NAME_TYPOGRAPHIC_FAMILY && nameId !== NAME_FAMILY) continue;
    const start = stringOffset + offset;
    if (length <= 0 || start + length > table.length) continue;
    const bytes = table.subarray(start, start + length);
    let text: string;
    let rank: number;
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      text = utf16be(bytes);
      rank = language === LANG_EN_US ? 0 : 2;
    } else if (platform === 0) {
      text = utf16be(bytes);
      rank = 1;
    } else if (platform === 1 && encoding === 0) {
      text = latin1(bytes);
      rank = language === 0 ? 3 : 4;
    } else {
      continue;
    }
    if (nameId === NAME_FAMILY) rank += 10;
    text = text.replace(/\u0000/g, '').trim();
    if (text === '') continue;
    if (!best || rank < best.rank) best = { text, rank };
  }
  return best?.text;
}

/** Family name of the single font whose table directory starts at `base`. */
async function familyAt(read: ByteReader, base: number): Promise<string | undefined> {
  const head = await read(base, 12);
  if (!SFNT_VERSIONS.has(u32(head, 0))) return undefined;
  const numTables = u16(head, 4);
  if (numTables <= 0 || numTables > MAX_TABLES) return undefined;
  const dir = await read(base + 12, numTables * 16);
  for (let i = 0; i < numTables; i++) {
    const r = i * 16;
    if (u32(dir, r) !== TAG_NAME) continue;
    const offset = u32(dir, r + 8);
    const length = u32(dir, r + 12);
    if (offset < 0 || length <= 0) return undefined;
    return familyFromNameTable(await read(offset, Math.min(length, MAX_NAME_TABLE_BYTES)));
  }
  return undefined;
}

/** Every family name in a font file or collection (deduplicated, in file order). Never throws. */
export async function readFontFamilies(read: ByteReader): Promise<string[]> {
  try {
    const head = await read(0, 12);
    const bases: number[] = [];
    if (u32(head, 0) === TAG_TTCF) {
      const n = Math.min(u32(head, 8), MAX_FONTS_IN_COLLECTION);
      if (n <= 0) return [];
      const offsets = await read(12, n * 4);
      for (let i = 0; i < n; i++) {
        const o = u32(offsets, i * 4);
        if (o >= 0) bases.push(o);
      }
    } else {
      bases.push(0);
    }
    const out: string[] = [];
    for (const b of bases) {
      const name = await familyAt(read, b);
      if (name !== undefined && !out.includes(name)) out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

/** Reader over an in-memory buffer (tests, small files). */
export function bufferReader(buf: Uint8Array): ByteReader {
  return async (offset, length) => buf.subarray(Math.max(0, offset), Math.max(0, offset) + Math.max(0, length));
}
