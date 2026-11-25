// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WebviewStore } from '../store';
import { UiStateStore } from '../uiState';
import { ExportButtons } from './ExportButtons';

const style = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const board = () =>
  ({
    schemaVersion: 2,
    meta: { id: 'b' },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements: [{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, style }],
    assets: [],
    library: [],
  }) as never;

afterEach(cleanup);

describe('export buttons', () => {
  it('offers Copy as PNG only while something is selected', () => {
    const store = new WebviewStore();
    store.init(board(), {} as never, false);
    const ui = new UiStateStore();
    render(<ExportButtons store={store} ui={ui} />);
    expect(screen.queryByRole('button', { name: 'Copy selection as PNG' })).toBeNull();
    act(() => ui.setSelection(['r']));
    expect(screen.getByRole('button', { name: 'Copy selection as PNG' })).toBeTruthy();
  });

  it('renders the dialog outside the icon-button group, so its controls keep their own styles', () => {
    const store = new WebviewStore();
    store.init(board(), {} as never, false);
    const { container } = render(<ExportButtons store={store} ui={new UiStateStore()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    const dialog = screen.getByRole('dialog', { name: 'Export board' });
    expect(dialog.closest('.ob-export')).toBeNull();
    expect(container.querySelector('.ob-export')?.contains(dialog)).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('ob-button-secondary');
  });
});
