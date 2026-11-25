/**
 * Generates media/icon.png (128x128, the marketplace icon required by vsce) without any
 * image dependency: draws the board glyph into an RGBA buffer and encodes a PNG with zlib.
 * Usage: node scripts/gen-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 128;
const px = Buffer.alloc(N * N * 4);
const BG = [0xc0, 0x1f, 0x2e, 255];
const FG = [255, 255, 255, 255];

function set(x, y, c) {
  const i = (y * N + x) * 4;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
  px[i + 3] = c[3];
}
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) set(x, y, BG);

// Board outline (rounded-ish rectangle border), a filled rectangle and a ring.
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const inOuter = x >= 16 && x < 112 && y >= 22 && y < 106;
    const inInner = x >= 24 && x < 104 && y >= 30 && y < 98;
    if (inOuter && !inInner) set(x, y, FG);
    if (x >= 36 && x < 64 && y >= 44 && y < 64) set(x, y, FG);
    const d = Math.hypot(x - 80, y - 74);
    if (d <= 16 && d >= 9) set(x, y, FG);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'media', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
