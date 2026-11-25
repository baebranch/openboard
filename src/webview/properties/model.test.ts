import { describe, expect, it } from 'vitest';
import type { Element } from '../../core/model';
import {
  buildApplyTokenOp,
  buildDetachTokenOp,
  summarizeTokenField,
  buildCornerCommit,
  buildFitCommit,
  buildRemoveImageFill,
  summarizeImageFill,
  buildUpdateOp,
  commitCorner,
  initCornerState,
  commitField,
  commitValue,
  fieldRows,
  fieldSections,
  fieldsFor,
  FIELDS,
  initFieldState,
  initFieldStateFor,
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

describe('corner fields', () => {
  it('linked commit sets cornerRadius and removes cornerRadii in one op', () => {
    const r = buildCornerCommit([rect('a', {}, { cornerRadii: [1, 2, 3, 4] })], 'linked', '8');
    expect(r).toEqual({ ok: true, op: buildUpdateOp(['a'], { cornerRadius: 8, cornerRadii: null }) });
  });
  it('single corner creates cornerRadii from cornerRadius, or edits only that corner', () => {
    expect(buildCornerCommit([rect('a', {}, { cornerRadius: 5 })], 1, '9')).toEqual({
      ok: true,
      op: buildUpdateOp(['a'], { cornerRadii: [5, 9, 5, 5] }),
    });
    expect(buildCornerCommit([rect('a', {}, { cornerRadii: [1, 2, 3, 4] })], 3, '0')).toEqual({
      ok: true,
      op: buildUpdateOp(['a'], { cornerRadii: [1, 2, 3, 0] }),
    });
  });
  it('rejects out-of-range values and keeps the previous value', () => {
    const els = [rect('a', {}, { cornerRadius: 5 })];
    const s = initCornerState(els, 0);
    const out = commitCorner(s, 0, '26', els);
    expect(out.op).toBeUndefined();
    expect(out.state.error).toBeDefined();
    expect(out.state.draft).toBe('5');
  });
  it('shows mixed values for differing selections', () => {
    const els = [rect('a', {}, { cornerRadius: 5 }), rect('b', {}, { cornerRadii: [5, 6, 5, 5] })];
    expect(initCornerState(els, 0).mixed).toBe(false);
    expect(initCornerState(els, 1).mixed).toBe(true);
    expect(initCornerState(els, 'linked').mixed).toBe(true);
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

describe('image fill field', () => {
  const filled = (id: string, fit = 'cover', assetId = 'a1') => rect(id, {}, { imageFill: { assetId, fit } });

  it('applies to shapes but not text or edges', () => {
    const names = (type: string) => fieldsFor([rect('a', { type })]).map((f) => f.name);
    expect(names('rectangle')).toContain('imageFill');
    expect(names('text')).not.toContain('imageFill');
    expect(names('edge')).not.toContain('imageFill');
  });

  it('summarizes fit and mixed selections', () => {
    expect(summarizeImageFill([filled('a'), filled('b')])).toEqual({ has: true, mixed: false, fit: 'cover' });
    expect(summarizeImageFill([filled('a'), rect('b')]).mixed).toBe(true);
    expect(summarizeImageFill([rect('a')])).toEqual({ has: false, mixed: false });
  });

  it('fit commit keeps the asset and changes only the fit', () => {
    const r = buildFitCommit([filled('a'), filled('b')], 'contain');
    expect(r).toEqual({ ok: true, op: buildUpdateOp(['a', 'b'], { imageFill: { assetId: 'a1', fit: 'contain' } }) });
  });

  it('fit commit rejects invalid fit, missing fill and differing assets', () => {
    expect(buildFitCommit([filled('a')], 'tile').ok).toBe(false);
    expect(buildFitCommit([rect('a')], 'cover').ok).toBe(false);
    expect(buildFitCommit([filled('a'), filled('b', 'cover', 'a2')], 'cover').ok).toBe(false);
  });

  it('remove deletes imageFill in one op', () => {
    expect(buildRemoveImageFill([filled('a')])).toEqual(buildUpdateOp(['a'], { imageFill: null }));
  });
});

describe('fieldRows', () => {
  const rows = (els: Element[]) => fieldRows(fieldsFor(els)).map((r) => r.map((f) => f.name));

  it('pairs rectangle fields', () => {
    expect(rows([rect('a')])).toEqual([
      ['x', 'y'],
      ['rotation'],
      ['width', 'height'],
      ['opacity', 'cornerRadius'],
      ['cornerRadii'],
      ['fill'],
      ['imageFill'],
      ['stroke'],
      ['strokeWidth'],
      ['strokeStyle'],
    ]);
  });

  it('groups rectangle rows into titled sections, dropping empty ones', () => {
    const secs = fieldSections(fieldsFor([rect('a')])).map((s) => s.id);
    expect(secs).toEqual(['position', 'dimensions', 'appearance', 'fill', 'stroke']);
    // A section the view fills itself can be kept even without fields.
    expect(fieldSections([], new Set(['dimensions'])).map((s) => s.id)).toEqual(['dimensions']);
  });

  it('shows the default of an optional enum the element does not store', () => {
    const sticky = rect('s', { type: 'sticky' });
    const wrap = FIELDS.find((f) => f.name === 'textWrap')!;
    expect(initFieldStateFor([sticky], wrap).draft).toBe('none');
    expect(initFieldStateFor([rect('w', { type: 'sticky', textWrap: 'wrap' })], wrap).draft).toBe('wrap');
    expect(initFieldStateFor([sticky], FIELDS.find((f) => f.name === 'fontWeight')!).draft).toBe('400');
    // No selection: nothing to show.
    expect(initFieldStateFor([], wrap).draft).toBe('');
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

describe('font weight and text color fields', () => {
  const sticky = (over: Record<string, unknown> = {}) => rect('s', { type: 'sticky', ...over });

  it('applies only to text-bearing types', () => {
    expect(fieldsFor([{ type: 'sticky' }]).map((f) => f.name)).toEqual(expect.arrayContaining(['fontWeight', 'textColor']));
    expect(fieldsFor([{ type: 'rectangle' }]).map((f) => f.name)).not.toContain('fontWeight');
  });
  it('commits a valid weight as a number', () => {
    expect(commitValue(def('fontWeight'), '600', [sticky()])).toEqual({ ok: true, value: 600 });
  });
  it('rejects empty, non-integer and out-of-step weights, retaining the previous value', () => {
    for (const bad of ['', '650', '1.5', '0', '1000', 'bold', '-400']) {
      expect(commitValue(def('fontWeight'), bad, [sticky()]).ok).toBe(false);
    }
    const state = initFieldState([sticky({ fontWeight: 500 })], 'fontWeight');
    const out = commitField(state, def('fontWeight'), '450', [sticky({ fontWeight: 500 })]);
    expect(out.op).toBeUndefined();
    expect(out.state.draft).toBe('500');
    expect(out.state.error).toBeDefined();
  });
  it('text color commit writes only textColor', () => {
    const els = [sticky()];
    const out = commitField(initFieldState(els, 'textColor'), def('textColor'), '#112233', els);
    expect(out.op).toEqual(buildUpdateOp(['s'], { textColor: '#112233' }));
  });
  it('stroke commit does not include textColor', () => {
    const els = [sticky({ textColor: '#112233' })];
    const out = commitField(initFieldState(els, 'stroke'), def('stroke'), '#ff0000', els);
    expect(out.op).toEqual(buildUpdateOp(['s'], { stroke: '#ff0000' }));
  });
});

describe('text wrap field', () => {
  const sticky = (over: Record<string, unknown> = {}) => rect('s', { type: 'sticky', ...over });

  it('applies only to text-bearing types', () => {
    expect(fieldsFor([{ type: 'flowNode' }]).map((f) => f.name)).toContain('textWrap');
    expect(fieldsFor([{ type: 'rectangle' }]).map((f) => f.name)).not.toContain('textWrap');
  });
  it('commits none and wrap, writing only textWrap', () => {
    const els = [sticky()];
    const out = commitField(initFieldState(els, 'textWrap'), def('textWrap'), 'wrap', els);
    expect(out.op).toEqual(buildUpdateOp(['s'], { textWrap: 'wrap' }));
  });
  it('rejects other values, retaining the previous value', () => {
    const els = [sticky({ textWrap: 'wrap' })];
    const out = commitField(initFieldState(els, 'textWrap'), def('textWrap'), 'auto', els);
    expect(out.op).toBeUndefined();
    expect(out.state.draft).toBe('wrap');
    expect(out.state.error).toBeDefined();
  });
});

describe('clip content field', () => {
  const frame = (over: Record<string, unknown> = {}) => rect('f', { type: 'frame', ...over });

  it('applies only to frames', () => {
    expect(fieldsFor([{ type: 'frame' }]).map((f) => f.name)).toContain('clipContent');
    expect(fieldsFor([{ type: 'rectangle' }]).map((f) => f.name)).not.toContain('clipContent');
  });
  it('toggles to a boolean in a single update op', () => {
    const els = [frame()];
    const on = commitField(initFieldState(els, 'clipContent'), def('clipContent'), 'true', els);
    expect(on.op).toEqual(buildUpdateOp(['f'], { clipContent: true }));
    const els2 = [frame({ clipContent: true })];
    const off = commitField(initFieldState(els2, 'clipContent'), def('clipContent'), 'false', els2);
    expect(off.op).toEqual(buildUpdateOp(['f'], { clipContent: false }));
  });
  it('rejects non-boolean text, retaining the previous value', () => {
    const els = [frame({ clipContent: true })];
    const out = commitField(initFieldState(els, 'clipContent'), def('clipContent'), 'maybe', els);
    expect(out.op).toBeUndefined();
    expect(out.state.draft).toBe('true');
    expect(out.state.error).toBeDefined();
  });
});

describe('token fields (Req 11.9, 11.12, 11.17)', () => {
  const tokens = { colors: { brand: '#112233', alt: '#445566' }, fonts: { body: 'Inter' } };

  it('applies a token to a color field only from the matching category', () => {
    const r = buildApplyTokenOp([rect('a'), rect('b')], def('fill'), 'brand', tokens);
    expect(r).toEqual({ ok: true, op: buildUpdateOp(['a', 'b'], { fill: 'token:brand' }) });
    expect(buildApplyTokenOp([rect('a')], def('fill'), 'body', tokens).ok).toBe(false);
    expect(buildApplyTokenOp([rect('a')], def('width'), 'brand', tokens).ok).toBe(false);
  });

  it('summarizes referenced, mixed and missing tokens', () => {
    expect(summarizeTokenField([rect('a', {}, { fill: 'token:brand' })], def('fill'), tokens)).toEqual({ name: 'brand', hasRef: true, mixed: false, missing: false });
    expect(summarizeTokenField([rect('a', {}, { fill: 'token:gone' })], def('fill'), tokens)).toMatchObject({ name: 'gone', missing: true });
    expect(summarizeTokenField([rect('a', {}, { fill: 'token:brand' }), rect('b')], def('fill'), tokens)).toMatchObject({ mixed: true, hasRef: true });
    expect(summarizeTokenField([rect('a')], def('fill'), tokens).hasRef).toBe(false);
  });

  it('detaches to the resolved literal, or the default for a missing token', () => {
    expect(buildDetachTokenOp([rect('a', {}, { fill: 'token:brand' })], def('fill'), tokens)).toEqual({ ok: true, op: buildUpdateOp(['a'], { fill: '#112233' }) });
    expect(buildDetachTokenOp([rect('a', {}, { fill: 'token:gone' })], def('fill'), tokens)).toEqual({ ok: true, op: buildUpdateOp(['a'], { fill: 'theme:default' }) });
    const text = { ...rect('t', {}, { fontFamily: 'token:nope' }), type: 'text' } as unknown as Element;
    expect(buildDetachTokenOp([text], def('fontFamily'), tokens)).toEqual({ ok: true, op: buildUpdateOp(['t'], { fontFamily: 'sans-serif' }) });
  });

  it('rejects detach with nothing referenced or differing literals', () => {
    expect(buildDetachTokenOp([rect('a')], def('fill'), tokens).ok).toBe(false);
    const two = [rect('a', {}, { fill: 'token:brand' }), rect('b', {}, { fill: 'token:alt' })];
    expect(buildDetachTokenOp(two, def('fill'), tokens).ok).toBe(false);
  });
});
