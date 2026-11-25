// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Element } from '../../core/model';
import { seriousViolations } from '../axeHelper';
import { receiveFonts, resetFonts, searchFonts, setFontRequestSender } from '../fonts';
import { PropertiesPanelView } from './PropertiesPanelView';

const style = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const text = (over: Record<string, unknown> = {}): Element =>
  ({
    id: 't',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    style,
    runs: [{ text: 'Hi' }],
    fontFamily: 'sans-serif',
    fontSize: 14,
    align: 'left',
    ...over,
  }) as unknown as Element;

const checked = (label: string): string | null | undefined =>
  screen.getByRole('radiogroup', { name: label }).querySelector('[aria-checked="true"]')?.getAttribute('data-value');

let requests = 0;
beforeEach(() => {
  requests = 0;
  resetFonts();
  setFontRequestSender(() => void requests++);
});
afterEach(() => {
  cleanup();
  setFontRequestSender(undefined);
});

describe('enum defaults and icon rows', () => {
  it('shows "none" for text wrap and 400 for font weight when the element stores neither', () => {
    render(<PropertiesPanelView elements={[text()]} onUpdate={() => {}} />);
    expect(checked('Text wrap')).toBe('none');
    expect(screen.getByLabelText('Font weight').textContent).toContain('400');
  });

  it('commits text alignment and wrap from icon buttons', () => {
    const onUpdate = vi.fn();
    render(<PropertiesPanelView elements={[text()]} onUpdate={onUpdate} />);
    expect(checked('Text alignment')).toBe('left');
    fireEvent.click(screen.getByRole('radio', { name: 'Text alignment: center' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Text wrap: wrap' }));
    expect(onUpdate.mock.calls.map((c) => c[0].input.set)).toEqual([{ align: 'center' }, { textWrap: 'wrap' }]);
  });

  it('choosing the shown default of an unset field is a no-op', () => {
    const onUpdate = vi.fn();
    render(<PropertiesPanelView elements={[text()]} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Text wrap: none' }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('marks a mixed icon row and checks no option', () => {
    render(<PropertiesPanelView elements={[text(), text({ id: 'u', align: 'right' })]} onUpdate={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: 'Text alignment' });
    expect(group.getAttribute('data-mixed')).toBe('true');
    expect(checked('Text alignment')).toBeUndefined();
  });
});

describe('font family picker', () => {
  it('requests installed fonts once, lists and filters them, and commits with the keyboard', () => {
    const onUpdate = vi.fn();
    render(<PropertiesPanelView elements={[text()]} onUpdate={onUpdate} />);
    const input = screen.getByLabelText('Font family') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
    fireEvent.focus(input);
    expect(requests).toBe(1);
    expect(screen.getByRole('status').textContent).toBe('Loading installed fonts…');
    act(() => receiveFonts(['Arial', 'Fira Code', 'Inter']));
    expect(screen.getByRole('option', { name: 'Inter' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'fi' } });
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Fira Code']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Fira Code' }).id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledWith({ tool: 'openboard.element.update', input: { ids: ['t'], set: { fontFamily: 'Fira Code' } } });
    fireEvent.blur(input);
    fireEvent.focus(input);
    expect(requests).toBe(1);
  });

  it('accepts a typed family that is not installed, and Escape reverts', () => {
    const onUpdate = vi.fn();
    render(<PropertiesPanelView elements={[text()]} onUpdate={onUpdate} />);
    const input = screen.getByLabelText('Font family') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'My Brand Sans' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('sans-serif');
    fireEvent.change(input, { target: { value: 'My Brand Sans' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledWith({ tool: 'openboard.element.update', input: { ids: ['t'], set: { fontFamily: 'My Brand Sans' } } });
  });

  it('ranks prefix matches first and keeps generic families', () => {
    expect(searchFonts(['Arial', 'Comic Sans', 'Sans Pro'], 'sans').slice(0, 2)).toEqual(['sans-serif', 'Sans Pro']);
    expect(searchFonts(undefined, '')).toContain('monospace');
  });

  it('has no serious axe violations while open', async () => {
    const { container } = render(<PropertiesPanelView elements={[text()]} onUpdate={() => {}} />);
    fireEvent.focus(screen.getByLabelText('Font family'));
    act(() => receiveFonts(['Arial']));
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('sections and swatches', () => {
  it('groups fields under collapsible section headers', () => {
    render(<PropertiesPanelView elements={[text()]} onUpdate={() => {}} />);
    const toggle = screen.getByRole('button', { name: 'Text' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.hidden).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a color swatch that commits the picked color', () => {
    const onUpdate = vi.fn();
    render(<PropertiesPanelView elements={[text()]} onUpdate={onUpdate} />);
    const picker = screen.getByLabelText('Fill color picker') as HTMLInputElement;
    expect(picker.value).toBe('#ffffff');
    fireEvent.input(picker, { target: { value: '#112233' } });
    fireEvent(picker, new Event('change'));
    expect(onUpdate).toHaveBeenCalledWith({ tool: 'openboard.element.update', input: { ids: ['t'], set: { fill: '#112233' } } });
  });

  it('has no serious axe violations', async () => {
    const { container } = render(<PropertiesPanelView elements={[text()]} onUpdate={() => {}} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
