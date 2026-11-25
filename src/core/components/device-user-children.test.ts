/**
 * Requirements 24.7, 24.8: an Element added inside a Device_Frame_Preset instance is a User_Child that
 * survives the Sync_Pass and moves with the instance, and the export draws it clipped to the device shape
 * without touching its stored geometry.
 */
import { describe, expect, it } from 'vitest';
import { renderToSvg } from '../export/svg';
import { BUILTIN_COMPONENTS } from '../library/builtins';
import type { Element } from '../model/types';
import { BoardModel, UndoHistory } from '../ops';
import { registerArrangeTools } from '../tools/arrange-tools';
import { registerElementTools } from '../tools/element-tools';
import { DefaultToolRegistry } from '../tools/registry';

const style = { fill: '#00ff00', stroke: '#000000', strokeWidth: 0, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const rect = (id: string, extra: object = {}): Element =>
  ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style, ...extra }) as Element;

function setup() {
  const preset = BUILTIN_COMPONENTS.find((c) => c.id === 'builtin:phone')!;
  const model = new BoardModel(
    '/b.openboard',
    { schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements: [], assets: [], library: [] },
    { history: new UndoHistory() },
  );
  model.transact('seed', (tx) => {
    for (const e of preset.elements) tx.create(structuredClone(e) as never);
    tx.create({
      id: 'I', type: 'frame', name: 'phone', x: 1000, y: 2000, width: 390, height: 844, rotation: 0,
      style: { ...style, fill: 'theme:default' }, instanceOf: 'phone-root',
    } as never);
  });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerElementTools(reg);
  registerArrangeTools(reg);
  const els = () => model.getDocument().elements as Element[];
  const get = (id: string) => els().find((e) => e.id === id) as Element;
  return { model, reg, els, get };
}

describe('User_Children inside a device preset instance', () => {
  it('stores an element created inside the instance as a User_Child that every later sync keeps', async () => {
    const { model, reg, get } = setup();
    expect(get('I::phone-wifi')).toBeDefined(); // Instance_Child
    await reg.invoke('openboard.element.create', { elements: [{ type: 'rectangle', x: 1010, y: 2010, width: 50, height: 50, parentId: 'I' }] });
    const user = (model.getDocument().elements as Element[]).find((e) => e.parentId === 'I' && !e.id.startsWith('I::'))!;
    expect(user).toBeDefined();
    model.transact('touch', (tx) => tx.update('I', { x: 1000 } as never)); // forces another Sync_Pass
    expect(get(user.id)).toMatchObject({ parentId: 'I', x: 1010, y: 2010 });
  });

  it('adopts an existing element dropped into the instance via parentId and keeps it a User_Child', async () => {
    const { model, reg, get } = setup();
    model.transact('add', (tx) => tx.create(rect('r', { x: 1020, y: 2020 }) as never));
    await reg.invoke('openboard.element.update', { ids: ['r'], set: { parentId: 'I' } });
    model.transact('touch', (tx) => tx.update('I', { name: 'phone 2' } as never));
    expect(get('r').parentId).toBe('I');
  });

  it('moves with the instance, along with the Instance_Children', async () => {
    const { model, reg, get } = setup();
    model.transact('add', (tx) => tx.create(rect('r', { x: 1020, y: 2020, parentId: 'I' }) as never));
    const wifi = get('I::phone-wifi');
    await reg.invoke('openboard.element.arrange', { action: 'nudge', ids: ['I'], dx: 1, dy: 0, amount: 10 });
    expect(get('I').x).toBe(1010);
    expect(get('r')).toMatchObject({ x: 1030, y: 2020 });
    expect(get('I::phone-wifi').x).toBe(wifi.x + 10);
  });
});

describe('clipping User_Children inside a device preset instance', () => {
  const render = (els: Element[]): string => {
    const r = renderToSvg({ elements: els, assets: [] }, { kind: 'board' });
    if (!r.ok) throw new Error('export failed');
    return r.value.svg;
  };

  it('wraps User_Children and Instance_Children in the instance clip and keeps stored geometry', () => {
    const { model, get } = setup();
    // Sticks out past the right and bottom edges of the 390 x 844 device.
    model.transact('add', (tx) => tx.create(rect('out', { x: 1380, y: 2830, width: 100, height: 100, parentId: 'I' }) as never));
    const before = structuredClone(get('out'));
    const svg = render(model.getDocument().elements as Element[]);

    // The clipPath uses the instance geometry and the master's rounded corners.
    const def = /<clipPath id="clipc-I">(.*?)<\/clipPath>/.exec(svg);
    expect(def).not.toBeNull();
    expect(def![1]).toContain('1000');
    expect(def![1]).toContain('A'); // rounded corner arcs (master cornerRadii 48)

    // Both kinds of children are drawn through the clip.
    const outAt = svg.indexOf('width="100" height="100"');
    expect(svg.lastIndexOf('<g clip-path="url(#clipc-I)">', outAt)).toBeGreaterThan(-1);
    expect(svg.match(/<g clip-path="url\(#clipc-I\)">/g)!.length).toBeGreaterThan(1);

    expect(get('out')).toEqual(before);
  });

  it('does not clip children of an instance whose master does not clip', () => {
    const { model, get } = setup();
    model.transact('off', (tx) => tx.update('phone-root', { clipContent: false } as never));
    model.transact('add', (tx) => tx.create(rect('out', { x: 1380, y: 2830, parentId: 'I' }) as never));
    expect(get('out')).toBeDefined();
    expect(render(model.getDocument().elements as Element[])).not.toContain('clipc-I');
  });
});
