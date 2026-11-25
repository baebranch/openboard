import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerArrangeTools } from './arrange-tools';
import { moveFramePatches } from '../shapes';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const rect = (id: string, extra: object = {}): Element =>
  ({ id, type: 'rectangle', x: 5, y: 5, width: 10, height: 20, rotation: 0, style, ...extra }) as Element;
const frame = (id: string, extra: object = {}): Element =>
  ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 100, rotation: 0, style, name: 'Frame', ...extra }) as Element;

function setup(elements: Element[]) {
  const doc: BoardDocument = {
    schemaVersion: 1,
    meta: { id: 'b' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements: [],
    assets: [],
    library: [],
  };
  const model = new BoardModel('/b.openboard', doc, { history: new UndoHistory() });
  // Seed through a transaction so the Derived_Geometry_Pass creates the Instance_Children.
  model.transact('seed', (tx) => {
    for (const e of elements) tx.create(e as never);
  });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerArrangeTools(reg);
  const run = (input: unknown) => reg.invoke('openboard.element.arrange', input) as Promise<any>;
  const els = () => model.getDocument().elements as any[];
  return { model, run, els };
}

const seed = (): Element[] => [
  frame('M', { component: 'Card' }),
  rect('a', { parentId: 'M' }),
  frame('I', { x: 300, instanceOf: 'M', overrides: { a: { fill: '#ff0000' } } }),
  rect('u', { parentId: 'I', x: 310 }),
];

describe('component clone semantics', () => {
  it('duplicating a master gives a unique name; existing instances stay linked to the original', async () => {
    const { run, els } = setup(seed());
    const out = await run({ action: 'duplicate', ids: ['M'] });
    const copy = els().find((e) => e.id === out.ids[0]);
    expect(copy.component).toBe('Card 2');
    expect(els().find((e) => e.id === 'I').instanceOf).toBe('M');
  });

  it('duplicating an instance keeps overrides and derives child ids', async () => {
    const { run, els } = setup(seed());
    const out = await run({ action: 'duplicate', ids: ['I'] });
    const id = out.ids[0] as string;
    const copy = els().find((e) => e.id === id);
    expect(copy.instanceOf).toBe('M');
    expect(copy.overrides).toEqual({ a: { fill: '#ff0000' } });
    const child = els().find((e) => e.id === `${id}::a`);
    expect(child?.style.fill).toBe('#ff0000');
  });

  it('pasting an instance with its master relinks to the pasted master', async () => {
    const { run, els } = setup(seed());
    const { clipboard } = await run({ action: 'copy', ids: ['M', 'I'] });
    const out = await run({ action: 'paste', clipboard });
    const [newM, newI] = out.ids as string[];
    expect(els().find((e) => e.id === newI).instanceOf).toBe(newM);
    expect(els().find((e) => e.id === newM).component).toBe('Card 2');
  });

  it('pasting an instance without a master makes an ordinary Frame with ordinary children', async () => {
    const { model, run, els } = setup(seed());
    const { clipboard } = await run({ action: 'copy', ids: ['I', 'I::a'] });
    model.transact('rm', (tx) => tx.remove('M'));
    const out = await run({ action: 'paste', clipboard });
    expect(out.error).toBeUndefined();
    const f = els().find((e) => e.id === out.ids[0]);
    expect(f.instanceOf).toBeUndefined();
    expect(f.overrides).toBeUndefined();
    expect(els().filter((e) => e.parentId === f.id)).toHaveLength(1);
  });

  it('deleting a master detaches its instances in the same transaction', () => {
    const { model, els } = setup(seed());
    model.transact('rm', (tx) => tx.remove('M'));
    const inst = els().find((e) => e.id === 'I');
    expect(inst.instanceOf).toBeUndefined();
    expect(inst.overrides).toBeUndefined();
    expect(els().some((e) => e.id === 'I::a')).toBe(true);
    expect(els().filter((e) => e.id === 'I::a')[0].parentId).toBe('I');
  });

  it('moving an instance moves its User_Children and Instance_Children together', async () => {
    const { model, run, els } = setup(seed());
    await run({ action: 'nudge', ids: ['I'], dx: 1, dy: 0, amount: 10 });
    expect(els().find((e) => e.id === 'I').x).toBe(310);
    expect(els().find((e) => e.id === 'u').x).toBe(320);
    expect(els().find((e) => e.id === 'I::a').x).toBe(315);
    const ids = moveFramePatches('I', model.getDocument().elements, 5, 0).map((p) => p.id);
    expect(ids).toEqual(['I', 'u']);
  });
});
