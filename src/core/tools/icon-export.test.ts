import { describe, expect, it } from 'vitest';
import { BoardModel } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { renderToSvg } from '../export';
import { ICON_PATHS } from '../icons';
import { DefaultToolRegistry } from './registry';
import { registerElementTools } from './element-tools';
import { registerExportTools, type ExportHost } from './export-tools';

const emptyDoc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

async function setup() {
  const model = new BoardModel('/b.openboard', emptyDoc());
  const svgs: string[] = [];
  const host: ExportHost = {
    async rasterize(svg, opts) {
      svgs.push(svg);
      return opts.format === 'jpeg' ? JPEG : PNG;
    },
    async writeFile() {},
  };
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerElementTools(reg);
  registerExportTools(reg, host);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  await run('openboard.element.create', {
    elements: [{ type: 'icon', id: 'ic', name: 'activity', x: 10, y: 20, width: 48, height: 48, strokeWidth: 3, rotation: 30, opacity: 50 }],
  });
  return { run, svgs };
}

describe('icon export presence (Req 23.5)', () => {
  const activity = ICON_PATHS['activity']!;

  for (const format of ['svg', 'png', 'jpeg', 'webp', 'pdf'] as const) {
    it(`includes the icon in ${format} output with its geometry and stroke`, async () => {
      const { run, svgs } = await setup();
      const r = await run('openboard.export', { format, ...(format === 'png' || format === 'webp' ? { background: 'white' } : {}) });
      expect(r.error).toBeUndefined();
      const out = format === 'svg' ? Buffer.from(r.results[0].data, 'base64').toString('utf8') : svgs[0]!;
      expect(out).toContain(activity);
      expect(out).toContain('data-id="ic"');
      expect(out).toContain('rotate(30');
      expect(out).toContain('stroke-width="3"');
      expect(out).toContain('opacity="0.5"');
      if (format === 'pdf') expect(Buffer.from(r.results[0].data, 'base64').toString('latin1').startsWith('%PDF-')).toBe(true);
    });
  }
});

describe('icon stroke width independence from size (Req 23.4)', () => {
  const icon = (size: number): Element =>
    ({
      id: 'i',
      type: 'icon',
      name: 'check',
      x: 0,
      y: 0,
      width: size,
      height: size,
      rotation: 0,
      style: { fill: 'theme:default', stroke: '#112233', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 },
    }) as Element;

  it('writes the same stroke width, color and non-scaling stroke at every size', () => {
    const render = (size: number): string => {
      const r = renderToSvg({ elements: [icon(size)], assets: [] }, { kind: 'board' });
      if (!r.ok) throw new Error('render failed');
      return r.value.svg;
    };
    for (const size of [12, 24, 240]) {
      const svg = render(size);
      expect(svg).toContain('stroke-width="2"');
      expect(svg).toContain('stroke="#112233"');
      expect(svg).toContain('vector-effect="non-scaling-stroke"');
      expect(svg).toContain(`scale(${size / 24} ${size / 24})`);
    }
  });
});
