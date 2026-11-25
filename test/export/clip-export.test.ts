/**
 * Task 7.8 (Req 10.4, 10.6): a clipping Frame's descendants must not paint outside the Frame shape (including
 * its rounded corners) in every export format: SVG (structural), and PNG, JPEG, WebP and PDF (decoded pixels
 * from the real Chromium engine, via the same SVG -> <img> -> canvas path as src/webview/export/rasterizer.ts).
 * The raster checks are skipped when no Chromium-based browser is installed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Element } from '../../src/core/model/types';
import { writePdf } from '../../src/core/export/pdf';
import { renderToSvg } from '../../src/core/export/svg';

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

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 0, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const box = (id: string, x: number, y: number, w: number, h: number, cornerRadius = 0) => ({
  id,
  x,
  y,
  width: w,
  height: h,
  rotation: 0,
  style: { ...style, cornerRadius },
});

// Frame is 100x100 with 30px corner radii; the red child extends far beyond it.
const elements: Element[] = [
  { ...box('F', 0, 0, 100, 100, 30), type: 'frame', name: 'F', clipContent: true },
  { ...box('R', -50, -50, 300, 300), type: 'rectangle', parentId: 'F', style: { ...style, fill: '#ff0000' } },
  // Unclipped sibling anchoring the export bounds so the raster is larger than the Frame.
  { ...box('Z', 180, 180, 20, 20), type: 'rectangle', style: { ...style, fill: '#ffffff' } },
];

const render = () => {
  const r = renderToSvg({ elements, assets: [] }, { kind: 'board' });
  if (!r.ok) throw new Error('render failed');
  return r.value;
};

/** [name, board-space point, expected: red inside the Frame shape, white outside]. */
const SAMPLES: [string, [number, number], 'red' | 'white'][] = [
  ['frame centre', [50, 50], 'red'],
  ['inside near edge', [90, 50], 'red'],
  ['right of the frame', [120, 50], 'white'],
  ['below the frame', [50, 120], 'white'],
  ['above-left outside', [-10, -10], 'white'],
  ['rounded corner cut (inside bbox, outside shape)', [3, 3], 'white'],
  ['rounded corner cut bottom-right', [97, 97], 'white'],
  ['far outside', [150, 150], 'white'],
];

type Mime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Runs `body` (a script returning JSON) in headless Chromium and returns the parsed result. */
function inBrowser<T>(body: string): T {
  const dir = mkdtempSync(join(tmpdir(), 'ob-clipx-'));
  try {
    const html = `<!doctype html><body><script>
(async()=>{try{const out=await (async()=>{${body}})();document.body.textContent='RESULT'+JSON.stringify(out)+'END';}
catch(e){document.body.textContent='RESULTERROREND';}})();
</script></body>`;
    const file = join(dir, 'p.html');
    writeFileSync(file, html);
    // Headless virtual time can end before an async encode settles (the DOM then still holds the script
    // source), so retry a few times; only a settled RESULT<json>END payload counts.
    let last = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      // Attempt 0 uses virtual time (fast); later attempts use real time, which lets native encoders (WebP) finish.
      const timing = attempt === 0 ? '--virtual-time-budget=20000' : '--timeout=15000';
      const r = spawnSync(
        browser!,
        ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${join(dir, `ud${attempt}`)}`, timing, '--dump-dom', `file:///${file.replace(/\\/g, '/')}`],
        { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
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

/** Rasterizes the SVG, encodes to `mime`, decodes the encoded bytes again and samples `points`. Also returns the encoded base64. */
function encodeAndSample(svg: string, w: number, h: number, mime: Mime, points: [number, number][]): { px: number[][]; mimeOk: boolean; b64: string } {
  return inBrowser(`${DECODE_FN}
const url=URL.createObjectURL(new Blob([${JSON.stringify(svg)}],{type:'image/svg+xml;charset=utf-8'}));
const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(new Error('svg'));img.src=url;});
const c=document.createElement('canvas');c.width=${w};c.height=${h};const x=c.getContext('2d');
x.fillStyle='#ffffff';x.fillRect(0,0,${w},${h});x.drawImage(img,0,0,${w},${h});
// toDataURL encodes synchronously; toBlob encodes off-thread, which headless virtual time does not wait for (WebP).
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

/** Red-ish / white-ish with tolerance for lossy codecs. */
function classify(p: number[]): 'red' | 'white' | 'other' {
  const [r, g, b] = p as [number, number, number];
  if (r > 220 && g < 40 && b < 40) return 'red';
  if (r > 215 && g > 215 && b > 215) return 'white';
  return 'other';
}

function expectClipped(pixels: number[][], points: [number, number][]): void {
  SAMPLES.forEach(([name, , want], i) => {
    expect(classify(pixels[i]!), `${name} at ${JSON.stringify(points[i])} was ${JSON.stringify(pixels[i])}`).toBe(want);
  });
}

describe('clip export: SVG (Req 10.4, 10.6)', () => {
  it('wraps the clipped descendant in a clip-path bound to the Frame shape with its corner radius', () => {
    const { svg } = render();
    expect(svg).toMatch(/<clipPath id="clipc-F">.*?<\/clipPath>/);
    const def = /<clipPath id="clipc-F">(.*?)<\/clipPath>/.exec(svg)![1]!;
    expect(def).toContain('rx="30"');
    expect(svg).toContain('<g clip-path="url(#clipc-F)"><g data-id="R"');
    // The Frame itself and the unclipped sibling are not wrapped.
    expect(svg).not.toContain('<g clip-path="url(#clipc-F)"><g data-id="F"');
    expect(svg).not.toContain('<g clip-path="url(#clipc-F)"><g data-id="Z"');
  });

  it('draws Edges without clipping (Req 10.6)', () => {
    const els: Element[] = [
      { ...box('F', 0, 0, 100, 100), type: 'frame', name: 'F', clipContent: true },
      { ...box('A', 10, 10, 20, 20), type: 'rectangle', parentId: 'F' },
      { ...box('B', 200, 10, 20, 20), type: 'rectangle' },
      { ...box('E', 0, 0, 0, 0), type: 'edge', sourceId: 'A', targetId: 'B', parentId: 'F' } as unknown as Element,
    ];
    const r = renderToSvg({ elements: els, assets: [] }, { kind: 'board' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.svg).not.toContain('<g clip-path="url(#clipc-F)"><g data-id="E"');
    expect(r.value.svg).toContain('data-id="E"');
  });
});

describe.skipIf(!browser)('clip export: raster formats (real engine, Req 10.4)', () => {
  const svg = render();
  const points = SAMPLES.map(([, p]) => [p[0] - svg.bounds.x, p[1] - svg.bounds.y] as [number, number]);

  for (const [label, mime] of [
    ['PNG', 'image/png'],
    ['JPEG', 'image/jpeg'],
    ['WebP', 'image/webp'],
  ] as const) {
    it(`${label} has no descendant pixel outside the Frame shape`, () => {
      const out = encodeAndSample(svg.svg, svg.width, svg.height, mime, points);
      expect(out.mimeOk, `${mime} encoder unavailable`).toBe(true);
      expectClipped(out.px, points);
    }, 240_000);
  }

  it('PDF page (JPEG raster of the same SVG) has no descendant pixel outside the Frame shape', () => {
    const enc = encodeAndSample(svg.svg, svg.width, svg.height, 'image/jpeg', points);
    const jpeg = new Uint8Array(Buffer.from(enc.b64, 'base64'));
    const pdf = writePdf([{ width: svg.width, height: svg.height, pixelWidth: svg.width, pixelHeight: svg.height, jpeg }]);
    // The embedded DCT stream must be exactly the clipped raster.
    const idx = Buffer.from(pdf).indexOf(Buffer.from(jpeg));
    expect(idx).toBeGreaterThan(0);
    const embedded = Buffer.from(pdf).subarray(idx, idx + jpeg.length).toString('base64');
    expectClipped(sampleEncoded(embedded, 'image/jpeg', svg.width, svg.height, points), points);
  }, 120_000);
});
