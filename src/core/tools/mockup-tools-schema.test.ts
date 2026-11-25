/**
 * Schema validity for the mockup Agent_Tools (Req 25.11 to 25.13, 28.7): each new tool accepts a
 * valid input and rejects an invalid one, accepts a valid output and rejects an invalid one, and a
 * missing item or invalid field leaves the document unchanged.
 */
import { describe, expect, it } from 'vitest';
import { buildFullRegistry } from '../../../test/helpers/registry';
import { defaultValidatorFactory } from './json-schema';

interface Case {
  tool: string;
  validIn: unknown;
  invalidIn: unknown;
  validOut: unknown;
  invalidOut: unknown;
}

const cases: Case[] = [
  {
    tool: 'openboard.token.create',
    validIn: { category: 'colors', name: 'brand', value: '#ff0000' },
    invalidIn: { category: 'shadows', name: 'brand', value: '#ff0000' },
    validOut: { category: 'colors', name: 'brand', value: '#ff0000' },
    invalidOut: { category: 'colors', name: 'brand' },
  },
  {
    tool: 'openboard.token.update',
    validIn: { category: 'numbers', name: 'gap', value: 8 },
    invalidIn: { category: 'numbers', name: 'gap', value: true },
    validOut: { category: 'numbers', name: 'gap', value: 8 },
    invalidOut: { category: 'numbers', name: 5, value: 8 },
  },
  {
    tool: 'openboard.token.rename',
    validIn: { category: 'colors', name: 'a', newName: 'b' },
    invalidIn: { category: 'colors', name: 'a' },
    validOut: { category: 'colors', name: 'a', newName: 'b', elements: 1, library: 0 },
    invalidOut: { category: 'colors', name: 'a', newName: 'b', elements: -1, library: 0 },
  },
  {
    tool: 'openboard.token.delete',
    validIn: { category: 'fonts', name: 'body' },
    invalidIn: { name: 'body' },
    validOut: { category: 'fonts', name: 'body' },
    invalidOut: { category: 'fonts' },
  },
  {
    tool: 'openboard.token.list',
    validIn: { category: 'colors' },
    invalidIn: { category: 'nope' },
    validOut: { tokens: [{ category: 'colors', name: 'a', value: '#fff', references: 0 }] },
    invalidOut: { tokens: [{ category: 'colors', name: 'a', value: '#fff', references: 'x' }] },
  },
  {
    tool: 'openboard.token.detach',
    validIn: { ids: ['a'], category: 'colors', name: 'brand' },
    invalidIn: { ids: [] },
    validOut: { ids: ['a'] },
    invalidOut: { ids: 'a' },
  },
  {
    tool: 'openboard.token.mode',
    validIn: { mode: 'dark' },
    invalidIn: { mode: 'sepia' },
    validOut: { mode: 'dark' },
    invalidOut: { mode: 'sepia' },
  },
  {
    tool: 'openboard.component.create',
    validIn: { ids: ['a'], name: 'Card' },
    invalidIn: { ids: [], name: 'Card' },
    validOut: { id: 'a', name: 'Card', wrapped: false },
    invalidOut: { id: 'a', name: 'Card', wrapped: 'no' },
  },
  {
    tool: 'openboard.component.remove',
    validIn: { id: 'a' },
    invalidIn: { id: '' },
    validOut: { id: 'a', detached: [] },
    invalidOut: { id: 'a' },
  },
  {
    tool: 'openboard.component.list',
    validIn: {},
    invalidIn: { board: '' },
    validOut: { components: [{ id: 'a', name: 'Card', width: 1, height: 2, instances: 0 }] },
    invalidOut: { components: [{ id: 'a', name: 'Card', width: 1, height: 2 }] },
  },
  {
    tool: 'openboard.component.instance.create',
    validIn: { master: 'M', x: 1, y: 2, parentId: 'P' },
    invalidIn: { x: 1 },
    validOut: { id: 'i', master: 'M', x: 1, y: 2 },
    invalidOut: { id: 'i', master: 'M', x: 'a', y: 2 },
  },
  {
    tool: 'openboard.component.instance.override.set',
    validIn: { id: 'i::r', property: 'fill', value: '#fff' },
    invalidIn: { id: 'i::r', property: 'bogus', value: '#fff' },
    validOut: { id: 'i', key: 'r', property: 'fill' },
    invalidOut: { id: 'i', key: 'r' },
  },
  {
    tool: 'openboard.component.instance.override.reset',
    validIn: { id: 'i', childId: 'r', property: 'fill' },
    invalidIn: { id: 'i', property: 'bogus' },
    validOut: { id: 'i', removed: 1 },
    invalidOut: { id: 'i', removed: -1 },
  },
  {
    tool: 'openboard.component.instance.detach',
    validIn: { id: 'i' },
    invalidIn: {},
    validOut: { id: 'i', children: 2 },
    invalidOut: { id: 'i', children: 1.5 },
  },
  {
    tool: 'openboard.icon.search',
    validIn: { keyword: 'arrow' },
    invalidIn: { keyword: '' },
    validOut: { names: ['arrow-left'] },
    invalidOut: { names: [1] },
  },
  {
    tool: 'openboard.library.insert',
    validIn: { component: 'button', x: 1, y: 2 },
    invalidIn: { component: '' },
    validOut: { ids: ['a'] },
    invalidOut: { ids: 'a' },
  },
  {
    tool: 'openboard.element.query',
    validIn: { instanceOf: 'M', component: 'Card', parentId: 'P', tokenRef: 'brand', limit: 5 },
    invalidIn: { tokenRef: '' },
    validOut: { items: [], total: 0, offset: 0 },
    invalidOut: { items: [], total: 'x', offset: 0 },
  },
];

describe('mockup tool schemas', () => {
  const { registry } = buildFullRegistry({ spy: false });
  const compile = (s: Record<string, unknown>) => defaultValidatorFactory.compile(s);

  it.each(cases)('$tool: input and output schemas accept valid and reject invalid data', (c) => {
    const d = registry.describe(c.tool);
    const vin = compile(d.inputSchema as Record<string, unknown>);
    const vout = compile(d.outputSchema as Record<string, unknown>);
    expect(vin(c.validIn).ok).toBe(true);
    expect(vin(c.invalidIn).ok).toBe(false);
    expect(vout(c.validOut).ok).toBe(true);
    expect(vout(c.invalidOut).ok).toBe(false);
  });

  it('element.create and element.update accept valid mockup fields and reject invalid ones', () => {
    const create = compile(registry.describe('openboard.element.create').inputSchema as Record<string, unknown>);
    const update = compile(registry.describe('openboard.element.update').inputSchema as Record<string, unknown>);
    expect(create({ elements: [{ type: 'rectangle', cornerRadii: [1, 2, 3, 4], fill: 'token:brand' }] }).ok).toBe(true);
    expect(create({ elements: [{ type: 'bogus' }] }).ok).toBe(false);
    expect(update({ ids: ['a'], set: { fontWeight: 700 } }).ok).toBe(true);
    expect(update({ ids: ['a'] }).ok).toBe(false);
  });
});

describe('mockup tool errors leave the document unchanged', () => {
  async function seeded() {
    const f = buildFullRegistry({ spy: false });
    const run = (name: string, input: unknown) => f.registry.invoke(name, input) as Promise<any>;
    const made = await run('openboard.element.create', {
      elements: [{ type: 'rectangle', id: 'r', width: 50, height: 50 }],
    });
    expect(made.error).toBeUndefined();
    expect((await run('openboard.token.create', { category: 'colors', name: 'brand', value: '#ff0000' })).error).toBeUndefined();
    const comp = await run('openboard.component.create', { ids: ['r'], name: 'Card' });
    expect(comp.error).toBeUndefined();
    const inst = await run('openboard.component.instance.create', { master: comp.id, x: 300, y: 0 });
    expect(inst.error).toBeUndefined();
    return { ...f, run, master: comp.id as string, inst: inst.id as string };
  }

  it('reports a missing item with its identifier', async () => {
    const { run, model } = await seeded();
    const before = JSON.stringify(model.getDocument());
    const missing: Array<[string, unknown, string]> = [
      ['openboard.token.update', { category: 'colors', name: 'ghost', value: '#fff' }, 'ghost'],
      ['openboard.token.rename', { category: 'colors', name: 'ghost', newName: 'x' }, 'ghost'],
      ['openboard.token.delete', { category: 'colors', name: 'ghost' }, 'ghost'],
      ['openboard.token.detach', { ids: ['nope-el'] }, 'nope-el'],
      ['openboard.component.create', { ids: ['nope-el'], name: 'X' }, 'nope-el'],
      ['openboard.component.remove', { id: 'nope-el' }, 'nope-el'],
      ['openboard.component.instance.create', { master: 'nope-el' }, 'nope-el'],
      ['openboard.component.instance.override.set', { id: 'nope-el', property: 'fill', value: '#fff' }, 'nope-el'],
      ['openboard.component.instance.override.reset', { id: 'nope-el' }, 'nope-el'],
      ['openboard.component.instance.detach', { id: 'nope-el' }, 'nope-el'],
      ['openboard.library.insert', { component: 'nope-lib' }, 'nope-lib'],
    ];
    for (const [tool, input, ident] of missing) {
      const r = await run(tool, input);
      expect(r.error, tool).toBeDefined();
      expect(r.error.message, tool).toContain(ident);
      expect(JSON.stringify(model.getDocument()), tool).toBe(before);
    }
  });

  it('rejects an invalid field with an error naming it', async () => {
    const { run, model, inst } = await seeded();
    const before = JSON.stringify(model.getDocument());
    const bad: Array<[string, unknown, string]> = [
      ['openboard.token.create', { category: 'colors', name: 'bad name', value: '#fff' }, 'name'],
      ['openboard.token.create', { category: 'colors', name: 'x', value: 'token:brand' }, 'token'],
      ['openboard.component.instance.override.set', { id: `${inst}::r`, property: 'fontWeight', value: 450 }, 'fontWeight'],
      ['openboard.element.update', { ids: ['r'], set: { cornerRadii: [1, 2, 3] } }, 'cornerRadii'],
      ['openboard.element.create', { elements: [{ type: 'rectangle', cornerRadii: [1, 2, 3, -1] }] }, 'cornerRadii'],
    ];
    for (const [tool, input, field] of bad) {
      const r = await run(tool, input);
      expect(r.error, tool).toBeDefined();
      expect(JSON.stringify(r.error), tool).toContain(field);
      expect(JSON.stringify(model.getDocument()), tool).toBe(before);
    }
  });

  it('rejects schema-invalid input before any handler runs', async () => {
    const { run, model } = await seeded();
    const before = JSON.stringify(model.getDocument());
    for (const c of cases) {
      if (c.tool === 'openboard.icon.search') continue;
      const r = await run(c.tool, c.invalidIn);
      expect(r.error?.code, c.tool).toBe('invalid_input');
    }
    expect(JSON.stringify(model.getDocument())).toBe(before);
  });
});
