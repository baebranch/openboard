import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerArrangeTools } from './arrange-tools';

const style = { fill: 'none', stroke: '#000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const box = (id: string, type: string, parentId?: string): Element =>
  ({ id, type, x: 0, y: 0, width: 10, height: 10, rotation: 0, style, ...(parentId ? { parentId } : {}) }) as unknown as Element;

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
  const run = (input: unknown) => reg.invoke('openboard.element.arrange', input) as Promise<any>;
  const parent = (id: string) => (model.getDocument().elements.find((e) => e.id === id) as any).parentId;
  return { history, run, parent };
}

describe('arrange moveIntoFrame / moveOutOfFrame', () => {
  it('moves into a Frame as one history entry, skipping elements whose ancestor is selected', async () => {
    const { run, parent, history } = setup([
      box('t', 'frame'),
      box('f', 'frame'),
      box('c', 'rectangle', 'f'),
      box('r', 'rectangle'),
    ]);
    const out = await run({ action: 'moveIntoFrame', ids: ['f', 'c', 'r'], targetId: 't' });
    expect(out.changed).toBe(true);
    expect(parent('f')).toBe('t');
    expect(parent('r')).toBe('t');
    expect(parent('c')).toBe('f');
    expect(history.undoCount()).toBe(1);
  });

  it('rejects cycles, non-Frame targets and depth overflow, leaving document and history unchanged', async () => {
    const chain: Element[] = [box('f0', 'frame')];
    for (let i = 1; i < 16; i++) chain.push(box(`f${i}`, 'frame', `f${i - 1}`));
    const { run, parent, history } = setup([...chain, box('x', 'frame'), box('xc', 'frame', 'x'), box('r', 'rectangle')]);
    expect((await run({ action: 'moveIntoFrame', ids: ['x'], targetId: 'xc' })).error).toBeDefined();
    expect((await run({ action: 'moveIntoFrame', ids: ['x'], targetId: 'x' })).error).toBeDefined();
    expect((await run({ action: 'moveIntoFrame', ids: ['x'], targetId: 'r' })).error).toBeDefined();
    expect((await run({ action: 'moveIntoFrame', ids: ['x'], targetId: 'f15' })).error).toBeDefined();
    expect(parent('x')).toBeUndefined();
    expect(history.undoCount()).toBe(0);
  });

  it('moves out to the grandparent or clears parentId; parentless elements are unchanged', async () => {
    const { run, parent, history } = setup([
      box('g', 'frame'),
      box('p', 'frame', 'g'),
      box('a', 'rectangle', 'p'),
      box('b', 'rectangle', 'g'),
      box('n', 'rectangle'),
    ]);
    expect((await run({ action: 'moveOutOfFrame', ids: ['n'] })).changed).toBe(false);
    expect(history.undoCount()).toBe(0);
    expect((await run({ action: 'moveOutOfFrame', ids: ['a', 'b', 'n'] })).changed).toBe(true);
    expect(parent('a')).toBe('g');
    expect(parent('b')).toBeUndefined();
    expect(history.undoCount()).toBe(1);
  });
});
