// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seriousViolations } from '../axeHelper';
import { setOpSender } from '../ops';
import { WebviewStore } from '../store';
import { UiStateStore } from '../uiState';
import { ToolPalette } from './ToolPalette';
import { PALETTE_TOOLS } from './tools';


let ui: UiStateStore;
let store: WebviewStore;
const sent: { tool: string }[] = [];

beforeEach(() => {
  ui = new UiStateStore();
  store = new WebviewStore();
  sent.length = 0;
  setOpSender((m) => {
    if (m.type === 'op') sent.push({ tool: m.tool });
  });
});
afterEach(() => {
  cleanup();
  setOpSender(undefined);
});

const buttons = (): HTMLButtonElement[] => screen.getAllByRole('button') as HTMLButtonElement[];

describe('ToolPalette accessibility (Req 5.14)', () => {
  it('renders 14 tool buttons with unique non-empty accessible names and one pressed', () => {
    render(<ToolPalette store={store} ui={ui} />);
    const b = buttons();
    expect(b).toHaveLength(14);
    const names = b.map((x) => x.getAttribute('aria-label') ?? '');
    expect(names.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(14);
    expect(b.filter((x) => x.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(b.filter((x) => x.tabIndex === 0)).toHaveLength(1);
  });

  it('moves focus with ArrowLeft/Right/Home/End', () => {
    render(<ToolPalette store={store} ui={ui} />);
    const b = buttons();
    b[0]!.focus();
    fireEvent.keyDown(b[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(b[1]);
    fireEvent.keyDown(b[1]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(b[0]);
    fireEvent.keyDown(b[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(b[13]);
    fireEvent.keyDown(b[13]!, { key: 'Home' });
    expect(document.activeElement).toBe(b[0]);
    fireEvent.keyDown(b[0]!, { key: 'End' });
    expect(document.activeElement).toBe(b[13]);
  });

  it('activates a tool on click (native button handles Enter/Space) and updates roving tabindex', () => {
    render(<ToolPalette store={store} ui={ui} />);
    const rect = screen.getByRole('button', { name: 'Rectangle' });
    expect(rect.tagName).toBe('BUTTON');
    fireEvent.click(rect);
    expect(ui.getState().activeTool).toBe('rectangle');
    expect(rect.getAttribute('aria-pressed')).toBe('true');
    expect(rect.tabIndex).toBe(0);
    expect(screen.getByRole('button', { name: 'Select' }).tabIndex).toBe(-1);
  });

  it('shortcut keys activate tools, are ignored inside inputs, and Escape returns to Select', () => {
    render(
      <>
        <ToolPalette store={store} ui={ui} />
        <input aria-label="field" />
      </>,
    );
    for (const t of PALETTE_TOOLS) {
      fireEvent.keyDown(document.body, { key: t.shortcut.toLowerCase() });
      expect(ui.getState().activeTool).toBe(t.id);
    }
    fireEvent.keyDown(document.body, { key: 'r' });
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'e' });
    expect(ui.getState().activeTool).toBe('rectangle');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(ui.getState().activeTool).toBe('select');
  });

  it('Delete pressed twice dispatches exactly one delete op and clears the selection', () => {
    render(<ToolPalette store={store} ui={ui} />);
    act(() => ui.setSelection(['el-1']));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(ui.getState().selection).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(sent.filter((s) => s.tool === 'openboard.element.delete')).toHaveLength(1);
  });

  it('opens the icon picker with the Icon tool, filters, chooses, and is accessible (Req 23.3, 23.8)', async () => {
    const { container } = render(<ToolPalette store={store} ui={ui} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Icon' }));
    expect(ui.getState().activeTool).toBe('icon');
    expect(screen.getByRole('dialog', { name: 'Icon picker' })).toBeTruthy();
    expect(buttons().filter((x) => x.getAttribute('aria-pressed') === 'true' && x.closest('.ob-palette'))).toHaveLength(1);
    expect(await seriousViolations(container)).toEqual([]);
    fireEvent.change(screen.getByLabelText('Search icons'), { target: { value: 'zzzz-no-such-icon' } });
    expect(screen.getByText('No icons match')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search icons'), { target: { value: 'ARROW' } });
    const first = screen.getAllByRole('button', { name: /^Choose icon: / })[0]!;
    fireEvent.keyDown(first, { key: 'ArrowRight' }); // grid keys must not nudge/shortcut
    fireEvent.click(first);
    expect(ui.getState().iconName).toBe(first.getAttribute('title'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ui.getState().activeTool).toBe('icon');
  });

  it('K opens the picker and Escape in the picker closes it without leaving the tool', () => {
    render(<ToolPalette store={store} ui={ui} />);
    fireEvent.keyDown(document.body, { key: 'k' });
    const search = screen.getByLabelText('Search icons');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ui.getState().activeTool).toBe('icon');
    fireEvent.keyDown(document.body, { key: 'v' });
    expect(ui.getState().activeTool).toBe('select');
  });

  it('has no serious axe violations (palette and context menu)', async () => {
    const { container } = render(<ToolPalette store={store} ui={ui} />);
    expect(await seriousViolations(container)).toEqual([]);
    fireEvent.contextMenu(document.body);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(await seriousViolations(container)).toEqual([]);
  });
});
