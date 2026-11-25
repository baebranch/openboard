import { describe, expect, it } from 'vitest';
import { BoardModel } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerConnectTools } from './connect-tools';

const doc = (elements: Element[] = []): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements,
  assets: [],
  library: [],
});

const rect = (id: string): Element =>
  ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    rotation: 0,
    style: { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 },
  }) as Element;

function setup() {
  const model = new BoardModel('/b.openboard', doc([rect('a'), rect('b')]));
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerConnectTools(reg);
  const run = (input: unknown) => reg.invoke('openboard.connect', input) as Promise<any>;
  return { model, run };
}

describe('openboard.connect', () => {
  it('creates edges with defaults and options, including self-loops', async () => {
    const { run, model } = setup();
    const r = await run({
      edges: [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'a', targetId: 'a', routing: 'orthogonal', targetArrow: 'diamond', strokeStyle: 'dashed', label: 'loop' },
      ],
    });
    expect(r.ids).toHaveLength(2);
    const [e1, e2] = r.edges;
    expect(e1).toMatchObject({ routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow' });
    expect(e2).toMatchObject({ sourceId: 'a', targetId: 'a', routing: 'orthogonal', targetArrow: 'diamond', label: 'loop' });
    expect(e2.style.strokeStyle).toBe('dashed');
    expect(model.getDocument().elements).toHaveLength(4);
  });

  it('creates a centered process node for toPosition', async () => {
    const { run, model } = setup();
    const r = await run({ edges: [{ sourceId: 'a', toPosition: { x: 300, y: 200 } }] });
    expect(r.createdNodes).toHaveLength(1);
    const n = r.createdNodes[0];
    expect(n).toMatchObject({ type: 'flowNode', preset: 'process' });
    expect(n.x + n.width / 2).toBe(300);
    expect(n.y + n.height / 2).toBe(200);
    expect(r.edges[0]).toMatchObject({ sourceId: 'a', targetId: n.id });
    expect(model.getDocument().elements).toHaveLength(4);
  });

  it('fails atomically with not_found, edge endpoints, and bad input', async () => {
    const { run, model } = setup();
    const before = model.getDocument();
    const nf = await run({ edges: [{ sourceId: 'a', targetId: 'b' }, { sourceId: 'a', targetId: 'zzz' }] });
    expect(nf.error.code).toBe('not_found');
    expect(nf.error.message).toContain('zzz');
    expect(model.getDocument()).toBe(before);

    const { edges } = await run({ edges: [{ sourceId: 'a', targetId: 'b' }] });
    const onEdge = await run({ edges: [{ sourceId: edges[0].id, targetId: 'b' }] });
    expect(onEdge.error.code).toBe('invalid_endpoint');

    const both = await run({ edges: [{ sourceId: 'a', targetId: 'b', toPosition: { x: 0, y: 0 } }] });
    expect(both.error.code).toBe('invalid_input');
    const long = await run({ edges: [{ sourceId: 'a', targetId: 'b', label: 'x'.repeat(201) }] });
    expect(long.error).toBeDefined();
    const ok = await run({ edges: [{ sourceId: 'a', targetId: 'b', label: 'x'.repeat(200) }] });
    expect(ok.error).toBeUndefined();
  });

  it('removing an endpoint cascades to the edge', async () => {
    const { run, model } = setup();
    await run({ edges: [{ sourceId: 'a', targetId: 'b' }] });
    model.transact('rm', (tx) => tx.remove('a'));
    expect(model.getDocument().elements.map((e) => e.id)).toEqual(['b']);
  });
});
