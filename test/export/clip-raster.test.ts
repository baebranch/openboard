/**
 * Empirical check (task 7.4, Req 10.4/10.5): nested clipping Frames, exported through the same path the
 * rasterizer uses (SVG blob URL -> <img> -> canvas, see src/webview/export/rasterizer.ts; the PDF page path
 * feeds that same SVG string through the same function), must clip to the intersection of both Frames.
 *
 * The real engine is Chromium (the VS Code webview), so this drives a locally installed Chromium-based
 * browser headlessly and reads canvas pixels. It is skipped when no such browser is installed.
 *
 * Finding: Chromium honors `clip-path` on a `<clipPath>` element, so svg.ts keeps nested `<clipPath>`
 * definitions and no per-level `<g clip-path>` wrapping is needed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Element } from '../../src/core/model/types';
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
const box = (id: string, x: number, y: number, w: number, h: number) => ({ id, x, y, width: w, height: h, rotation: 0, style: { ...style } });

/** Rasterizes `svg` (width x height) and samples board-space `points` (translated by the export origin). */
function pixels(svg: string, width: number, height: number, origin: { x: number; y: number }, points: [number, number][]): number[][] {
  points = points.map(([x, y]) => [x - origin.x, y - origin.y]);
  const dir = mkdtempSync(join(tmpdir(), 'ob-clip-'));
  try {
    const html =
      `<!doctype html><body><script>
const svg=${JSON.stringify(svg)};
const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
const img=new Image();
img.onload=()=>{const c=document.createElement('canvas');c.width=${width};c.height=${height};const x=c.getContext('2d');
x.fillStyle='#ffffff';x.fillRect(0,0,${width},${height});x.drawImage(img,0,0,${width},${height});
const out=${JSON.stringify(points)}.map(([px,py])=>Array.from(x.getImageData(px,py,1,1).data));
document.body.textContent='RESULT'+JSON.stringify(out)+'END';};
img.onerror=()=>{document.body.textContent='RESULTERROREND';};
img.src=url;
</script></body>`;
    const file = join(dir, 'p.html');
    writeFileSync(file, html);
    const r = spawnSync(
      browser!,
      ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${join(dir, 'ud')}`, '--virtual-time-budget=5000', '--dump-dom', `file:///${file.replace(/\\/g, '/')}`],
      { encoding: 'utf8', timeout: 60_000 },
    );
    const m = /RESULT(.*?)END/s.exec(r.stdout ?? '');
    if (!m || m[1] === 'ERROR') throw new Error(`rasterization failed: ${r.stderr}\n${r.stdout}`);
    return JSON.parse(m[1]!) as number[][];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!browser)('nested clip rasterization (real engine)', () => {
  it('clips a descendant to the intersection of two nested clipping Frames', () => {
    const els: Element[] = [
      { ...box('A', 0, 0, 100, 100), type: 'frame', name: 'A', clipContent: true },
      { ...box('B', 50, 50, 100, 100), type: 'frame', name: 'B', clipContent: true, parentId: 'A' },
      { ...box('R', 0, 0, 200, 200), type: 'rectangle', parentId: 'B', style: { ...style, fill: '#ff0000' } },
    ];
    const r = renderToSvg({ elements: els, assets: [] }, { kind: 'board' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [inside, inAOnly, inBOnly, outside] = pixels(r.value.svg, r.value.width, r.value.height, r.value.bounds, [
      [75, 75], // in A and B
      [25, 25], // in A, outside B
      [125, 125], // in B, outside A
      [175, 175], // outside both
    ]);
    expect(inside).toEqual([255, 0, 0, 255]);
    expect(inAOnly).toEqual([255, 255, 255, 255]);
    expect(inBOnly).toEqual([255, 255, 255, 255]);
    expect(outside).toEqual([255, 255, 255, 255]);
  }, 90_000);
});
