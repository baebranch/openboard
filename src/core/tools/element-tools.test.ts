import { describe, expect, it } from 'vitest';
import { BoardModel } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerElementTools } from './element-tools';

const doc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

function setup() {
  const model = new BoardModel('/b.openboard', doc());
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerElementTools(reg);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  return { model, reg, run };
}

const els = (m: BoardModel): Element[] => m.getDocument().elements;

describe('element tools', () => {
  it('registers the four tools; only delete is destructive', () => {
    const { reg } = setup();
    expect(reg.list()).toEqual([
      'openboard.element.create',
      'openboard.element.update',
      'openboard.element.query',
      'openboard.element.delete',
    ]);
    expect(reg.def('openboard.element.delete').destructive).toBe(true);
    expect(reg.def('openboard.element.update').destructive).toBeUndefined();
  });

  it('creates polymorphic elements with defaults', async () => {
    const { run, model } = setup();
    const r = await run('openboard.element.create', {
      elements: [
        { type: 'rectangle', id: 'r', x: 5, style: { fill: '#ff0000' } },
        { type: 'text', id: 't', text: 'hi', fontSize: 20 },
        { type: 'frame', id: 'f', name: 'F' },
      ],
    });
    expect(r.ids).toEqual(['r', 't', 'f']);
    const [rect, text] = els(model) as any[];
    expect(rect.x).toBe(5);
    expect(rect.width).toBe(100);
    expect(rect.style.fill).toBe('#ff0000');
    expect(rect.style.strokeWidth).toBe(2);
    expect(text.runs).toEqual([{ text: 'hi' }]);
    expect(text.fontSize).toBe(20);
  });

  it('rejects invalid properties atomically', async () => {
    const { run, model } = setup();
    const r = await run('openboard.element.create', {
      elements: [
        { type: 'rectangle', id: 'a' },
        { type: 'rectangle', id: 'b', opacity: 150 },
      ],
    });
    expect(r.error.code).toBe('invalid_property');
    expect(r.error.message).toContain('elements[1]');
    expect(els(model)).toHaveLength(0);
    const bad = await run('openboard.element.create', { elements: [{ type: 'nope' }] });
    expect(bad.error.code).toBe('invalid_input');
  });

  async function seed(run: (n: string, i: unknown) => Promise<any>) {
    await run('openboard.element.create', {
      elements: [
        { type: 'rectangle', id: 'a', width: 40, height: 40 },
        { type: 'rectangle', id: 'b' },
        { type: 'ellipse', id: 'c' },
        { type: 'edge', id: 'e', sourceId: 'a', targetId: 'c' },
      ],
    });
  }

  it('updates by ids, type, and filter; validates each property', async () => {
    const { run, model } = setup();
    await seed(run);
    expect((await run('openboard.element.update', { ids: ['a', 'b'], set: { opacity: 50 } })).updated).toBe(2);
    expect((await run('openboard.element.update', { type: 'ellipse', set: { fill: '#00ff00' } })).ids).toEqual(['c']);
    expect((await run('openboard.element.update', { filter: { opacity: 50 }, set: { x: 7.456 } })).ids).toEqual(['a', 'b']);
    expect((els(model)[0] as any).x).toBe(7.46);
    expect((els(model)[2] as any).style.fill).toBe('#00ff00');

    const before = model.getDocument();
    const bad = await run('openboard.element.update', { ids: ['a', 'b'], set: { cornerRadius: 25 } });
    expect(bad.error.message).toContain('a');
    expect(model.getDocument()).toBe(before);
    const inapplicable = await run('openboard.element.update', { ids: ['c'], set: { fontSize: 12 } });
    expect(inapplicable.error.code).toBe('invalid_property');
  });

  it('reports not-found ids and leaves the document unchanged', async () => {
    const { run, model } = setup();
    await seed(run);
    const before = model.getDocument();
    for (const [tool, input] of [
      ['openboard.element.update', { ids: ['a', 'ghost'], set: { x: 1 } }],
      ['openboard.element.delete', { ids: ['a', 'ghost'] }],
      ['openboard.element.query', { ids: ['ghost'] }],
    ] as const) {
      const r = await run(tool, input);
      expect(r.error.code).toBe('not_found');
      expect(r.error.message).toContain('ghost');
      expect(model.getDocument()).toBe(before);
    }
  });

  it('queries with filter and pagination', async () => {
    const { run } = setup();
    await run('openboard.element.create', {
      elements: Array.from({ length: 7 }, (_, i) => ({ type: 'rectangle', id: `r${i}` })),
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const p: any = await run('openboard.element.query', { type: 'rectangle', limit: 3, ...(cursor ? { cursor } : {}) });
      expect(p.total).toBe(7);
      seen.push(...p.items.map((e: Element) => e.id));
      cursor = p.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
    expect((await run('openboard.element.query', { limit: 501 })).error.code).toBe('invalid_input');
    expect((await run('openboard.element.query', { type: 'ellipse' })).total).toBe(0);
  });

  it('deletes and cascades attached edges', async () => {
    const { run, model } = setup();
    await seed(run);
    const r = await run('openboard.element.delete', { ids: ['a'] });
    expect(r).toEqual({ deleted: ['a'], cascaded: ['e'] });
    expect(els(model).map((e) => e.id)).toEqual(['b', 'c']);
    // Deleting a node and its edge together does not fail on the already-cascaded edge.
    await run('openboard.element.create', {
      elements: [
        { type: 'rectangle', id: 'n1' },
        { type: 'rectangle', id: 'n2' },
        { type: 'edge', id: 'e2', sourceId: 'n1', targetId: 'n2' },
      ],
    });
    expect(await run('openboard.element.delete', { ids: ['n1', 'e2'] })).toEqual({ deleted: ['n1', 'e2'], cascaded: [] });
    const none = await run('openboard.element.delete', {});
    expect(none.error.code).toBe('invalid_selector');
  });
});
