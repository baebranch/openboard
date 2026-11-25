/**
 * Task 27.7 (Req 28.11, 5.1, 5.3): one document exercising every Mockup feature (token colors/fonts, image fill,
 * per-corner radii, text weight/color/wrap, clipping, component instances, auto layout, icons) is exported as
 * SVG (structural), and PNG / JPEG / WebP / PDF (decoded pixels from a real Chromium engine, the same
 * SVG -> <img> -> canvas path as src/webview/export/rasterizer.ts). The pixel checks are skipped when no
 * Chromium-based browser is installed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { instanceChildId, syncPass } from '../../src/core/components/sync';
import { writePdf } from '../../src/core/export/pdf';
import { renderToSvg } from '../../src/core/export/svg';
import { ICON_PATHS } from '../../src/core/icons';
import { runLayoutPass } from '../../src/core/layout/run-layout-pass';
import type { Asset, BoardDocument, Element } from '../../src/core/model/types';

const CANDIDATES = [
  process.env.CHROMIUM_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = CANDIDATES.find((p): p is string => !!p && existsSync(p));

// ---- fixture ---------------------------------------------------------------------------------------------

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
/** Solid-red 8x8 PNG. */
function redPng(): string {
  const n = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: n }, () => [255, 0, 0]).flat())]);
  const raw = Buffer.concat(Array.from({ length: n }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

const asset: Asset = { id: 'img1', mime: 'image/png', hash: '0'.repeat(64), width: 8, height: 8, data: redPng() };
const base = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 0, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const el = (id: string, type: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}, style: Record<string, unknown> = {}): Element =>
  ({ id, type, x, y, width: w, height: h, rotation: 0, style: { ...base, ...style }, ...extra }) as unknown as Element;

const ICON = 'archive';
const raw: Element[] = [
  // Row 1
  el('tok', 'rectangle', 0, 0, 40, 40, {}, { fill: 'token:brand' }), // light #00ff00 / dark #0000ff
  el('img', 'rectangle', 60, 0, 40, 40, {}, { imageFill: { assetId: 'img1', fit: 'stretch' }, cornerRadii: [20, 0, 0, 0] }),
  el('rad', 'rectangle', 120, 0, 40, 40, {}, { fill: '#0000ff', cornerRadii: [0, 20, 0, 20] }),
  el('ico', 'icon', 180, 0, 40, 40, { name: ICON }, { stroke: 'token:ink', strokeWidth: 3 }), // ink = #0000ff
  el('clip', 'frame', 280, 0, 40, 40, { name: 'clip', clipContent: true }, { cornerRadii: [20, 0, 0, 0] }),
  el('clipChild', 'rectangle', 270, -10, 60, 60, { parentId: 'clip' }, { fill: '#ff0000' }),
  // Row 2: master, instance with a fill override, layout frame
  el('M', 'frame', 0, 100, 40, 40, { name: 'M', component: 'Card' }),
  el('c1', 'rectangle', 5, 105, 30, 30, { parentId: 'M' }, { fill: '#ff0000' }),
  el('I', 'frame', 60, 100, 40, 40, { name: 'I', instanceOf: 'M', overrides: { c1: { fill: '#0000ff' } } }),
  el(
    'L',
    'frame',
    120,
    100,
    100,
    40,
    { name: 'L', layout: { direction: 'horizontal', gap: 10, padding: { top: 5, right: 5, bottom: 5, left: 5 }, mainAlign: 'start', crossAlign: 'start' } },
  ),
  el('la', 'rectangle', 0, 0, 20, 30, { parentId: 'L' }, { fill: '#ff0000' }),
  el('lb', 'rectangle', 0, 0, 20, 30, { parentId: 'L' }, { fill: '#0000ff' }),
  // Row 3: wrapped, weighted, colored text with a token font
  el('txt', 'text', 0, 200, 40, 100, {
    runs: [{ text: 'MM MM' }],
    fontFamily: 'token:body',
    fontSize: 30,
    align: 'left',
    fontWeight: 700,
    textColor: 'token:accent',
    textWrap: 'wrap',
  }),
];

const tokens = {
  colors: { brand: { light: '#00ff00', dark: '#0000ff' }, ink: '#0000ff', accent: '#ff00ff' },
  fonts: { body: 'serif' },
};

function buildDoc(): BoardDocument {
  const doc = { elements: raw, assets: [asset], library: [], tokens } as unknown as BoardDocument;
  return runLayoutPass(syncPass(doc).doc).doc;
}
const doc = buildDoc();
const byId = (id: string): Element => doc.elements.find((e) => e.id === id)!;
const render = (opts: Parameters<typeof renderToSvg>[2] = {}) => {
  const r = renderToSvg(doc, doc.elements, opts);
  if (!r.ok) throw new Error('render failed');
  return r.value;
};

// ---- SVG (structural) -------------------------------------------------------------------------------------

describe('Mockup features in SVG export (Req 28.11, 5.1, 5.3)', () => {
  const { svg } = render();

  it('resolves token colors, fonts and the text color to literals (no token references leak)', () => {
    expect(svg).not.toContain('token:');
    expect(svg).toMatch(/data-id="tok"[^>]*><rect[^>]*fill="#00ff00"/);
    expect(svg).toContain('font-family="serif"');
    expect(svg).toContain('fill="#ff00ff"');
  });

  it('follows the requested token mode', () => {
    expect(render({ tokenMode: 'dark' }).svg).toMatch(/data-id="tok"[^>]*><rect[^>]*fill="#0000ff"/);
    expect(render({ tokenMode: 'light' }).svg).toMatch(/data-id="tok"[^>]*><rect[^>]*fill="#00ff00"/);
  });

  it('draws the image fill clipped to the outline with the corner path', () => {
    expect(svg).toMatch(/<clipPath id="clip-img"><path d="[^"]*A 20 20[^"]*"\/><\/clipPath>/);
    expect(svg).toContain(`<image href="data:image/png;base64,${asset.data}"`);
    expect(svg).toContain('clip-path="url(#clip-img)"');
  });

  it('draws per-corner radii as arcs only on the requested corners', () => {
    const d = /data-id="rad"[^>]*><path d="([^"]*)"/.exec(svg)![1]!;
    expect(d.match(/ A /g)).toHaveLength(2);
    expect(d).toContain('A 20 20 0 0 1 160 20'); // top-right
    expect(d).toContain('A 20 20 0 0 1 120 20'); // bottom-left ends at the left edge
  });

  it('draws the Icon path scaled to its box with the token stroke', () => {
    const m = /data-id="ico"[^>]*><path d="([^"]*)" transform="translate\(180 0\) scale\(1\.667 1\.667\)"[^>]*stroke="#0000ff" stroke-width="3"/.exec(svg);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(ICON_PATHS[ICON]);
  });

  it('wraps the clipped child in the Frame clip path with its corner radius', () => {
    expect(svg).toMatch(/<clipPath id="clipc-clip"><path d="[^"]*A 20 20/);
    expect(svg).toContain('<g clip-path="url(#clipc-clip)"><g data-id="clipChild"');
  });

  it('emits weight, wrapped lines, and the Instance with its override', () => {
    expect(svg).toContain('font-weight="700"');
    expect((/data-id="txt"[^>]*>(.*?)<\/g><\/g>/s.exec(svg)![1]!.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(2);
    const child = instanceChildId('I', 'c1');
    expect(svg).toMatch(new RegExp(`data-id="${child.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*><rect[^>]*fill="#0000ff"`));
    expect(svg).toMatch(/data-id="c1"[^>]*><rect[^>]*fill="#ff0000"/);
  });

  it('exports the laid-out child positions', () => {
    const a = byId('la');
    const b = byId('lb');
    expect([a.x, a.y]).toEqual([125, 105]);
    expect([b.x, b.y]).toEqual([155, 105]);
    expect(svg).toMatch(/data-id="lb"[^>]*><rect x="155" y="105"/);
  });
});

// ---- raster formats and PDF (real engine) ------------------------------------------------------------------

type Mime = 'image/png' | 'image/jpeg' | 'image/webp';

function inBrowser<T>(body: string): T {
  const dir = mkdtempSync(join(tmpdir(), 'ob-mockx-'));
  try {
    const html = `<!doctype html><body><script>
(async()=>{try{const out=await (async()=>{${body}})();document.body.textContent='RESULT'+JSON.stringify(out)+'END';}
catch(e){document.body.textContent='RESULTERROREND';}})();
</script></body>`;
    const file = join(dir, 'p.html');
    writeFileSync(file, html);
    let last = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const timing = attempt === 0 ? '--virtual-time-budget=20000' : '--timeout=15000';
      const r = spawnSync(
        browser!,
        ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${join(dir, `ud${attempt}`)}`, timing, '--dump-dom', `file:///${file.replace(/\\/g, '/')}`],
        { encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024 * 1024 },
      );
      last = `${r.stderr}\n${r.stdout}`;
      const m = /<body>RESULT([[{].*?)END/s.exec(r.stdout ?? '');
      if (m) return JSON.parse(m[1]!) as T;
      if (/<body>RESULTERROREND/.test(r.stdout ?? '')) throw new Error(`browser script failed:\n${last}`);
    }
    throw new Error(`browser run did not settle:\n${last}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DECODE_FN = `
const sample=async(url,w,h,pts)=>{const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(new Error('decode'));img.src=url;});
const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.drawImage(img,0,0,w,h);
return pts.map(([px,py])=>Array.from(x.getImageData(px,py,1,1).data));};`;

function encodeAndSample(svg: string, w: number, h: number, mime: Mime, points: [number, number][]): { px: number[][]; mimeOk: boolean; b64: string } {
  return inBrowser(`${DECODE_FN}
const url=URL.createObjectURL(new Blob([${JSON.stringify(svg)}],{type:'image/svg+xml;charset=utf-8'}));
const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(new Error('svg'));img.src=url;});
const c=document.createElement('canvas');c.width=${w};c.height=${h};const x=c.getContext('2d');
x.fillStyle='#ffffff';x.fillRect(0,0,${w},${h});x.drawImage(img,0,0,${w},${h});
const dataUrl=c.toDataURL(${JSON.stringify(mime)},0.95);
const prefix=${JSON.stringify(`data:${mime};base64,`)};
const mimeOk=dataUrl.startsWith(prefix);
const b64=mimeOk?dataUrl.slice(prefix.length):'';
const px=mimeOk?await sample(dataUrl,${w},${h},${JSON.stringify(points)}):[];
return {px,mimeOk,b64};`);
}

function sampleEncoded(b64: string, mime: string, w: number, h: number, points: [number, number][]): number[][] {
  return inBrowser(`${DECODE_FN}return await sample(${JSON.stringify(`data:${mime};base64,${b64}`)},${w},${h},${JSON.stringify(points)});`);
}

type Px = number[];
const isRed = (p: Px) => p[0]! > 200 && p[1]! < 70 && p[2]! < 70;
const isBlue = (p: Px) => p[2]! > 200 && p[0]! < 70 && p[1]! < 70;
const isGreen = (p: Px) => p[1]! > 200 && p[0]! < 70 && p[2]! < 70;
const isWhite = (p: Px) => p[0]! > 190 && p[1]! > 190 && p[2]! > 190;
const isMagenta = (p: Px) => p[0]! > 170 && p[2]! > 170 && p[1]! < 120;

interface Check {
  name: string;
  /** Board-space sample points. */
  pts: [number, number][];
  /** True when the sampled pixels (any/all) satisfy the feature. */
  mode: 'all' | 'some';
  test: (p: Px) => boolean;
}
const grid = (x0: number, y0: number, x1: number, y1: number, step: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) out.push([x, y]);
  return out;
};
const CHECKS: Check[] = [
  { name: 'token color (light mode) fills the rectangle', pts: [[20, 20], [8, 8], [32, 32]], mode: 'all', test: isGreen },
  { name: 'image fill paints the asset', pts: [[80, 20], [95, 35], [95, 5]], mode: 'all', test: isRed },
  { name: 'image fill follows the top-left corner radius', pts: [[62, 2]], mode: 'all', test: isWhite },
  { name: 'per-corner radius leaves TL square', pts: [[123, 3]], mode: 'all', test: isBlue },
  { name: 'per-corner radius rounds TR', pts: [[158, 2]], mode: 'all', test: isWhite },
  { name: 'per-corner radius leaves BR square', pts: [[157, 37]], mode: 'all', test: isBlue },
  { name: 'per-corner radius rounds BL', pts: [[122, 38]], mode: 'all', test: isWhite },
  { name: 'icon strokes draw in the token ink color', pts: grid(180, 0, 220, 40, 2), mode: 'some', test: isBlue },
  { name: 'clip frame keeps the child inside', pts: [[300, 20], [315, 35]], mode: 'all', test: isRed },
  { name: 'clip frame cuts the child outside and at the rounded corner', pts: [[272, 20], [325, 50 - 1], [282, 2], [300, -8]], mode: 'all', test: isWhite },
  { name: 'master keeps its own fill', pts: [[20, 120]], mode: 'all', test: isRed },
  { name: 'instance renders the overridden fill', pts: [[80, 120]], mode: 'all', test: isBlue },
  { name: 'layout places the first child', pts: [[135, 120]], mode: 'all', test: isRed },
  { name: 'layout places the second child after the gap', pts: [[165, 120]], mode: 'all', test: isBlue },
  { name: 'layout leaves the gap empty', pts: [[150, 120], [122, 120]], mode: 'all', test: isWhite },
  { name: 'wrapped text colored by token occupies a second line', pts: grid(0, 242, 60, 272, 2), mode: 'some', test: isMagenta },
  { name: 'text color pixels appear on the first line', pts: grid(0, 205, 40, 232, 2), mode: 'some', test: isMagenta },
];

function verify(px: number[][], index: Map<Check, [number, number]>, label: string): void {
  for (const c of CHECKS) {
    const [from, len] = index.get(c)!;
    const slice = px.slice(from, from + len);
    const ok = c.mode === 'all' ? slice.every(c.test) : slice.some(c.test);
    expect(ok, `${label}: ${c.name}; pixels ${JSON.stringify(c.mode === 'all' ? slice : slice.slice(0, 6))}`).toBe(true);
  }
}

describe.skipIf(!browser)('Mockup features in raster formats and PDF (real engine, Req 28.11, 5.1, 5.3)', () => {
  const out = render();
  const points: [number, number][] = [];
  const index = new Map<Check, [number, number]>();
  for (const c of CHECKS) {
    index.set(c, [points.length, c.pts.length]);
    for (const [x, y] of c.pts) points.push([Math.round(x - out.bounds.x), Math.round(y - out.bounds.y)]);
  }

  for (const [label, mime] of [
    ['PNG', 'image/png'],
    ['JPEG', 'image/jpeg'],
    ['WebP', 'image/webp'],
  ] as const) {
    it(`${label} renders every Mockup feature`, () => {
      const r = encodeAndSample(out.svg, out.width, out.height, mime, points);
      expect(r.mimeOk, `${mime} encoder unavailable`).toBe(true);
      verify(r.px, index, label);
    }, 240_000);
  }

  it('PDF page embeds a raster that renders every Mockup feature', () => {
    const enc = encodeAndSample(out.svg, out.width, out.height, 'image/jpeg', []);
    const jpeg = new Uint8Array(Buffer.from(enc.b64, 'base64'));
    const pdf = Buffer.from(writePdf([{ width: out.width, height: out.height, pixelWidth: out.width, pixelHeight: out.height, jpeg }]));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/DCTDecode');
    const idx = pdf.indexOf(Buffer.from(jpeg));
    expect(idx).toBeGreaterThan(0);
    const embedded = pdf.subarray(idx, idx + jpeg.length).toString('base64');
    verify(sampleEncoded(embedded, 'image/jpeg', out.width, out.height, points), index, 'PDF');
  }, 240_000);
});
