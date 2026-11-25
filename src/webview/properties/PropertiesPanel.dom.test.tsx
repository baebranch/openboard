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

  it('has no serious axe violations', async () => {
    const { container } = render(<PropertiesPanelView elements={[rect('a'), rect('b', { x: 3 })]} onUpdate={() => {}} />);
    expect(await seriousViolations(container)).toEqual([]);
    const width = screen.getByLabelText('Width');
    fireEvent.change(width, { target: { value: 'abc' } });
    fireEvent.blur(width);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
