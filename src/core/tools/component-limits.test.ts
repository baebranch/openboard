import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerComponentTools } from './component-tools';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const frame = (id: string, extra: object = {}): Element =>
  ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 100, rotation: 0, style, name: 'Frame', ...extra }) as Element;

function setup(elements: Element[]) {
  const doc: BoardDocument = {
    schemaVersion: 1,
    meta: { id: 'b' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements,
    assets: [],
    library: [],
  };
  const history = new UndoHistory();
  const model = new BoardModel('/b.openboard', doc, { history });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerComponentTools(reg);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  return { model, run, history };
}
const snap = (m: BoardModel): string => JSON.stringify(m.getDocument());

describe('component cycle and depth rejections', () => {
  it('rejects an indirect cycle (A contains B instance, then B gets an A instance)', async () => {
    const { run, model } = setup([
      frame('A', { component: 'A' }),
      frame('B', { component: 'B' }),
    ]);
    const ok = await run('openboard.component.instance.create', { master: 'B', parentId: 'A' });
    expect(ok.error).toBeUndefined();
    const before = snap(model);
    const r = await run('openboard.component.instance.create', { master: 'A', parentId: 'B' });
    expect(r.error.code).toBe('component_cycle');
    expect(snap(model)).toBe(before);
  });

  it('rejects a self-cycle with the code component_cycle and leaves history empty', async () => {
    const { run, model, history } = setup([frame('M', { component: 'M' })]);
    const before = snap(model);
    const r = await run('openboard.component.instance.create', { master: 'M', parentId: 'M' });
    expect(r.error.code).toBe('component_cycle');
    expect(snap(model)).toBe(before);
    expect(history.undo(model)).toBe(false);
  });

  it('rejects a chain deeper than 8 levels with the document and history unchanged', async () => {
    const masters = Array.from({ length: 10 }, (_, i) => frame(`M${i}`, { component: `M${i}` }));
    const { run, model, history } = setup(masters);
    let failedAt = -1;
    let failure: any;
    for (let i = 1; i < 10; i++) {
      const before = snap(model);
      const r = await run('openboard.component.instance.create', { master: `M${i - 1}`, parentId: `M${i}` });
      if (r.error) {
        failedAt = i;
        failure = r.error;
        expect(snap(model)).toBe(before);
        break;
      }
    }
    expect(failedAt).toBeGreaterThan(1);
    expect(failure.code).toBe('component_depth');
    // Undo only reverts the successful creations, never the rejected one.
    let undone = 0;
    while (history.undo(model)) undone++;
    expect(undone).toBe(failedAt - 1);
  });
});

describe('detach and reset edge cases', () => {
  it('detach is one undo step and a rejected detach adds no history', async () => {
    const { run, model, history } = setup([frame('M', { component: 'M' }), frame('plain')]);
    const { id } = await run('openboard.component.instance.create', { master: 'M', x: 300, y: 0 });
    const before = snap(model);
    expect((await run('openboard.component.instance.detach', { id })).error).toBeUndefined();
    expect(history.undo(model)).toBe(true);
    expect(snap(model)).toBe(before);
    expect(history.undo(model)).toBe(true); // reverts creation
    const clean = snap(model);
    expect((await run('openboard.component.instance.detach', { id: 'plain' })).error.code).toBe('not_an_instance');
    expect(snap(model)).toBe(clean);
  });

  it('reset on a non-instance is rejected without changes', async () => {
    const { run, model } = setup([frame('plain')]);
    const before = snap(model);
    expect((await run('openboard.component.instance.override.reset', { id: 'plain' })).error).toBeDefined();
    expect(snap(model)).toBe(before);
  });
});
