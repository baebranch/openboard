import { describe, expect, it } from 'vitest';
import { effectiveSchemaVersion } from '../../src/core/format/schema-version';
import type { BoardDocument, Element } from '../../src/core/model';
import { normalise } from '../../src/core/tools/element-tools';

const size = { width: 10, height: 10 };
const layout = (over: Record<string, unknown> = {}) => ({
  direction: 'horizontal',
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  mainAlign: 'start',
  crossAlign: 'start',
  ...over,
});
const fail = (type: 'frame' | 'rectangle', props: Record<string, unknown>): string => {
  try {
    normalise(type, props, size, 'test');
  } catch (e) {
    return (e as Error).message;
  }
  return '';
};

describe('layout validation', () => {
  it('accepts boundary spacing values', () => {
    const n = normalise('frame', { layout: layout({ gap: 1000, padding: { top: 0, right: 1000, bottom: 0, left: 5 } }) }, size, 't');
    expect(n.top['layout']).toBeDefined();
  });
  it.each([
    ['gap', layout({ gap: 1001 }), 'layout.gap'],
    ['gap NaN', layout({ gap: Number.NaN }), 'layout.gap'],
    ['padding', layout({ padding: { top: -1, right: 0, bottom: 0, left: 0 } }), 'layout.padding.top'],
    ['direction', layout({ direction: 'diagonal' }), 'layout.direction'],
    ['mainAlign', layout({ mainAlign: 'stretch' }), 'layout.mainAlign'],
    ['crossAlign', layout({ crossAlign: 'spaceBetween' }), 'layout.crossAlign'],
  ])('rejects bad %s naming the path', (_n, value, path) => {
    expect(fail('frame', { layout: value })).toContain(path);
  });
  it('rejects layout on a non-frame and bad sizing', () => {
    expect(fail('rectangle', { layout: layout() })).toContain('unknown property');
    expect(fail('rectangle', { sizing: { width: 'auto', height: 'fixed' } })).toContain('sizing.width');
    expect(fail('rectangle', { ignoreLayout: 'yes' })).toContain('ignoreLayout');
  });
  it('null clears the fields', () => {
    const n = normalise('frame', { layout: null, sizing: null, ignoreLayout: null }, size, 't');
    expect(n.top).toEqual({ layout: undefined, sizing: undefined, ignoreLayout: undefined });
  });
});

describe('schema version clauses', () => {
  const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
  const el = (extra: Record<string, unknown>): Element =>
    ({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style, ...extra }) as Element;
  const doc = (elements: Element[]): BoardDocument =>
    ({ schemaVersion: 1, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [] }) as BoardDocument;
  it('is 1 without layout fields and 2 with any of them', () => {
    expect(effectiveSchemaVersion(doc([el({})]))).toBe(1);
    expect(effectiveSchemaVersion(doc([el({ sizing: { width: 'hug', height: 'fixed' } })]))).toBe(2);
    expect(effectiveSchemaVersion(doc([el({ ignoreLayout: true })]))).toBe(2);
    expect(effectiveSchemaVersion(doc([el({ type: 'frame', name: 'f', layout: layout() })]))).toBe(2);
  });
});
