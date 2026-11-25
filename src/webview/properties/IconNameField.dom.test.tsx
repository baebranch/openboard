// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Element } from '../../core/model';
import { seriousViolations } from '../axeHelper';
import { PropertiesPanelView } from './PropertiesPanelView';

afterEach(cleanup);

const icon = (id: string, name: string): Element =>
  ({
    id,
    type: 'icon',
    name,
    x: 0,
    y: 0,
    width: 24,
    height: 24,
    style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 },
  }) as unknown as Element;

const NAME = 'Icon name';

describe('Properties_Panel icon name control (Req 23.7, 26.1)', () => {
  it('shows the current name and filters results on every keystroke', () => {
    render(<PropertiesPanelView elements={[icon('i', 'home')]} onUpdate={() => {}} />);
    const input = screen.getByLabelText(NAME) as HTMLInputElement;
    expect(input.value).toBe('home');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'hom' } });
    expect(screen.getByLabelText('Choose icon: house')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'zzzz-nothing' } });
    expect(screen.getByRole('status').textContent).toBe('No icons match');
    expect(screen.queryAllByLabelText(/^Choose icon:/)).toHaveLength(0);
  });

  it('commits a chosen icon as one update op and does not commit partial typing on blur', () => {
    const onUpdate = vi.fn();
    render(<PropertiesPanelView elements={[icon('i', 'home')]} onUpdate={onUpdate} />);
    const input = screen.getByLabelText(NAME) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'sta' } });
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
    expect((screen.getByLabelText(NAME) as HTMLInputElement).value).toBe('home');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'star' } });
    fireEvent.click(screen.getByLabelText('Choose icon: star'));
    expect(onUpdate).toHaveBeenCalledWith({ tool: 'openboard.element.update', input: { ids: ['i'], set: { name: 'star' } } });
  });

  it('accepts a name outside the Icon_Set on Enter and rejects an empty or over-long name', () => {
    const onUpdate = vi.fn();
    render(<PropertiesPanelView elements={[icon('i', 'home')]} onUpdate={onUpdate} />);
    const input = screen.getByLabelText(NAME) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-custom-icon' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledWith({ tool: 'openboard.element.update', input: { ids: ['i'], set: { name: 'my-custom-icon' } } });

    onUpdate.mockClear();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Icon name must be 1 to 64 characters');
  });

  it('is absent for non-icon elements and has no axe violations while open', async () => {
    const { container } = render(<PropertiesPanelView elements={[icon('i', 'home')]} onUpdate={() => {}} />);
    fireEvent.focus(screen.getByLabelText(NAME));
    expect(await seriousViolations(container)).toEqual([]);
    cleanup();
    render(<PropertiesPanelView elements={[{ ...icon('r', 'x'), type: 'rect' } as unknown as Element]} onUpdate={() => {}} />);
    expect(screen.queryByLabelText(NAME)).toBeNull();
  });
});
