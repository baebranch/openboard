import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerElementTools } from './element-tools';
import { effectiveSchemaVersion } from '../format/schema-version';

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

describe('frame nesting guards (Req 21.1, 21.5, 21.6)', () => {
  const chain = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ type: 'frame', id: `f${i}`, ...(i > 0 ? { parentId: `f${i - 1}` } : {}) }));

  it('accepts nesting a Frame in a Frame and rejects cycles, non-Frame parents and depth > 16 untouched', async () => {
    const { run, model } = setup();
    const history = new UndoHistory();
    model.history = history;
    expect((await run('openboard.element.create', { elements: chain(16) })).error).toBeUndefined();
    await run('openboard.element.create', { elements: [{ type: 'rectangle', id: 'r' }, { type: 'frame', id: 'top' }] });
    const before = JSON.stringify(model.getDocument());
    const undoBefore = history.undoCount();

    const cases = [
      { ids: ['f0'], set: { parentId: 'f15' } }, // cycle
      { ids: ['f0'], set: { parentId: 'f0' } }, // self
      { ids: ['top'], set: { parentId: 'r' } }, // not a Frame
      { ids: ['top'], set: { parentId: 'nope' } }, // missing
      { ids: ['top'], set: { parentId: 'f15' } }, // depth 17
      { ids: ['f0'], set: { parentId: 'top' } }, // pushes subtree to depth 17
    ];
    for (const c of cases) {
      const r = await run('openboard.element.update', c);
      expect(r.error?.code).toBe('invalid_parent');
    }
    const tooDeep = await run('openboard.element.create', { elements: [{ type: 'frame', id: 'x', parentId: 'f15' }] });
    expect(tooDeep.error?.code).toBe('invalid_parent');
    expect(JSON.stringify(model.getDocument())).toBe(before);
    expect(history.undoCount()).toBe(undoBefore);

    const ok = await run('openboard.element.update', { ids: ['top'], set: { parentId: 'f14' } });
    expect(ok.error).toBeUndefined();
  });
});

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

  it('removes cornerRadii when set to null', async () => {
    const { run, model } = setup();
    await run('openboard.element.create', { elements: [{ type: 'rectangle', id: 'r', width: 100, height: 80, cornerRadii: [4, 0, 10, 5] }] });
    await run('openboard.element.update', { ids: ['r'], set: { cornerRadius: 6, cornerRadii: null } });
    const style = (els(model)[0] as any).style;
    expect('cornerRadii' in style).toBe(false);
    expect(style.cornerRadius).toBe(6);
  });

  it('validates cornerRadii and clamps it when the size shrinks', async () => {
    const { run, model } = setup();
    await run('openboard.element.create', {
      elements: [
        { type: 'rectangle', id: 'r', width: 100, height: 80, cornerRadii: [40, 0, 10, 5] },
        { type: 'ellipse', id: 'o' },
      ],
    });
    for (const bad of [[1, 2, 3], [1, 2, 3, -1], [1, 2, 3, 41], [1, 2, 3, 'x']]) {
      const r = await run('openboard.element.update', { ids: ['r'], set: { cornerRadii: bad } });
      expect(r.error.code).toBe('invalid_property');
      expect(r.error.message).toContain('style.cornerRadii');
    }
    const u = await run('openboard.element.update', { ids: ['o'], set: { cornerRadii: [1, 1, 1, 1] } });
    expect(u.error.code).toBe('unknown_property');
    expect((els(model)[0] as any).style.cornerRadii).toEqual([40, 0, 10, 5]);
    await run('openboard.element.update', { ids: ['r'], set: { height: 20 } });
    expect((els(model)[0] as any).style.cornerRadii).toEqual([10, 0, 10, 5]);
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

describe('query filters (Req 25.6)', () => {
  it('filters on instanceOf, component, parentId and tokenRef, combined with AND', async () => {
    const { run, model } = setup();
    await run('openboard.element.create', {
      elements: [
        { type: 'frame', id: 'm', component: 'Card' },
        { type: 'rectangle', id: 'a', parentId: 'm', fill: 'token:accent' },
        { type: 'rectangle', id: 'b', parentId: 'm', fill: '#ffffff' },
        { type: 'rectangle', id: 'c', stroke: 'token:accent' },
      ],
    });
    // instanceOf is set directly: an instance is a Frame pointing at a master.
    const d = model.getDocument() as any;
    d.elements.push({ ...d.elements[0], id: 'i', component: undefined, instanceOf: 'm' });
    const ids = async (input: object) => (await run('openboard.element.query', input)).items.map((e: Element) => e.id);
    expect(await ids({ component: 'Card' })).toEqual(['m']);
    expect(await ids({ parentId: 'm' })).toEqual(['a', 'b']);
    expect(await ids({ tokenRef: 'accent' })).toEqual(['a', 'c']);
    expect(await ids({ tokenRef: 'token:accent' })).toEqual(['a', 'c']);
    expect(await ids({ parentId: 'm', tokenRef: 'accent' })).toEqual(['a']);
    expect(await ids({ instanceOf: 'm' })).toEqual(['i']);
    expect(await ids({ instanceOf: 'nope' })).toEqual([]);
  });
});

describe('icon element (Req 23.1, 23.3, 23.13, 23.14)', () => {
  it('creates an Icon with 24 by 24 size and stroke width 2 by default', async () => {
    const { run } = setup();
    const r = await run('openboard.element.create', { elements: [{ type: 'icon', name: 'check' }] });
    expect(r.error).toBeUndefined();
    expect(r.created[0]).toMatchObject({ type: 'icon', name: 'check', width: 24, height: 24, style: { strokeWidth: 2 } });
  });

  it('keeps an explicit size and stroke width', async () => {
    const { run } = setup();
    const r = await run('openboard.element.create', { elements: [{ type: 'icon', name: 'x', width: 48, height: 32, strokeWidth: 3 }] });
    expect(r.created[0]).toMatchObject({ width: 48, height: 32, style: { strokeWidth: 3 } });
  });

  it('makes the document require schema version 2 (Req 23.12)', async () => {
    const { run, model } = setup();
    expect(effectiveSchemaVersion(model.getDocument())).toBe(1);
    await run('openboard.element.create', { elements: [{ type: 'icon', name: 'check' }] });
    expect(effectiveSchemaVersion(model.getDocument())).toBe(2);
  });

  it('preserves a name outside the Icon_Set', async () => {
    const { run, model } = setup();
    const r = await run('openboard.element.create', { elements: [{ type: 'icon', name: 'not-a-real-icon' }] });
    expect(r.error).toBeUndefined();
    expect((els(model)[0] as { name: string }).name).toBe('not-a-real-icon');
  });

  it('rejects an empty or over-long name on create and update, leaving the document unchanged', async () => {
    const { run, model } = setup();
    for (const name of ['', 'a'.repeat(65)]) {
      const r = await run('openboard.element.create', { elements: [{ type: 'icon', name }] });
      expect(r.error).toBeDefined();
    }
    expect(els(model)).toHaveLength(0);
    await run('openboard.element.create', { elements: [{ type: 'icon', id: 'i', name: 'check' }] });
    const before = JSON.stringify(model.getDocument());
    for (const name of ['', 'a'.repeat(65)]) {
      const r = await run('openboard.element.update', { ids: ['i'], set: { name } });
      expect(r.error?.code).toBe('invalid_property');
      expect(r.error?.message).toContain('1 to 64');
    }
    expect(JSON.stringify(model.getDocument())).toBe(before);
    expect((await run('openboard.element.update', { ids: ['i'], set: { name: 'a'.repeat(64) } })).error).toBeUndefined();
  });
});
