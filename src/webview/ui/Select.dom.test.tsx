// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../axeHelper';
import { PropertiesPanelView } from '../properties/PropertiesPanelView';
import { Select, type SelectProps } from './Select';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function Harness(props: Partial<SelectProps> & { onPick?(v: string): void }) {
  const [v, setV] = useState(props.value ?? 'a');
  return (
    <div>
      <label htmlFor="sel">Letter</label>
      <Select
        id="sel"
        options={OPTIONS}
        {...props}
        value={v}
        onChange={(n) => {
          setV(n);
          props.onPick?.(n);
        }}
      />
      <button type="button">after</button>
    </div>
  );
}

afterEach(cleanup);

const trigger = (): HTMLElement => screen.getByLabelText('Letter');

describe('Select', () => {
  it('exposes combobox/listbox/option semantics', () => {
    render(<Harness />);
    const t = trigger();
    expect(t.getAttribute('role')).toBe('combobox');
    expect(t.getAttribute('aria-haspopup')).toBe('listbox');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.textContent).toContain('Alpha');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(t);
    expect(t.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox');
    expect(t.getAttribute('aria-controls')).toBe(list.id);
    const opts = screen.getAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(opts.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(t.getAttribute('aria-activedescendant')).toBe(opts[0]!.id);
  });

  it('opens with Enter, Space and ArrowDown', () => {
    for (const key of ['Enter', ' ', 'ArrowDown']) {
      render(<Harness />);
      fireEvent.keyDown(trigger(), { key });
      expect(screen.getByRole('listbox')).toBeTruthy();
      cleanup();
    }
  });

  it('navigates with arrows/Home/End and selects with Enter, returning focus', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const t = trigger();
    t.focus();
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    expect(t.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]!.id);
    fireEvent.keyDown(t, { key: 'End' });
    expect(t.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2]!.id);
    fireEvent.keyDown(t, { key: 'ArrowDown' }); // clamped
    expect(t.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2]!.id);
    fireEvent.keyDown(t, { key: 'Home' });
    fireEvent.keyDown(t, { key: 'ArrowUp' }); // clamped
    expect(t.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]!.id);
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    fireEvent.keyDown(t, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(t.textContent).toContain('Beta');
    expect(document.activeElement).toBe(t);
  });

  it('Space selects, Escape closes without changing and returns focus', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const t = trigger();
    t.focus();
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    fireEvent.keyDown(t, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(t);
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    fireEvent.keyDown(t, { key: ' ' });
    expect(onPick).toHaveBeenCalledWith('b');
  });

  it('Tab closes the popup; type-ahead moves the highlight', () => {
    render(<Harness />);
    const t = trigger();
    fireEvent.keyDown(t, { key: 'ArrowDown' });
    fireEvent.keyDown(t, { key: 'g' });
    expect(t.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2]!.id);
    fireEvent.keyDown(t, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects with the mouse and closes on outside click', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(onPick).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger());
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not open when disabled', () => {
    render(<Harness disabled />);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the Mixed placeholder with nothing selected, and picks the same value', () => {
    const onPick = vi.fn();
    render(<Harness mixed onPick={onPick} />);
    const t = trigger();
    expect(t.textContent).toContain('Mixed');
    fireEvent.click(t);
    expect(screen.getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(onPick).toHaveBeenCalledWith('a');
  });

  it('has no serious axe violations closed or open', async () => {
    const { container } = render(<Harness />);
    expect(await seriousViolations(container)).toEqual([]);
    fireEvent.click(trigger());
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('Select inside the properties panel', () => {
  it('commits an enum change through the custom dropdown', () => {
    const onUpdate = vi.fn();
    const el = {
      id: 'a',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 },
    };
    render(<PropertiesPanelView elements={[el as never]} onUpdate={onUpdate} />);
    const style = screen.queryAllByRole('combobox')[0];
    expect(style).toBeTruthy();
    fireEvent.click(style!);
    const opt = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'false')!;
    fireEvent.click(opt);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
