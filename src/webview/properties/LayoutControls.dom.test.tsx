// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Element } from '../../core/model';
import { seriousViolations } from '../axeHelper';
import { LayoutSection, SizingSection } from './LayoutControls';
import type { PanelOp } from './layout-model';
import { PropertiesPanelView } from './PropertiesPanelView';

type Op = PanelOp;

const frameEl = (id: string, over: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 50, rotation: 0, style: {}, name: id, ...over }) as unknown as Element;
const rectEl = (id: string, over: Record<string, unknown> = {}): Element =>
  ({ id, type: 'rectangle', x: 0, y: 0, width: 100, height: 50, rotation: 0, style: {}, ...over }) as unknown as Element;
const layout = (over: Record<string, unknown> = {}) => ({
  direction: 'horizontal',
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  mainAlign: 'start',
  crossAlign: 'start',
  ...over,
});

const panel = (elements: Element[], ops: Op[], extra: Record<string, unknown> = {}) => (
  <PropertiesPanelView elements={elements} onUpdate={() => {}} onOp={(o) => ops.push(o)} {...extra} />
);

afterEach(cleanup);

/** Value of the checked option in the icon radio group named `label` (undefined when none is checked). */
const checkedValue = (label: string): string | undefined =>
  screen.getByRole('radiogroup', { name: label }).querySelector('[aria-checked="true"]')?.getAttribute('data-value') ?? undefined;

describe('layout controls: enable and disable (Req 19.8, 19.9, 26.7)', () => {
  it('enable writes the full defaults, is one op, and works for an empty frame', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f')], ops));
    fireEvent.click(screen.getByText('Enable Auto Layout'));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ tool: 'openboard.element.update', input: { ids: ['f'], set: { layout: layout() } } });
  });

  it('enable is disabled when every frame has layout, and disable is disabled when none has', () => {
    const { rerender } = render(panel([frameEl('f', { layout: layout() })], []));
    expect((screen.getByText('Enable Auto Layout') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Disable Auto Layout') as HTMLButtonElement).disabled).toBe(false);
    rerender(panel([frameEl('f')], []));
    expect((screen.getByText('Enable Auto Layout') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText('Disable Auto Layout') as HTMLButtonElement).disabled).toBe(true);
  });

  it('with mixed on/off frames, enable targets only frames without layout and disable only those with', () => {
    const ops: Op[] = [];
    render(panel([frameEl('a', { layout: layout({ gap: 4 }) }), frameEl('b')], ops));
    fireEvent.click(screen.getByText('Enable Auto Layout'));
    fireEvent.click(screen.getByText('Disable Auto Layout'));
    expect(ops[0]!.input['ids']).toEqual(['b']);
    expect(ops[1]).toEqual({ tool: 'openboard.element.update', input: { ids: ['a'], set: { layout: null } } });
  });

  it('disable removes layout and sends no child updates', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { layout: layout() })], ops));
    fireEvent.click(screen.getByText('Disable Auto Layout'));
    expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['f'], set: { layout: null } } }]);
  });

  it('shows no field controls until layout is enabled, then shows the defaults', () => {
    const { rerender } = render(panel([frameEl('f')], []));
    expect(screen.queryByLabelText('Layout gap')).toBeNull();
    rerender(panel([frameEl('f', { layout: layout() })], []));
    expect((screen.getByLabelText('Layout gap') as HTMLInputElement).value).toBe('0');
    for (const l of ['Padding top', 'Padding right', 'Padding bottom', 'Padding left']) {
      expect((screen.getByLabelText(l) as HTMLInputElement).value).toBe('0');
    }
    expect(checkedValue('Layout direction')).toBe('horizontal');
    expect(checkedValue('Main-axis alignment')).toBe('start');
    expect(checkedValue('Cross-axis alignment')).toBe('start');
  });

  it('disables every action and field when read-only', () => {
    render(panel([frameEl('f', { layout: layout() })], [], { readOnly: true }));
    expect((screen.getByText('Enable Auto Layout') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Disable Auto Layout') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Layout gap') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('radiogroup', { name: 'Layout direction' })).toBeTruthy();
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('layout controls: field editing, mixed values, rejection (Req 19.8, 26.7, 26.10)', () => {
  it('changes an enum field through its icon buttons, keeping other fields', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { layout: layout({ gap: 8 }) })], ops));
    fireEvent.click(screen.getByRole('radio', { name: 'Layout direction: vertical' }));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.input['set']).toEqual({ layout: layout({ gap: 8, direction: 'vertical' }) });
  });

  it('moves an icon row with the arrow keys (roving focus), one commit per step', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { layout: layout() })], ops));
    const start = screen.getByRole('radio', { name: 'Main-axis alignment: start' });
    expect(start.tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Main-axis alignment: center' }).tabIndex).toBe(-1);
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(ops[0]!.input['set']).toEqual({ layout: layout({ mainAlign: 'center' }) });
  });

  it('commits a padding value on Enter and on blur', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { layout: layout() })], ops));
    const top = screen.getByLabelText('Padding top') as HTMLInputElement;
    fireEvent.change(top, { target: { value: '12' } });
    fireEvent.keyDown(top, { key: 'Enter' });
    const left = screen.getByLabelText('Padding left') as HTMLInputElement;
    fireEvent.change(left, { target: { value: '3' } });
    fireEvent.blur(left);
    expect((ops[0]!.input['set'] as { layout: { padding: { top: number } } }).layout.padding.top).toBe(12);
    expect((ops[1]!.input['set'] as { layout: { padding: { left: number } } }).layout.padding.left).toBe(3);
  });

  it.each([['abc'], [''], ['-1'], ['5000'], ['1e999']])('rejects gap %j with alert, aria-invalid and previous value', (bad) => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { layout: layout({ gap: 8 }) })], ops));
    const gap = screen.getByLabelText('Layout gap') as HTMLInputElement;
    fireEvent.change(gap, { target: { value: bad } });
    fireEvent.keyDown(gap, { key: 'Enter' });
    expect(gap.getAttribute('aria-invalid')).toBe('true');
    expect(gap.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    expect(gap.value).toBe('8');
    expect(ops).toEqual([]);
  });

  it('rejects an invalid padding value and keeps the previous value', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { layout: layout({ padding: { top: 4, right: 0, bottom: 0, left: 0 } }) })], ops));
    const top = screen.getByLabelText('Padding top') as HTMLInputElement;
    fireEvent.change(top, { target: { value: 'wide' } });
    fireEvent.blur(top);
    expect(screen.getByRole('alert').textContent).toContain('layout.padding.top');
    expect(top.value).toBe('4');
    expect(ops).toEqual([]);
  });

  it('clears the error after a subsequent valid commit', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { layout: layout({ gap: 8 }) })], ops));
    const gap = screen.getByLabelText('Layout gap') as HTMLInputElement;
    fireEvent.change(gap, { target: { value: 'x' } });
    fireEvent.blur(gap);
    expect(screen.queryByRole('alert')).not.toBeNull();
    fireEvent.change(gap, { target: { value: '10' } });
    fireEvent.blur(gap);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(gap.getAttribute('aria-invalid')).toBeNull();
    expect(ops).toHaveLength(1);
  });

  it('Escape reverts a pending edit', () => {
    render(panel([frameEl('f', { layout: layout({ gap: 8 }) })], []));
    const gap = screen.getByLabelText('Layout gap') as HTMLInputElement;
    fireEvent.change(gap, { target: { value: '99' } });
    fireEvent.keyDown(gap, { key: 'Escape' });
    expect(gap.value).toBe('8');
  });

  it('shows Mixed for differing layout fields and agrees for equal ones', () => {
    render(panel([frameEl('a', { layout: layout({ gap: 1, direction: 'vertical' }) }), frameEl('b', { layout: layout({ gap: 2, direction: 'vertical' }) })], []));
    expect((screen.getByLabelText('Layout gap') as HTMLInputElement).placeholder).toBe('Mixed');
    expect((screen.getByLabelText('Layout gap') as HTMLInputElement).value).toBe('');
    expect(checkedValue('Layout direction')).toBe('vertical');
    cleanup();
    const { container } = render(panel([frameEl('a', { layout: layout({ direction: 'vertical' }) }), frameEl('b', { layout: layout() })], []));
    expect(container.querySelector('[data-layout-field="direction"] [data-mixed="true"]')).not.toBeNull();
  });

  it('applies a mixed-field edit to every frame, keeping each frame\'s other fields, in one op', () => {
    const ops: Op[] = [];
    render(panel([frameEl('a', { layout: layout({ gap: 1 }) }), frameEl('b', { layout: layout({ gap: 2 }) })], ops));
    const top = screen.getByLabelText('Padding top') as HTMLInputElement;
    fireEvent.change(top, { target: { value: '5' } });
    fireEvent.blur(top);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.tool).toBe('openboard.batch');
    const inner = (ops[0]!.input['operations'] as Op[]).map((o) => [o.input['ids'], (o.input['set'] as { layout: { gap: number } }).layout.gap]);
    expect(inner).toEqual([[['a'], 1], [['b'], 2]]);
  });

  it('leaves a mixed field untouched when blurred empty', () => {
    const ops: Op[] = [];
    render(panel([frameEl('a', { layout: layout({ gap: 1 }) }), frameEl('b', { layout: layout({ gap: 2 }) })], ops));
    const gap = screen.getByLabelText('Layout gap') as HTMLInputElement;
    fireEvent.blur(gap);
    expect(ops).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('edits only frames that have a layout in a mixed on/off selection', () => {
    const ops: Op[] = [];
    render(panel([frameEl('a', { layout: layout() }), frameEl('b')], ops));
    const gap = screen.getByLabelText('Layout gap') as HTMLInputElement;
    fireEvent.change(gap, { target: { value: '6' } });
    fireEvent.blur(gap);
    expect(ops[0]!.input['ids']).toEqual(['a']);
  });

  it('has no serious axe violations with layout controls, including an error state', async () => {
    const { container } = render(panel([frameEl('f', { layout: layout() })], []));
    expect(await seriousViolations(container)).toEqual([]);
    const gap = screen.getByLabelText('Layout gap');
    fireEvent.change(gap, { target: { value: 'abc' } });
    fireEvent.blur(gap);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('has no serious axe violations for a mixed multi-frame selection', async () => {
    const { container } = render(panel([frameEl('a', { layout: layout({ gap: 1 }) }), frameEl('b', { layout: layout({ gap: 2 }) })], []));
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('sizing controls (Req 20.11, 26.10)', () => {
  const radios = (axis: 'Width' | 'Height') => within(axis);
  function within(axis: string) {
    const group = screen.getByRole('radiogroup', { name: `${axis} sizing` });
    return {
      group,
      all: Array.from(group.querySelectorAll('[role="radio"]')) as HTMLButtonElement[],
    };
  }

  it('defaults an element with no sizing to fixed on both axes', () => {
    render(panel([rectEl('a')], []));
    for (const axis of ['Width', 'Height'] as const) {
      const g = radios(axis);
      expect(g.all.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
      expect(g.all.map((r) => r.getAttribute('data-sizing-mode'))).toEqual(['fixed', 'hug', 'fill']);
    }
  });

  it('clicking a segment writes one op that keeps the other axis; clicking the current segment does nothing', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { sizing: { width: 'hug', height: 'fill' } })], ops));
    fireEvent.click(screen.getByRole('radio', { name: 'Width sizing: Hug' }));
    expect(ops).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: 'Width sizing: Fixed' }));
    expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['f'], set: { sizing: { width: 'fixed', height: 'fill' } } } }]);
  });

  it('uses roving tabindex on the checked segment', () => {
    render(panel([frameEl('f', { sizing: { width: 'hug', height: 'fixed' } })], []));
    expect(radios('Width').all.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(radios('Height').all.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('arrow keys, Home, End move focus, wrap, and commit', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { sizing: { width: 'fixed', height: 'fixed' } })], ops));
    const [fixed, hug, fill] = radios('Width').all as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
    fireEvent.keyDown(fixed, { key: 'ArrowLeft' }); // wraps to fill
    expect(document.activeElement).toBe(fill);
    fireEvent.keyDown(fill, { key: 'Home' });
    expect(document.activeElement).toBe(fixed);
    fireEvent.keyDown(fixed, { key: 'End' });
    expect(document.activeElement).toBe(fill);
    fireEvent.keyDown(hug, { key: 'ArrowDown' });
    const modes = ops.map((o) => (o.input['set'] as { sizing: { width: string } }).sizing.width);
    // props are not updated between keys, so Home (back to the unchanged `fixed`) commits nothing
    expect(modes).toEqual(['fill', 'fill', 'fill']);
  });

  it('stops arrow key propagation so the canvas nudge does not fire', () => {
    const onKey = vi.fn();
    render(panel([frameEl('f')], []));
    // React's root is the render container, so listen above it
    document.body.addEventListener('keydown', onKey);
    fireEvent.keyDown(radios('Width').all[0]!, { key: 'ArrowRight' });
    document.body.removeEventListener('keydown', onKey);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('ignores unrelated keys', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f')], ops));
    fireEvent.keyDown(radios('Width').all[0]!, { key: 'a' });
    expect(ops).toEqual([]);
  });

  it('shows Mixed when selected elements differ on an axis, with no checked segment and a tabbable first segment', () => {
    render(panel([frameEl('a', { sizing: { width: 'hug', height: 'fixed' } }), frameEl('b', { sizing: { width: 'fill', height: 'fixed' } })], []));
    const w = radios('Width');
    expect(w.group.getAttribute('data-mixed')).toBe('true');
    expect(w.all.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(w.all[0]!.tabIndex).toBe(0);
    expect(screen.getAllByText('Mixed').length).toBeGreaterThan(0);
    expect(radios('Height').group.getAttribute('data-mixed')).toBeNull();
  });

  it('a mixed-axis change gives each element its own other axis, in one op', () => {
    const ops: Op[] = [];
    render(panel([frameEl('a', { sizing: { width: 'hug', height: 'fill' } }), frameEl('b', { sizing: { width: 'fill', height: 'fixed' } })], ops));
    fireEvent.click(screen.getByRole('radio', { name: 'Width sizing: Fixed' }));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.tool).toBe('openboard.batch');
    const sets = (ops[0]!.input['operations'] as Op[]).map((o) => [o.input['ids'], o.input['set']]);
    expect(sets).toEqual([
      [['a'], { sizing: { width: 'fixed', height: 'fill' } }],
      [['b'], { sizing: { width: 'fixed', height: 'fixed' } }],
    ]);
  });

  it('rejects a change with no elements: error indication, aria-invalid, no op, cleared on new selection', () => {
    const ops: Op[] = [];
    const { rerender } = render(<SizingSection elements={[]} readOnly={false} onOp={(o) => ops.push(o)} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Width sizing: Hug' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: 'Width sizing' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toBe(alert.id);
    expect(ops).toEqual([]);
    rerender(<SizingSection elements={[frameEl('f')]} readOnly={false} onOp={(o) => ops.push(o)} />);
    expect(screen.queryByRole('alert')).toBeNull();
    // previous value retained: still reflects the element's data, not the rejected choice
    expect(screen.getByRole('radio', { name: 'Width sizing: Fixed' }).getAttribute('aria-checked')).toBe('true');
  });

  it('typing an invalid width on a hug axis is rejected and sizing stays unchanged', () => {
    const ops: Op[] = [];
    render(panel([frameEl('f', { sizing: { width: 'hug', height: 'hug' } })], ops));
    const w = screen.getByLabelText('Width') as HTMLInputElement;
    fireEvent.change(w, { target: { value: 'abc' } });
    fireEvent.blur(w);
    expect(w.getAttribute('aria-invalid')).toBe('true');
    expect(w.value).toBe('100');
    expect(ops).toEqual([]);
    expect(screen.getByRole('radio', { name: 'Width sizing: Hug' }).getAttribute('aria-checked')).toBe('true');
  });

  it('is not offered for an edge selection', () => {
    const edge = { id: 'e', type: 'edge', style: {} } as unknown as Element;
    render(panel([edge], []));
    expect(screen.queryByRole('radiogroup', { name: 'Width sizing' })).toBeNull();
  });

  it('has no serious axe violations, including mixed and error states', async () => {
    const { container, rerender } = render(panel([frameEl('f', { sizing: { width: 'hug', height: 'fill' } })], []));
    expect(await seriousViolations(container)).toEqual([]);
    rerender(panel([frameEl('a', { sizing: { width: 'hug' } }), frameEl('b')], []));
    expect(await seriousViolations(container)).toEqual([]);
    cleanup();
    const r = render(<SizingSection elements={[]} readOnly={false} onOp={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Width sizing: Hug' }));
    expect(await seriousViolations(r.container)).toEqual([]);
  });
});

describe('LayoutSection standalone', () => {
  it('does not post an op when enabling with no frames lacking layout', () => {
    const onOp = vi.fn();
    render(<LayoutSection frames={[frameEl('f', { layout: layout() }) as never]} readOnly={false} onOp={onOp} />);
    fireEvent.click(screen.getByText('Enable Auto Layout'));
    expect(onOp).not.toHaveBeenCalled();
  });
});

describe('number token pickers for gap and padding (Req 11.15)', () => {
  it('shows a picker only when number tokens exist, and picking writes a reference as one op', async () => {
    const ops: Op[] = [];
    const { rerender, container } = render(panel([frameEl('f', { layout: layout() })], ops));
    expect(screen.queryByLabelText('Layout gap token')).toBeNull();
    rerender(panel([frameEl('f', { layout: layout() })], ops, { tokens: { numbers: { space: 8 } } }));
    const pick = screen.getByLabelText('Layout gap token');
    fireEvent.keyDown(pick, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'space' }));
    expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['f'], set: { layout: layout({ gap: 'token:space' }) } } }]);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
