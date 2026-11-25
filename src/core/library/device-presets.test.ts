/**
 * Requirements 24.2-24.5: the phone, tablet, and browser Device_Frame_Preset masters have the exact
 * preset dimensions, clip their content, round their corners, and use icons only for glyphs.
 * Insertion sizes the instance at the preset dimensions (Req 24.1, 24.6, 24.10).
 */
import { describe, expect, it } from 'vitest';
import { buildFullRegistry } from '../../../test/helpers/registry';
import { BUILTIN_COMPONENTS } from './builtins';

type Radii = [number, number, number, number];
const PRESETS: { name: string; width: number; height: number; radii: Radii; glyphs: string[] }[] = [
  { name: 'phone', width: 390, height: 844, radii: [48, 48, 48, 48], glyphs: ['wifi', 'battery', 'bluetooth'] },
  { name: 'tablet', width: 820, height: 1180, radii: [32, 32, 32, 32], glyphs: ['wifi', 'battery', 'bluetooth'] },
  {
    name: 'browser',
    width: 1440,
    height: 900,
    radii: [12, 12, 0, 0],
    glyphs: ['arrow-left', 'arrow-right', 'refresh-cw', 'lock', 'ellipsis-vertical'],
  },
];

const entry = (name: string) => BUILTIN_COMPONENTS.find((c) => c.name === name)!;

describe.each(PRESETS)('$name device preset', (p) => {
  it('has exact dimensions, clips content, and rounds the specified corners', () => {
    const root = entry(p.name).elements[0] as any;
    expect(root.type).toBe('frame');
    expect(root.component).toBe(p.name);
    expect([root.width, root.height]).toEqual([p.width, p.height]);
    expect(root.clipContent).toBe(true);
    expect(root.style.cornerRadii).toEqual(p.radii);
    const [tl, tr, br, bl] = root.style.cornerRadii as Radii;
    expect(tl).toBeGreaterThan(0);
    expect(tr).toBeGreaterThan(0);
    if (p.name === 'browser') expect([br, bl]).toEqual([0, 0]);
    else {
      expect(br).toBeGreaterThan(0);
      expect(bl).toBeGreaterThan(0);
    }
  });

  it('uses icons only for status and toolbar glyphs', () => {
    const [, ...children] = entry(p.name).elements as any[];
    expect(children.map((c) => c.name)).toEqual(p.glyphs);
    for (const c of children) {
      expect(c.type).toBe('icon');
      expect(c.parentId).toBe(`${p.name}-root`);
    }
  });

  it('inserts a master plus an instance sized at the preset dimensions', async () => {
    const f = buildFullRegistry({ spy: false });
    const r = (await f.registry.invoke('openboard.library.insert', { component: p.name })) as any;
    expect(r.error).toBeUndefined();
    expect(r.ids).toHaveLength(entry(p.name).elements.length + 1);
    const els = f.model.getDocument().elements as any[];
    const inst = els.find((e) => e.id === r.ids[r.ids.length - 1])!;
    expect(inst.instanceOf).toBeDefined();
    expect([inst.width, inst.height]).toEqual([p.width, p.height]);
    expect(els.filter((e) => e.component === p.name)).toHaveLength(1);
  });
});

describe('device presets and the existing device outline', () => {
  it('keeps the plain device outline copy template', () => {
    const o = entry('device outline');
    expect(o.elements.map((e) => [e.width, e.height])).toEqual([[390, 780], [358, 668], [80, 16]]);
    expect(o.elements.every((e) => e.type === 'rectangle' || e.type === 'frame')).toBe(true);
  });
});
