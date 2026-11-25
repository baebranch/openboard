import { describe, expect, it } from 'vitest';
import { BoardModel } from '../ops';
import type { BoardDocument } from '../model/types';
import { extractDocument } from '../export/png-chunk';
import { DefaultToolRegistry } from './registry';
import { registerElementTools } from './element-tools';
import { registerExportTools, type ExportHost, type RasterizeOptions } from './export-tools';

const doc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
}
const FAKE_PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', new Array(13).fill(0)), ...chunk('IEND', [])]);

async function setup() {
  const model = new BoardModel('/b.openboard', doc());
  const calls: { svg: string; opts: RasterizeOptions }[] = [];
  const written: { path: string; bytes: Uint8Array }[] = [];
  const host: ExportHost = {
    async rasterize(svg, opts) {
      calls.push({ svg, opts });
      return opts.format === 'jpeg' ? Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) : FAKE_PNG;
    },
    async writeFile(path, bytes) {
      written.push({ path, bytes });
    },
  };
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerElementTools(reg);
  registerExportTools(reg, host);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  await run('openboard.element.create', {
    elements: [
      { type: 'frame', id: 'f1', name: 'A', x: 0, y: 0, width: 100, height: 100 },
      { type: 'frame', id: 'f2', name: 'B', x: 1000, y: 0, width: 100, height: 100 },
      { type: 'rectangle', id: 'r', x: 10, y: 10, width: 20, height: 20 },
    ],
  });
  return { model, reg, run, calls, written };
}

describe('export tools', () => {
  it('registers with the expected flags', async () => {
    const { reg } = await setup();
    expect(reg.def('openboard.export').writesElsewhere).toBe(true);
    expect(reg.def('openboard.board.preview').readOnly).toBe(true);
  });

  it('returns base64 data and mime type without writing, and does not touch history', async () => {
    const { run, calls, written, model } = await setup();
    const before = model.getDocument();
    const r = await run('openboard.export', { scale: 2 });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].mimeType).toBe('image/png');
    expect(Buffer.from(r.results[0].data, 'base64')).toEqual(Buffer.from(FAKE_PNG));
    expect(calls[0]!.opts.scale).toBe(2);
    expect(written).toHaveLength(0);
    expect(model.getDocument()).toBe(before);
  });

  it('writes through the host when path is given', async () => {
    const { run, written } = await setup();
    const r = await run('openboard.export', { format: 'svg', scope: 'frame', frameId: 'f1', path: '/out/a.svg' });
    expect(r.results[0]).toMatchObject({ mimeType: 'image/svg+xml', path: '/out/a.svg' });
    expect(r.results[0].data).toBeUndefined();
    expect(written).toHaveLength(1);
    expect(new TextDecoder().decode(written[0]!.bytes)).toContain('<svg');
  });

  it('allFrames yields one result and file per frame', async () => {
    const { run, written } = await setup();
    const r = await run('openboard.export', { format: 'svg', scope: 'allFrames', path: '/out/frames.svg' });
    expect(r.results.map((x: any) => x.frameId)).toEqual(['f1', 'f2']);
    expect(written.map((w) => w.path)).toEqual(['/out/frames-1.svg', '/out/frames-2.svg']);
  });

  it('embeds the board in PNG output', async () => {
    const { run } = await setup();
    const r = await run('openboard.export', { embedBoard: true });
    const png = new Uint8Array(Buffer.from(r.results[0].data, 'base64'));
    expect(extractDocument(png)).toContain('"f1"');
  });

  it('writes a PDF from a JPEG raster', async () => {
    const { run, calls } = await setup();
    const r = await run('openboard.export', { format: 'pdf' });
    expect(calls[0]!.opts.format).toBe('jpeg');
    expect(r.results[0].mimeType).toBe('application/pdf');
    expect(Buffer.from(r.results[0].data, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('reports export validation errors', async () => {
    const { run, model } = await setup();
    expect((await run('openboard.export', { padding: 300 })).error.code).toBe('invalid-padding');
    expect((await run('openboard.export', { format: 'jpeg', background: 'transparent' })).error.code).toBe('invalid-option');
    expect((await run('openboard.export', { scope: 'frame' })).error.code).toBe('invalid_input');
    expect((await run('openboard.export', { scope: 'frame', frameId: 'nope' })).error.code).toBe('empty-scope');
    expect((await run('openboard.export', { scale: 5 })).error.code).toBe('invalid_input');
    model.reset(doc());
    expect((await run('openboard.export', {})).error.code).toBe('empty-scope');
  });

  it('previews a region as PNG', async () => {
    const { run, calls } = await setup();
    const r = await run('openboard.board.preview', { region: { x: 500, y: -10, width: 800, height: 200 } });
    expect(r.mimeType).toBe('image/png');
    expect(typeof r.data).toBe('string');
    expect(calls[0]!.svg).toContain('data-id="f2"');
    expect(calls[0]!.svg).not.toContain('data-id="f1"');
    expect((await run('openboard.board.preview', { region: { x: 5000, y: 5000, width: 1, height: 1 } })).error.code).toBe(
      'empty-scope',
    );
  });
});
