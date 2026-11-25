import { describe, expect, it } from 'vitest';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument, Element } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { registerTokenTools } from './token-tools';

const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const rect = (id: string, fill: string): Element =>
  ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style: { ...style, fill } }) as Element;

function setup() {
  const doc: BoardDocument = {
    schemaVersion: 1,
    meta: { id: 'b' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements: [rect('a', 'token:brand'), rect('b', 'token:brand'), rect('c', '#000000'), rect('d', 'token:ghost')],
    assets: [],
    library: [{ id: 'l1', name: 'comp', elements: [rect('x', 'token:brand')], assets: [] } as never],
    tokens: { colors: { brand: '#ff0000' }, fonts: { body: 'Inter' } },
  };
  const history = new UndoHistory();
  const model = new BoardModel('/b.openboard', doc, { history });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerTokenTools(reg);
  const run = (name: string, input: unknown) => reg.invoke(name, input) as Promise<any>;
  return { model, run, history };
}
const fills = (m: BoardModel): string[] => m.getDocument().elements.map((e) => e.style.fill);

describe('token tools', () => {
  it('creates, updates, and lists tokens with reference counts', async () => {
    const { run, model } = setup();
    expect((await run('openboard.token.create', { category: 'numbers', name: 'gap', value: 8 })).name).toBe('gap');
    await run('openboard.token.update', { category: 'colors', name: 'brand', value: '#00ff00' });
    expect(model.getDocument().tokens?.colors?.brand).toBe('#00ff00');
    const list = await run('openboard.token.list', { category: 'colors' });
    expect(list.tokens).toEqual([{ category: 'colors', name: 'brand', value: '#00ff00', references: 3 }]);
  });

  it('rejects invalid names, values, duplicates, and reference values without changes', async () => {
    const { run, model } = setup();
    const before = JSON.stringify(model.getDocument());
    expect((await run('openboard.token.create', { category: 'colors', name: 'bad name', value: '#fff' })).error.code).toBe('invalid_name');
    expect((await run('openboard.token.create', { category: 'colors', name: 'brand', value: '#fff' })).error.code).toBe('duplicate_name');
    expect((await run('openboard.token.create', { category: 'colors', name: 'x', value: 'token:brand' })).error.code).toBe('token_reference_value');
    expect((await run('openboard.token.update', { category: 'numbers', name: 'x', value: 1 })).error.code).toBe('not_found');
    expect(JSON.stringify(model.getDocument())).toBe(before);
  });

  it('renames a token and rewrites elements and library entries in one undo step', async () => {
    const { run, model, history } = setup();
    const r = await run('openboard.token.rename', { category: 'colors', name: 'brand', newName: 'primary' });
    expect(r).toMatchObject({ elements: 2, library: 1 });
    expect(fills(model)).toEqual(['token:primary', 'token:primary', '#000000', 'token:ghost']);
    expect((model.getDocument().library[0] as any).elements[0].style.fill).toBe('token:primary');
    expect(Object.keys(model.getDocument().tokens!.colors!)).toEqual(['primary']);
    expect(history.undo(model)).toBe(true);
    expect(fills(model)).toEqual(['token:brand', 'token:brand', '#000000', 'token:ghost']);
    expect((model.getDocument().library[0] as any).elements[0].style.fill).toBe('token:brand');
    expect(model.getDocument().tokens!.colors).toEqual({ brand: '#ff0000' });
  });

  it('rejects delete with the reference count, then deletes an unused token', async () => {
    const { run, model } = setup();
    const err = (await run('openboard.token.delete', { category: 'colors', name: 'brand' })).error;
    expect(err.code).toBe('token_in_use');
    expect(err.message).toContain('3 references');
    expect(model.getDocument().tokens?.colors?.brand).toBe('#ff0000');
    await run('openboard.token.delete', { category: 'fonts', name: 'body' });
    expect(model.getDocument().tokens?.fonts).toBeUndefined();
  });

  it('detaches references to literals, using the default for a missing token', async () => {
    const { run, model } = setup();
    const out = await run('openboard.token.detach', {});
    expect(out.ids.sort()).toEqual(['a', 'b', 'd']);
    expect(fills(model)).toEqual(['#ff0000', '#ff0000', '#000000', 'theme:default']);
  });
});

describe('token tools: validation and rename edge cases (9.14)', () => {
  it('rejects invalid names (empty, too long, illegal characters) and leaves the document unchanged', async () => {
    const { run, model } = setup();
    const before = JSON.stringify(model.getDocument());
    for (const name of ['', 'a'.repeat(65), 'has space', 'semi;colon', 'sl/ash', 'ünï']) {
      expect((await run('openboard.token.create', { category: 'colors', name, value: '#fff' })).error.code).toBe('invalid_name');
    }
    expect((await run('openboard.token.rename', { category: 'colors', name: 'brand', newName: 'bad name' })).error.code).toBe('invalid_name');
    expect(JSON.stringify(model.getDocument())).toBe(before);
  });

  it('accepts a 64-character name and the allowed punctuation', async () => {
    const { run } = setup();
    expect((await run('openboard.token.create', { category: 'numbers', name: 'a'.repeat(64), value: 1 })).name).toBe('a'.repeat(64));
    expect((await run('openboard.token.create', { category: 'numbers', name: 'a-b_c.d', value: 1 })).name).toBe('a-b_c.d');
  });

  it('rejects duplicate names per category but allows the same name in another category', async () => {
    const { run, model } = setup();
    expect((await run('openboard.token.create', { category: 'fonts', name: 'body', value: 'Arial' })).error.code).toBe('duplicate_name');
    expect(model.getDocument().tokens?.fonts?.body).toBe('Inter');
    expect((await run('openboard.token.create', { category: 'numbers', name: 'brand', value: 3 })).name).toBe('brand');
  });

  it('rejects a Token_Reference as a value on create and update in every category', async () => {
    const { run, model } = setup();
    const before = JSON.stringify(model.getDocument());
    for (const category of ['colors', 'fonts', 'numbers']) {
      expect((await run('openboard.token.create', { category, name: 'n1', value: 'token:brand' })).error.code).toBe('token_reference_value');
    }
    expect((await run('openboard.token.update', { category: 'colors', name: 'brand', value: 'token:other' })).error.code).toBe('token_reference_value');
    expect((await run('openboard.token.update', { category: 'fonts', name: 'body', value: 'token:x' })).error.code).toBe('token_reference_value');
    expect(JSON.stringify(model.getDocument())).toBe(before);
  });

  it('rejects invalid values for the category without changes', async () => {
    const { run, model } = setup();
    const before = JSON.stringify(model.getDocument());
    expect((await run('openboard.token.create', { category: 'colors', name: 'c', value: 'notacolor' })).error.code).toBe('invalid_value');
    expect((await run('openboard.token.create', { category: 'numbers', name: 'n', value: 'x' })).error.code).toBe('invalid_value');
    expect((await run('openboard.token.create', { category: 'fonts', name: 'f', value: '' })).error.code).toBe('invalid_value');
    expect((await run('openboard.token.update', { category: 'colors', name: 'brand', value: 'zzz' })).error.code).toBe('invalid_value');
    expect(JSON.stringify(model.getDocument())).toBe(before);
  });

  it('rejects renaming onto an existing name or a missing token, with no change', async () => {
    const { run, model } = setup();
    await run('openboard.token.create', { category: 'colors', name: 'other', value: '#111111' });
    const before = JSON.stringify(model.getDocument());
    expect((await run('openboard.token.rename', { category: 'colors', name: 'brand', newName: 'other' })).error.code).toBe('duplicate_name');
    expect((await run('openboard.token.rename', { category: 'colors', name: 'nope', newName: 'fresh' })).error.code).toBe('not_found');
    expect(JSON.stringify(model.getDocument())).toBe(before);
  });

  it('rename leaves other tokens, literals, and unrelated references untouched', async () => {
    const { run, model } = setup();
    await run('openboard.token.create', { category: 'colors', name: 'brand2', value: '#222222' });
    await run('openboard.token.rename', { category: 'colors', name: 'brand', newName: 'primary' });
    const colors = model.getDocument().tokens!.colors!;
    expect(colors).toMatchObject({ primary: '#ff0000', brand2: '#222222' });
    expect(fills(model)).toEqual(['token:primary', 'token:primary', '#000000', 'token:ghost']);
  });

  it('rename rewrites Library entries and carries them through undo and redo', async () => {
    const { run, model, history } = setup();
    const lib = () => (model.getDocument().library[0] as any);
    expect((await run('openboard.token.rename', { category: 'colors', name: 'brand', newName: 'primary' })).library).toBe(1);
    expect(lib().id).toBe('l1');
    expect(lib().name).toBe('comp');
    expect(lib().elements[0].style.fill).toBe('token:primary');
    expect(model.getDocument().library).toHaveLength(1);
    history.undo(model);
    expect(lib().elements[0].style.fill).toBe('token:brand');
    history.redo(model);
    expect(lib().elements[0].style.fill).toBe('token:primary');
  });

  it('counts Library references when deleting and listing', async () => {
    const { run, model } = setup();
    // Free the element references so only the Library entry still references "brand".
    await run('openboard.token.detach', { category: 'colors', name: 'brand', ids: ['a', 'b'] });
    const err = (await run('openboard.token.delete', { category: 'colors', name: 'brand' })).error;
    expect(err.code).toBe('token_in_use');
    expect(err.message).toContain('1 reference');
    expect(err.message).not.toContain('1 references');
    expect(model.getDocument().tokens?.colors?.brand).toBe('#ff0000');
  });
});
