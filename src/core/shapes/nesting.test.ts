import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from '../tools/registry';
import { registerArrangeTools } from '../tools/arrange-tools';
import { registerElementTools } from '../tools/element-tools';
import { MAX_FRAME_DEPTH, createFrame, frameNestingDepth, frameNestingProblem } from './shapes';

const style = { fill: 'none', stroke: '#000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const el = (id: string, type: string, parentId?: string, x = 0, y = 0, w = 10, h = 10): Element =>
  ({ id, type, x, y, width: w, height: h, rotation: 0, style, ...(parentId ? { parentId } : {}) }) as unknown as Element;

/** Chain f1 (root) .. fN, each the child of the previous. */
const chain = (n: number): Element[] =>
  Array.from({ length: n }, (_, i) => el(`f${i + 1}`, 'frame', i === 0 ? undefined : `f${i}`));

function setup(elements: Element[]) {
  const doc = {
    schemaVersion: 1,
    meta: { id: 'b' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements,
    assets: [],
    library: [],
  } as unknown as BoardDocument;
  const history = new UndoHistory();
  const model = new BoardModel('/b.openboard', doc, { history });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerArrangeTools(reg);
  registerElementTools(reg);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  const parent = (id: string) => (model.getDocument().elements.find((e) => e.id === id) as any)?.parentId;
  const snapshot = () => JSON.stringify(model.getDocument());
  return { run, parent, history, snapshot };
}

describe('nesting depth limit (Req 21.1, 21.6)', () => {
  it('allows depth 16 and rejects depth 17', () => {
    expect(MAX_FRAME_DEPTH).toBe(16);
    expect(frameNestingProblem(chain(16), ['f16'])).toBeUndefined();
    expect(frameNestingDepth('f16', chain(16))).toBe(16);
    expect(frameNestingProblem(chain(17), ['f17'])).toMatch(/maximum nesting depth/);
  });

  it('element.update accepts reparenting to depth 16 and rejects depth 17 unchanged', async () => {
    const { run, parent, history, snapshot } = setup([...chain(15), el('x', 'frame')]);
    expect((await run('openboard.element.update', { ids: ['x'], set: { parentId: 'f15' } })).error).toBeUndefined();
    expect(parent('x')).toBe('f15');
    const { run: run2, history: h2, snapshot: snap2 } = setup([...chain(16), el('y', 'frame')]);
    const before = snap2();
    const r = await run2('openboard.element.update', { ids: ['y'], set: { parentId: 'f16' } });
    expect(r.error).toBeDefined();
    expect(snap2()).toBe(before);
    expect(h2.undoCount()).toBe(0);
    expect(history.undoCount()).toBe(1);
    void snapshot;
  });

  it('counts Frames below a moved Frame', async () => {
    // Moved subtree has 3 levels; target at depth 14 gives deepest 17.
    const { run, history, snapshot } = setup([...chain(14), el('a', 'frame'), el('b', 'frame', 'a'), el('c', 'frame', 'b')]);
    const before = snapshot();
    const r = await run('openboard.element.arrange', { action: 'moveIntoFrame', ids: ['a'], targetId: 'f14' });
    expect(r.error).toBeDefined();
    expect(snapshot()).toBe(before);
    expect(history.undoCount()).toBe(0);
    // Target at depth 13 gives deepest 16: allowed.
    const ok = setup([...chain(13), el('a', 'frame'), el('b', 'frame', 'a'), el('c', 'frame', 'b')]);
    expect((await ok.run('openboard.element.arrange', { action: 'moveIntoFrame', ids: ['a'], targetId: 'f13' })).changed).toBe(true);
  });
});

describe('self-ancestor and non-Frame parent (Req 21.6)', () => {
  it('rejects a Frame becoming its own parent or descendant via element.update', async () => {
    const { run, history, snapshot } = setup([el('a', 'frame'), el('b', 'frame', 'a'), el('c', 'frame', 'b')]);
    const before = snapshot();
    for (const [id, parentId] of [['a', 'a'], ['a', 'c'], ['a', 'b']] as const) {
      const r = await run('openboard.element.update', { ids: [id], set: { parentId } });
      expect(r.error, `${id} -> ${parentId}`).toBeDefined();
    }
    expect(snapshot()).toBe(before);
    expect(history.undoCount()).toBe(0);
  });

  it('rejects non-Frame and missing parents on update and create', async () => {
    const { run, history, snapshot } = setup([el('f', 'frame'), el('r', 'rectangle', 'f'), el('o', 'rectangle')]);
    const before = snapshot();
    for (const parentId of ['r', 'ghost']) {
      expect((await run('openboard.element.update', { ids: ['o'], set: { parentId } })).error).toBeDefined();
      expect((await run('openboard.element.create', { elements: [{ type: 'rectangle', id: 'n', parentId }] })).error).toBeDefined();
    }
    expect(snapshot()).toBe(before);
    expect(history.undoCount()).toBe(0);
  });
});

describe('move into / out of Frame (Req 21.2, 21.3)', () => {
  it('moves a Frame with its subtree into another Frame, keeping deeper parents', async () => {
    const { run, parent, history } = setup([el('t', 'frame'), el('a', 'frame'), el('b', 'rectangle', 'a')]);
    expect((await run('openboard.element.arrange', { action: 'moveIntoFrame', ids: ['a'], targetId: 't' })).changed).toBe(true);
    expect(parent('a')).toBe('t');
    expect(parent('b')).toBe('a');
    expect(history.undoCount()).toBe(1);
  });

  it('moving into the current parent changes nothing and adds no history', async () => {
    const { run, history } = setup([el('t', 'frame'), el('r', 'rectangle', 't')]);
    expect((await run('openboard.element.arrange', { action: 'moveIntoFrame', ids: ['r'], targetId: 't' })).changed).toBe(false);
    expect(history.undoCount()).toBe(0);
  });

  it('move out of a Frame re-parents a nested Frame to the grandparent, then to none', async () => {
    const { run, parent } = setup([el('g', 'frame'), el('p', 'frame', 'g'), el('c', 'frame', 'p')]);
    await run('openboard.element.arrange', { action: 'moveOutOfFrame', ids: ['c'] });
    expect(parent('c')).toBe('g');
    await run('openboard.element.arrange', { action: 'moveOutOfFrame', ids: ['c'] });
    expect(parent('c')).toBeUndefined();
  });

  it('move out of a depth-16 chain leaves the document valid', async () => {
    const { run, parent } = setup([...chain(16), el('l', 'rectangle', 'f16')]);
    await run('openboard.element.arrange', { action: 'moveOutOfFrame', ids: ['l'] });
    expect(parent('l')).toBe('f15');
  });
});

describe('creation-time adoption leaves existing Frames alone (Req 21.10)', () => {
  it('adopts non-Frame elements fully inside but never existing Frames', () => {
    const existing = [
      el('inner', 'frame', undefined, 10, 10, 20, 20),
      el('rect', 'rectangle', undefined, 40, 40, 10, 10),
      el('nested', 'frame', 'inner', 12, 12, 5, 5),
    ];
    const { adopt } = createFrame({ x: 0, y: 0, width: 100, height: 100 }, existing, { id: 'new' });
    expect(adopt).toEqual([{ id: 'rect', patch: { parentId: 'new' } }]);
    const ids = adopt.map((a) => a.id);
    expect(ids).not.toContain('inner');
    expect(ids).not.toContain('nested');
  });

  it('does not adopt the new Frame\'s own larger containing Frame', () => {
    const existing = [el('big', 'frame', undefined, 0, 0, 500, 500)];
    const { adopt } = createFrame({ x: 10, y: 10, width: 100, height: 100 }, existing, { id: 'new' });
    expect(adopt).toEqual([]);
  });
});
