import { describe, expect, it } from 'vitest';
import type { TextElement } from '../../core/model/types';
import { MAX_IMAGE_BYTES } from '../../core/image';
import { beginEdit, createTextOp, editTargetForDoubleClick, endEdit, styleForShortcut, toggleStyle } from './editSession';
import { measure } from '../../core/text';
import { softBreakOffsets, textPadding } from './caret';
import { altTextOp, classifyPasteText, clampCrop, planImageImports, planReplaceSource } from './media';

const text = (runs: TextElement['runs']): TextElement => ({
  id: 't1',
  type: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  rotation: 0,
  style: { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 },
  runs,
  fontFamily: 'sans-serif',
  fontSize: 16,
  align: 'left',
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const decodeOk = async () => ({ width: 40, height: 20 });

describe('edit session', () => {
  it('deletes an empty text element on exit', () => {
    const el = text([{ text: '' }]);
    const out = endEdit(beginEdit(el, true), el, [{ text: '' }]);
    expect(out.kind).toBe('delete');
  });
  it('commits changed runs as one update and ignores unchanged text', () => {
    const el = text([{ text: 'hi' }]);
    const s = beginEdit(el);
    expect(endEdit(s, el, [{ text: 'hi' }]).kind).toBe('none');
    const out = endEdit(s, el, [{ text: 'hi!' }]);
    expect(out).toMatchObject({ kind: 'update', op: { tool: 'openboard.element.update', input: { ids: ['t1'], set: { runs: [{ text: 'hi!' }] } } } });
  });
  it('toggles bold on a range and maps shortcuts', () => {
    const on = toggleStyle([{ text: 'abcd' }], 1, 3, 'bold');
    expect(on).toEqual([{ text: 'a' }, { text: 'bc', bold: true }, { text: 'd' }]);
    expect(toggleStyle(on, 1, 3, 'bold')).toEqual([{ text: 'abcd' }]);
    expect(styleForShortcut({ key: 'B', ctrlKey: true, metaKey: false })).toBe('bold');
    expect(styleForShortcut({ key: 'u', ctrlKey: false, metaKey: true })).toBe('underline');
    expect(styleForShortcut({ key: 'b', ctrlKey: false, metaKey: false })).toBeUndefined();
  });
  it('only edits unlocked text-bearing elements outside read-only mode', () => {
    const el = text([{ text: 'x' }]);
    expect(editTargetForDoubleClick(el, false)).toBe(el);
    expect(editTargetForDoubleClick(el, true)).toBeUndefined();
    expect(editTargetForDoubleClick({ ...el, locked: true }, false)).toBeUndefined();
  });
  it('creates text with a caller-chosen id', () => {
    const op = createTextOp('n1', { x: 1, y: 2, width: 200, height: 32 });
    expect(op.input).toMatchObject({ elements: [{ id: 'n1', type: 'text', x: 1, y: 2 }] });
  });
});

describe('paste classification', () => {
  it('imports a valid Mermaid flowchart', () => {
    const c = classifyPasteText('flowchart TD\n  A[Start] --> B[End]', { x: 5, y: 6 });
    expect(c).toMatchObject({ kind: 'mermaid', op: { tool: 'openboard.import', input: { source: 'mermaid', x: 5, y: 6 } } });
  });
  it('reports the line number of a Mermaid syntax error', () => {
    const c = classifyPasteText('flowchart TD\n  A[Start --> \n');
    expect(c.kind).toBe('mermaid-error');
    if (c.kind === 'mermaid-error') expect(c.message).toContain(`line ${c.line}`);
  });
  it('leaves ordinary text alone', () => {
    expect(classifyPasteText('hello world').kind).toBe('other');
  });
});

describe('image batches', () => {
  it('handles each file independently', async () => {
    const plan = await planImageImports(
      [
        { name: 'a.png', bytes: PNG },
        { name: 'b.txt', bytes: new Uint8Array([1, 2, 3]) },
        { name: 'big.png', bytes: PNG, size: MAX_IMAGE_BYTES + 1 },
        { name: 'c.png', bytes: PNG },
      ],
      decodeOk,
      { x: 10, y: 20 },
    );
    expect(plan.ops).toHaveLength(2);
    expect(plan.ops[0]!.input).toMatchObject({ source: 'image', width: 40, height: 20, x: 10, y: 20 });
    expect(plan.rejected.map((r) => r.name)).toEqual(['b.txt', 'big.png']);
  });
  it('rejects undecodable images', async () => {
    const plan = await planImageImports([{ name: 'x.png', bytes: PNG }], async () => undefined, { x: 0, y: 0 });
    expect(plan.ops).toHaveLength(0);
    expect(plan.rejected[0]!.message).toMatch(/could not be read/);
  });
  it('replace keeps the original on rejection and targets the element otherwise', async () => {
    const bad = await planReplaceSource({ id: 'i1' }, { name: 'x', bytes: new Uint8Array([1]) }, decodeOk);
    expect(bad.op).toBeUndefined();
    expect(bad.rejected).toBeDefined();
    const ok = await planReplaceSource({ id: 'i1' }, { name: 'x.png', bytes: PNG }, decodeOk);
    expect(ok.op!.input).toMatchObject({ source: 'image', replace: 'i1' });
    expect(ok.op!.input).not.toHaveProperty('x');
  });
  it('clamps crops and limits alt text', () => {
    expect(clampCrop({ x: -5, y: 0, w: 500, h: 10 }, { width: 100, height: 50 })).toEqual({ x: 0, y: 0, w: 100, h: 10 });
    expect(clampCrop({ x: 100, y: 0, w: 5, h: 5 }, { width: 100, height: 50 })).toBeUndefined();
    expect(altTextOp('i', 'a'.repeat(500))).toBeDefined();
    expect(altTextOp('i', 'a'.repeat(501))).toBeUndefined();
  });
});

describe('wrapped editing overlay line model', () => {
  const spec = { fontFamily: 'sans-serif', fontSize: 16, width: 60 };
  // Slicing the text at the soft breaks and trimming whitespace yields exactly the measured lines.
  const sliced = (t: string, offs: number[]): string[] =>
    [0, ...offs].map((o, i) => t.slice(o, offs[i] ?? t.length).replace(/\s+/g, ' ').trim());
  it('breaks at the same positions as measure()', () => {
    for (const t of ['hello brave new world', 'a  b   c dddddddddddddddd e', 'x'.repeat(30)]) {
      const m = measure({ text: t, fontFamily: spec.fontFamily, fontSize: 16, availableWidth: 60 });
      expect(m.ok).toBe(true);
      if (!m.ok) return;
      expect(sliced(t, softBreakOffsets(t, spec))).toEqual(m.value.lines);
    }
  });
  it('restarts per explicit newline', () => {
    expect(softBreakOffsets('ab\ncd', spec)).toEqual([]);
    const t = 'ab\nhello brave new world';
    expect(softBreakOffsets(t, spec).every((o) => o > 3)).toBe(true);
  });
  it('uses the Renderer text padding per element type', () => {
    expect([textPadding('text'), textPadding('sticky'), textPadding('flowNode')]).toEqual([0, 8, 4]);
  });
});
