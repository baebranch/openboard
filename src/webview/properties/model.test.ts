import { describe, expect, it } from 'vitest';
import type { Element } from '../../core/model';
import {
  buildUpdateOp,
  commitField,
  commitValue,
  fieldRows,
  fieldsFor,
  FIELDS,
  initFieldState,
  parseInput,
} from './model';

function rect(id: string, over: Record<string, unknown> = {}, style: Record<string, unknown> = {}): Element {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0, ...style },
    ...over,
  } as unknown as Element;
}

const def = (n: string) => FIELDS.find((f) => f.name === n)!;

describe('parseInput', () => {
  it('rejects non-numeric and empty text', () => {
    for (const t of ['', ' ', 'abc', '1,5', '--1', 'Infinity', '1e']) {
      expect(parseInput(def('x'), t).ok).toBe(false);
    }
  });
  it('accepts numbers', () => {
    expect(parseInput(def('x'), ' -3.5 ')).toEqual({ ok: true, value: -3.5 });
  });
});

describe('commitValue', () => {
  it('rounds x to 2 decimals and enforces size >= 1', () => {
    expect(commitValue(def('x'), '1.23456', [rect('a')])).toEqual({ ok: true, value: 1.23 });
    expect(commitValue(def('width'), '0.5', [rect('a')]).ok).toBe(false);
  });
  it('validates corner radius per element', () => {
    expect(commitValue(def('cornerRadius'), '25', [rect('a')]).ok).toBe(true);
    expect(commitValue(def('cornerRadius'), '26', [rect('a')]).ok).toBe(false);
    expect(commitValue(def('cornerRadius'), '25', [rect('a'), rect('b', { height: 10 })]).ok).toBe(false);
  });
  it('validates edge label length and routing', () => {
    expect(commitValue(def('label'), 'x'.repeat(200), []).ok).toBe(true);
    expect(commitValue(def('label'), 'x'.repeat(201), []).ok).toBe(false);
    expect(commitValue(def('routing'), 'zigzag', []).ok).toBe(false);
  });
  it('validates colors', () => {
    expect(commitValue(def('fill'), '#abc', [rect('a')]).ok).toBe(true);
    expect(commitValue(def('fill'), 'red', [rect('a')]).ok).toBe(false);
  });
});

describe('fieldsFor', () => {
  it('only shows fields applicable to all selected', () => {
    const names = (els: Element[]) => fieldsFor(els).map((f) => f.name);
    expect(names([rect('a')])).toContain('cornerRadius');
    expect(names([rect('a')])).not.toContain('fontSize');
    expect(names([rect('a', { type: 'edge' })])).toContain('routing');
    expect(names([rect('a'), rect('b', { type: 'edge' })])).not.toContain('routing');
    expect(names([])).toEqual([]);
  });
});

describe('fieldRows', () => {
  const rows = (els: Element[]) => fieldRows(fieldsFor(els)).map((r) => r.map((f) => f.name));

  it('pairs rectangle fields', () => {
    expect(rows([rect('a')])).toEqual([
      ['x', 'y'],
      ['width', 'height'],
      ['rotation', 'cornerRadius'],
      ['fill', 'stroke'],
      ['strokeWidth', 'strokeStyle'],
      ['opacity'],
    ]);
  });

  it('puts rotation alone when cornerRadius does not apply (ellipse)', () => {
    const r = rows([rect('a', { type: 'ellipse' })]);
    expect(r).toContainEqual(['rotation']);
    expect(r.flat()).not.toContain('cornerRadius');
  });

  it('builds edge rows', () => {
    const r = rows([rect('a', { type: 'edge' })]);
    expect(r).toContainEqual(['routing']);
    expect(r).toContainEqual(['sourceArrow', 'targetArrow']);
    expect(r).toContainEqual(['label']);
  });

  it('lists every applicable field exactly once', () => {
    for (const type of ['rectangle', 'ellipse', 'edge', 'text', 'sticky', 'freehand']) {
      const fields = fieldsFor([rect('a', { type })]);
      const flat = fieldRows(fields).flat().map((f) => f.name);
      expect([...flat].sort()).toEqual(fields.map((f) => f.name).sort());
    }
  });

  it('puts unlisted fields alone, in FIELDS order, after the listed rows', () => {
    const extra = { name: 'zzz', label: 'Z', kind: 'number' } as const;
    const extra2 = { name: 'yyy', label: 'Y2', kind: 'number' } as const;
    const out = fieldRows([extra, def('x'), extra2]).map((r) => r.map((f) => f.name));
    expect(out).toEqual([['x'], ['zzz'], ['yyy']]);
  });
});

describe('commitField state machine', () => {
  const els = [rect('a'), rect('b', {}, { opacity: 50 })];

  it('shows mixed for differing values', () => {
    const s = initFieldState(els, 'opacity');
    expect(s.mixed).toBe(true);
    expect(initFieldState(els, 'strokeWidth').mixed).toBe(false);
  });

  it('accepting applies to all selected elements', () => {
    const s = initFieldState(els, 'opacity');
    const out = commitField(s, def('opacity'), '80', els);
    expect(out.op).toEqual(buildUpdateOp(['a', 'b'], { opacity: 80 }));
    expect(out.state).toMatchObject({ committed: '80', mixed: false });
    expect(out.state.error).toBeUndefined();
  });

  it('rejection retains previous value and sets error', () => {
    const s = initFieldState([rect('a')], 'opacity');
    const out = commitField({ ...s, draft: '500' }, def('opacity'), '500', [rect('a')]);
    expect(out.op).toBeUndefined();
    expect(out.state.draft).toBe('100');
    expect(out.state.committed).toBe('100');
    expect(out.state.error).toBeTruthy();
    const bad = commitField(s, def('opacity'), 'abc', [rect('a')]);
    expect(bad.state.error).toBeTruthy();
  });

  it('does not dispatch when unchanged or untouched mixed', () => {
    const s = initFieldState([rect('a')], 'opacity');
    expect(commitField(s, def('opacity'), '100', [rect('a')]).op).toBeUndefined();
    expect(commitField(initFieldState(els, 'opacity'), def('opacity'), '', els).op).toBeUndefined();
  });
});
