import { deflateSync, inflateSync } from 'node:zlib';

/** Keyword of the custom iTXt chunk that carries the document JSON (Req 12.8). */
export const OPENBOARD_KEYWORD = 'openboard';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  return crcTable;
}

/** CRC32 over the given bytes (PNG variant). */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (table[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface Chunk {
  type: string;
  start: number; // offset of the length field
  end: number; // offset just past the CRC
  dataStart: number;
  dataEnd: number;
}

function readU32(b: Uint8Array, o: number): number {
  return (((b[o] as number) << 24) | ((b[o + 1] as number) << 16) | ((b[o + 2] as number) << 8) | (b[o + 3] as number)) >>> 0;
}

function hasSignature(png: Uint8Array): boolean {
  if (png.length < SIGNATURE.length) return false;
  return SIGNATURE.every((v, i) => png[i] === v);
}

function parseChunks(png: Uint8Array): Chunk[] {
  if (!hasSignature(png)) throw new Error('Not a PNG: bad signature');
  const chunks: Chunk[] = [];
  let pos = SIGNATURE.length;
  while (pos < png.length) {
    if (pos + 12 > png.length) throw new Error('Malformed PNG: truncated chunk');
    const len = readU32(png, pos);
    const end = pos + 12 + len;
    if (end > png.length) throw new Error('Malformed PNG: chunk exceeds file');
    const type = String.fromCharCode(png[pos + 4] as number, png[pos + 5] as number, png[pos + 6] as number, png[pos + 7] as number);
    chunks.push({ type, start: pos, end, dataStart: pos + 8, dataEnd: pos + 8 + len });
    pos = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function chunkKeyword(png: Uint8Array, c: Chunk): string | undefined {
  if (c.type !== 'iTXt') return undefined;
  let i = c.dataStart;
  while (i < c.dataEnd && png[i] !== 0) i++;
  if (i >= c.dataEnd) return undefined;
  return new TextDecoder('latin1').decode(png.subarray(c.dataStart, i));
}

/**
 * Embeds the document JSON in a compressed iTXt chunk (keyword `openboard`)
 * placed immediately before IEND. Any previous openboard chunk is replaced.
 * All other bytes, including pixel data, are preserved unchanged.
 */
export function embedDocument(png: Uint8Array, json: string): Uint8Array {
  const chunks = parseChunks(png);
  const iend = chunks.find((c) => c.type === 'IEND');
  if (!iend) throw new Error('Malformed PNG: missing IEND');

  const keyword = new TextEncoder().encode(OPENBOARD_KEYWORD);
  const compressed = new Uint8Array(deflateSync(new TextEncoder().encode(json)));
  // keyword, NUL, compression flag=1, method=0, empty language tag + NUL, empty translated keyword + NUL, text
  const data = concat([keyword, Uint8Array.of(0, 1, 0, 0, 0), compressed]);
  const chunk = makeChunk('iTXt', data);

  const parts: Uint8Array[] = [png.subarray(0, SIGNATURE.length)];
  for (const c of chunks) {
    if (c === iend) {
      parts.push(chunk);
    }
    if (chunkKeyword(png, c) === OPENBOARD_KEYWORD) continue;
    parts.push(png.subarray(c.start, c.end));
  }
  return concat(parts);
}

/** Extracts the embedded document JSON, or `undefined` if none is present. */
export function extractDocument(png: Uint8Array): string | undefined {
  for (const c of parseChunks(png)) {
    if (chunkKeyword(png, c) !== OPENBOARD_KEYWORD) continue;
    let i = c.dataStart + OPENBOARD_KEYWORD.length + 1;
    const compressedFlag = png[i++];
    const method = png[i++];
    while (i < c.dataEnd && png[i] !== 0) i++; // language tag
    i++;
    while (i < c.dataEnd && png[i] !== 0) i++; // translated keyword
    i++;
    if (i > c.dataEnd) return undefined;
    const text = png.subarray(i, c.dataEnd);
    if (compressedFlag === 1) {
      if (method !== 0) return undefined;
      return new TextDecoder('utf-8').decode(inflateSync(text));
    }
    return new TextDecoder('utf-8').decode(text);
  }
  return undefined;
}
