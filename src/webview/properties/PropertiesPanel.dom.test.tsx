// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Element } from '../../core/model';
import { seriousViolations } from '../axeHelper';
import type { UpdateOp } from './model';
import { PropertiesPanelView } from './PropertiesPanelView';

function rect(id: string, over: Record<string, unknown> = {}): Element {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 },
    ...over,
  } as unknown as Element;
}

afterEach(cleanup);

describe('PropertiesPanelView (Req 6.7)', () => {
  it('shows aria-invalid + alert for invalid input and keeps the previous value', () => {
    const onUpdate = vi.fn();
    render(<PropertiesPanelView elements={[rect('a')]} onUpdate={onUpdate} />);
    const width = screen.getByLabelText('Width') as HTMLInputElement;
    for (const bad of ['abc', '0.5']) {
      fireEvent.change(width, { target: { value: bad } });
      fireEvent.blur(width);
      expect(width.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByRole('alert').textContent).toBeTruthy();
      expect(width.value).toBe('100');
    }
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('shows Mixed for differing values', () => {
    render(<PropertiesPanelView elements={[rect('a', { x: 1 }), rect('b', { x: 2 })]} onUpdate={() => {}} />);
    expect((screen.getByLabelText('X') as HTMLInputElement).placeholder).toBe('Mixed');
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('100');
  });

  it('dispatches one update op for all selected ids on a valid entry', () => {
    const ops: UpdateOp[] = [];
    render(<PropertiesPanelView elements={[rect('a', { x: 1 }), rect('b', { x: 2 })]} onUpdate={(o) => ops.push(o)} />);
    const x = screen.getByLabelText('X') as HTMLInputElement;
    fireEvent.change(x, { target: { value: '7' } });
    fireEvent.blur(x);
    expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['a', 'b'], set: { x: 7 } } }]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('places X and Y inputs in the same row', () => {
    render(<PropertiesPanelView elements={[rect('a')]} onUpdate={() => {}} />);
    const row = screen.getByLabelText('X').closest('.ob-prop-row');
    expect(row).not.toBeNull();
    expect(row!.contains(screen.getByLabelText('Y'))).toBe(true);
    expect(row!.getAttribute('data-cols')).toBe('2');
  });

  it('marks a missing token, stays usable, and detaches to the default (Req 11.9, 11.17)', () => {
    const ops: UpdateOp[] = [];
    const el = rect('a', { style: { fill: 'token:gone', stroke: '#000000', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } });
    render(<PropertiesPanelView elements={[el]} tokens={{ colors: { brand: '#112233' } }} onUpdate={(o) => ops.push(o)} />);
    expect(screen.getByText('Missing token: gone')).toBeTruthy();
    const fill = document.querySelector('[data-token-field="fill"]')!;
    fireEvent.click(fill.querySelector('button:not([role="combobox"])')!);
    expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['a'], set: { fill: 'theme:default' } } }]);
  });

  describe('layout and sizing controls (Req 19.8, 19.9, 20.11, 26.7, 26.10)', () => {
    type Op = { tool: string; input: Record<string, unknown> };
    const frameEl = (id: string, over: Record<string, unknown> = {}): Element =>
      ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 50, rotation: 0, style: {}, name: id, ...over }) as unknown as Element;
    const layout = (over: Record<string, unknown> = {}) => ({
      direction: 'horizontal',
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      mainAlign: 'start',
      crossAlign: 'start',
      ...over,
    });

    it('enables with defaults, even for an empty frame, and disables', () => {
      const ops: Op[] = [];
      const { rerender } = render(<PropertiesPanelView elements={[frameEl('f')]} onUpdate={() => {}} onOp={(o) => ops.push(o)} />);
      expect((screen.getByText('Disable Auto Layout') as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByLabelText('Layout gap')).toBeNull();
      fireEvent.click(screen.getByText('Enable Auto Layout'));
      expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['f'], set: { layout: layout() } } }]);
      rerender(<PropertiesPanelView elements={[frameEl('f', { layout: layout() })]} onUpdate={() => {}} onOp={(o) => ops.push(o)} />);
      expect((screen.getByLabelText('Layout gap') as HTMLInputElement).value).toBe('0');
      fireEvent.click(screen.getByText('Disable Auto Layout'));
      expect(ops[1]).toEqual({ tool: 'openboard.element.update', input: { ids: ['f'], set: { layout: null } } });
    });

    it('commits a gap, and rejects an out-of-range one with an alert and the previous value', () => {
      const ops: Op[] = [];
      render(<PropertiesPanelView elements={[frameEl('f', { layout: layout({ gap: 8 }) })]} onUpdate={() => {}} onOp={(o) => ops.push(o)} />);
      const gap = screen.getByLabelText('Layout gap') as HTMLInputElement;
      fireEvent.change(gap, { target: { value: '5000' } });
      fireEvent.blur(gap);
      expect(gap.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByRole('alert').textContent).toContain('layout.gap');
      expect(gap.value).toBe('8');
      expect(ops).toEqual([]);
      fireEvent.change(gap, { target: { value: '16' } });
      fireEvent.keyDown(gap, { key: 'Enter' });
      expect(ops).toHaveLength(1);
      expect((ops[0]!.input['set'] as { layout: { gap: number } }).layout.gap).toBe(16);
    });

    it('shows mixed values across frames', () => {
      render(<PropertiesPanelView elements={[frameEl('a', { layout: layout({ gap: 1 }) }), frameEl('b', { layout: layout({ gap: 2 }) })]} onUpdate={() => {}} onOp={() => {}} />);
      expect((screen.getByLabelText('Layout gap') as HTMLInputElement).placeholder).toBe('Mixed');
    });

    it('typing a width on a hug axis switches it to fixed in the same op (Req 20.10)', () => {
      cleanup();
      const ops: Op[] = [];
      render(<PropertiesPanelView elements={[frameEl('f', { sizing: { width: 'hug', height: 'hug' } })]} onUpdate={() => {}} onOp={(o) => ops.push(o)} />);
      const input = screen.getByLabelText('Width') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '321' } });
      fireEvent.blur(input);
      expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['f'], set: { width: 321, sizing: { width: 'fixed', height: 'hug' } } } }]);
    });

    it('changes a sizing segment with click and keyboard, exposing radio semantics', () => {
      const ops: Op[] = [];
      render(<PropertiesPanelView elements={[frameEl('f', { sizing: { width: 'hug', height: 'fixed' } })]} onUpdate={() => {}} onOp={(o) => ops.push(o)} />);
      const group = screen.getByRole('radiogroup', { name: 'Width sizing' });
      expect(group.querySelector('[aria-checked="true"]')!.getAttribute('data-sizing-mode')).toBe('hug');
      fireEvent.click(screen.getByRole('radio', { name: 'Height sizing: Fill' }));
      expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['f'], set: { sizing: { width: 'hug', height: 'fill' } } } }]);
      fireEvent.keyDown(screen.getByRole('radio', { name: 'Width sizing: Hug' }), { key: 'ArrowRight' });
      expect(ops[1]).toEqual({ tool: 'openboard.element.update', input: { ids: ['f'], set: { sizing: { width: 'fill', height: 'fixed' } } } });
    });

    it('offers ignoreLayout only for children of a Layout_Frame, toggles it, and has no axe violations (Req 19.14)', async () => {
      const ops: Op[] = [];
      const parent = frameEl('p', { layout: layout() });
      const child = rect('c', { parentId: 'p' });
      const plain = frameEl('q');
      const orphan = rect('o', { parentId: 'q' });
      const { container, rerender } = render(
        <PropertiesPanelView elements={[orphan]} allElements={[plain, orphan]} onUpdate={() => {}} onOp={(o) => ops.push(o)} />,
      );
      expect(screen.queryByLabelText('Ignore Auto Layout')).toBeNull();
      rerender(<PropertiesPanelView elements={[child]} allElements={[parent, child]} onUpdate={() => {}} onOp={(o) => ops.push(o)} />);
      const box = screen.getByLabelText('Ignore Auto Layout') as HTMLInputElement;
      expect(box.checked).toBe(false);
      fireEvent.click(box);
      expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['c'], set: { ignoreLayout: true } } }]);
      const on = rect('c', { parentId: 'p', ignoreLayout: true });
      rerender(<PropertiesPanelView elements={[on]} allElements={[parent, on]} onUpdate={() => {}} onOp={(o) => ops.push(o)} />);
      fireEvent.click(screen.getByLabelText('Ignore Auto Layout'));
      expect(ops[1]).toEqual({ tool: 'openboard.element.update', input: { ids: ['c'], set: { ignoreLayout: null } } });
      expect(await seriousViolations(container)).toEqual([]);
    });

    it('hides layout for non-frames, has no axe violations', async () => {
      const { container } = render(<PropertiesPanelView elements={[rect('a')]} onUpdate={() => {}} onOp={() => {}} />);
      expect(screen.queryByText('Enable Auto Layout')).toBeNull();
      expect(screen.getByRole('radiogroup', { name: 'Height sizing' })).toBeTruthy();
      expect(await seriousViolations(container)).toEqual([]);
    });
  });

  describe('component controls (Req 13.5, 14.9, 14.11, 14.19)', () => {
    const frameEl = (id: string, over: Record<string, unknown> = {}): Element =>
      ({ id, type: 'frame', x: 0, y: 0, width: 100, height: 50, rotation: 0, style: {}, ...over }) as unknown as Element;

    it('renames a master and rejects a duplicate name', () => {
      const ops: { tool: string; input: unknown }[] = [];
      const m = frameEl('m', { component: 'Button' });
      const all = [m, frameEl('m2', { component: 'Card' })];
      render(<PropertiesPanelView elements={[m]} allElements={all} onUpdate={() => {}} onComponentOp={(o) => ops.push(o)} />);
      const name = screen.getByLabelText('Component name') as HTMLInputElement;
      fireEvent.change(name, { target: { value: 'Card' } });
      fireEvent.blur(name);
      expect(ops).toEqual([]);
      expect(screen.getAllByRole('alert')[0]!.textContent).toContain('already in use');
      fireEvent.change(name, { target: { value: 'Primary' } });
      fireEvent.blur(name);
      expect(ops).toEqual([{ tool: 'openboard.element.update', input: { ids: ['m'], set: { component: 'Primary' } } }]);
    });

    it('detaches, resets overrides and goes to the master of an instance', () => {
      const ops: { tool: string; input: unknown }[] = [];
      const goto: string[] = [];
      const m = frameEl('m', { component: 'Button' });
      const i = frameEl('i', { instanceOf: 'm', overrides: { '': { width: 200 } } });
      render(
        <PropertiesPanelView elements={[i]} allElements={[m, i]} onUpdate={() => {}} onComponentOp={(o) => ops.push(o)} onGoToMaster={(id) => goto.push(id)} />,
      );
      fireEvent.click(screen.getByText('Detach Instance'));
      fireEvent.click(screen.getByText('Reset Overrides'));
      fireEvent.click(screen.getByText('Go to master'));
      expect(ops.map((o) => o.tool)).toEqual(['openboard.component.instance.detach', 'openboard.component.instance.override.reset']);
      expect(goto).toEqual(['m']);
      expect(document.querySelector('[data-override="width"]')).not.toBeNull();
    });

    it('shows an Override indicator on an overridden Instance_Child property', () => {
      const i = frameEl('i', { instanceOf: 'm', overrides: { c1: { fill: '#ff0000' } } });
      const c = rect('i::c1');
      render(<PropertiesPanelView elements={[c]} allElements={[frameEl('m', { component: 'B' }), i, c]} onUpdate={() => {}} onComponentOp={() => {}} />);
      expect(document.querySelector('[data-override="fill"]')).not.toBeNull();
      expect(document.querySelector('[data-override="stroke"]')).toBeNull();
    });

    it('shows "master missing" and disables Go to master', () => {
      const i = frameEl('i', { instanceOf: 'gone' });
      render(<PropertiesPanelView elements={[i]} allElements={[i]} onUpdate={() => {}} onComponentOp={() => {}} onGoToMaster={() => {}} />);
      expect(screen.getByText('Master missing: this instance has no component master')).toBeTruthy();
      expect((screen.getByText('Go to master') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('has no serious axe violations', async () => {
    const { container } = render(<PropertiesPanelView elements={[rect('a'), rect('b', { x: 3 })]} onUpdate={() => {}} />);
    expect(await seriousViolations(container)).toEqual([]);
    const width = screen.getByLabelText('Width');
    fireEvent.change(width, { target: { value: 'abc' } });
    fireEvent.blur(width);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
