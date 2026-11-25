import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { BoardModel } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { embedDocument } from '../export/png-chunk';
import { setBoardValidator } from '../format';
import { DefaultToolRegistry } from './registry';
import { registerLayoutTools } from './layout-tools';
import { registerImportTools } from './import-tools';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const doc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

function setup(d: BoardDocument = doc()) {
  const model = new BoardModel('/b.openboard', d);
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerLayoutTools(reg);
  registerImportTools(reg);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  return { model, reg, run };
}
const els = (m: BoardModel): any[] => m.getDocument().elements;

const flow = (id: string, x = 0, y = 0): Element =>
  ({ id, type: 'flowNode', x, y, width: 100, height: 50, rotation: 0, style, runs: [{ text: id }], fontFamily: 'sans-serif', fontSize: 16, align: 'center', preset: 'process' }) as Element;
const edge = (id: string, s: string, t: string): Element =>
  ({ id, type: 'edge', x: 0, y: 0, width: 0, height: 0, rotation: 0, style, sourceId: s, targetId: t, routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow' }) as Element;

// 1x1 PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('openboard.layout', () => {
  it('lays out flow nodes in one transaction in the chosen direction', async () => {
    const d = doc();
    d.elements = [flow('a'), flow('b'), edge('e', 'a', 'b')];
    const { run, model } = setup(d);
    const r = await run('openboard.layout', { direction: 'LR' });
    expect(r.moved).toBe(2);
    const [a, b] = els(model);
    expect(b.x).toBeGreaterThan(a.x);
    const rb = await run('openboard.layout', { ids: ['a', 'b'], direction: 'BT' });
    expect(rb.error).toBeUndefined();
    const [a2, b2] = els(model);
    expect(b2.y).toBeLessThan(a2.y);
  });

  it('errors with fewer than two flow nodes', async () => {
    const d = doc();
    d.elements = [flow('a')];
    const { run } = setup(d);
    const r = await run('openboard.layout', {});
    expect(r.error.code).toBe('too_few_nodes');
    expect(r.error.message).toMatch(/at least two/i);
  });

  it('is not read-only', () => {
    expect(setup().reg.def('openboard.layout').readOnly).toBe(false);
    expect(setup().reg.def('openboard.import').readOnly).toBe(false);
  });
});

describe('openboard.import', () => {
  it('imports mermaid as laid-out flow nodes and edges', async () => {
    const { run, model } = setup();
    const r = await run('openboard.import', { source: 'mermaid', text: 'graph LR\n A[Start] --> B{Ok?}\n B -->|yes| C' });
    expect(r.ids).toHaveLength(5);
    const nodes = els(model).filter((e) => e.type === 'flowNode');
    expect(nodes).toHaveLength(3);
    expect(nodes[1].x).toBeGreaterThan(nodes[0].x);
    expect(els(model).filter((e) => e.type === 'edge')).toHaveLength(2);
  });

  it('returns a structured error with the line and creates nothing on a parse error', async () => {
    const { run, model } = setup();
    const r = await run('openboard.import', { source: 'mermaid', text: 'graph TD\n A --> B\n A --> ' });
    expect(r.error.code).toBe('parse_error');
    expect(r.error.line).toBe(3);
    expect(els(model)).toHaveLength(0);
  });

  it('imports an image with an asset, parsed dimensions and capped size', async () => {
    const { run, model } = setup();
    const r = await run('openboard.import', { source: 'image', data: PNG_B64, x: 10, y: 20 });
    expect(r.error).toBeUndefined();
    const doc1 = model.getDocument();
    expect(doc1.assets).toHaveLength(1);
    expect(doc1.assets[0]!.hash).toHaveLength(64);
    const img = els(model)[0];
    expect(img).toMatchObject({ type: 'image', x: 10, y: 20, width: 1, height: 1, assetId: r.assetId });
    const big = await run('openboard.import', { source: 'image', data: PNG_B64, width: 4000, height: 2000 });
    expect(big.error).toBeUndefined();
    expect(els(model)[1]).toMatchObject({ width: 1024, height: 512 });
    expect(model.getDocument().assets).toHaveLength(1); // same hash reused
  });

  it('rejects non-image data', async () => {
    const { run } = setup();
    const r = await run('openboard.import', { source: 'image', data: 'aGVsbG8gd29ybGQ=' });
    expect(r.error.code).toBe('invalid_image');
  });

  it('inserts a library component with fresh ids and remapped edges', async () => {
    const d = doc();
    d.library = [{ id: 'lib1', name: 'Pair', elements: [flow('a', 5, 5), flow('b', 200, 5), edge('e', 'a', 'b')] }];
    const { run, model } = setup(d);
    const r = await run('openboard.import', { source: 'component', component: 'Pair', x: 0, y: 0 });
    expect(r.ids).toHaveLength(3);
    const [a, b, e] = els(model);
    expect(a.id).not.toBe('a');
    expect(a.x).toBe(0);
    expect(e.sourceId).toBe(a.id);
    expect(e.targetId).toBe(b.id);
    const missing = await run('openboard.import', { source: 'component', component: 'nope' });
    expect(missing.error.code).toBe('not_found');
  });

  describe('png', () => {
    beforeAll(() => setBoardValidator(() => true));
    afterAll(() => setBoardValidator(undefined));

    it('imports the board embedded in a PNG', async () => {
      const src = doc();
      src.elements = [flow('a'), flow('b', 300, 0), edge('e', 'a', 'b')];
      const png = embedDocument(Uint8Array.from(Buffer.from(PNG_B64, 'base64')), JSON.stringify(src));
      const { run, model } = setup();
      const r = await run('openboard.import', { source: 'png', data: Buffer.from(png).toString('base64') });
      expect(r.error).toBeUndefined();
      expect(r.ids).toHaveLength(3);
      expect(els(model).map((e) => e.id)).not.toContain('a');
    });

    it('errors when the PNG has no embedded board', async () => {
      const { run } = setup();
      const r = await run('openboard.import', { source: 'png', data: PNG_B64 });
      expect(r.error.code).toBe('no_embedded_board');
    });
  });
});
