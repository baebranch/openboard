// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Element } from '../../core/model/types';
import { seriousViolations } from '../axeHelper';
import { onFocusBounds } from '../canvas/viewportBus';
import { setOpSender } from '../ops';
import { getPresentation, startPresentation, stopPresentation } from '../presentation';
import { WebviewStore } from '../store';
import { UiStateStore } from '../uiState';
import { ToolPalette } from '../palette/ToolPalette';
import { BoardPanelButtons, BoardPanelsToolbar } from './BoardPanels';
import { PanelStateStore } from './panelState';
import { layerLabel, layerTree } from './layers-model';
import { Presentation } from './Presentation';

const style = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 };
const frame = (id: string, name: string, x: number, extra: Record<string, unknown> = {}): Element =>
  ({ id, type: 'frame', name, x, y: 0, width: 100, height: 80, rotation: 0, style, ...extra }) as unknown as Element;
const text = (id: string, words: string, parentId?: string): Element =>
  ({
    id,
    type: 'text',
    x: 10,
    y: 10,
    width: 60,
    height: 20,
    rotation: 0,
    style,
    runs: [{ text: words }],
    fontFamily: 'sans-serif',
    fontSize: 14,
    align: 'left',
    ...(parentId ? { parentId } : {}),
  }) as unknown as Element;

const board = (elements: Element[]) =>
  ({ schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [] }) as never;

const ops: { tool: string; input: unknown }[] = [];
beforeEach(() => {
  ops.length = 0;
  setOpSender((m) => {
    if (m.type === 'op') ops.push({ tool: m.tool, input: m.input });
  });
});
afterEach(() => {
  cleanup();
  setOpSender(undefined);
  stopPresentation();
});

function setup(elements: Element[]) {
  const store = new WebviewStore();
  store.init(board(elements), {} as never, false);
  const ui = new UiStateStore();
  const panels = new PanelStateStore();
  const view = render(
    <>
      <BoardPanelsToolbar store={store} ui={ui} panels={panels} />
      <Presentation store={store} />
    </>,
  );
  return { store, ui, panels, ...view };
}

const ELEMENTS = [frame('s2', 'Second', 300), frame('s1', 'First', 0), text('t', 'Hello world', 's1'), frame('m', 'Btn', 600, { component: 'Button' })];

describe('tool palette footer', () => {
  it('puts the sidebar buttons at the bottom of the tool palette, below a divider and outside the tools toolbar', () => {
    const store = new WebviewStore();
    store.init(board(ELEMENTS), {} as never, false);
    const { container } = render(<ToolPalette store={store} ui={new UiStateStore()} footer={<BoardPanelButtons panels={new PanelStateStore()} />} />);
    const palette = container.querySelector('.ob-palette')!;
    const children = Array.from(palette.children);
    expect(children.map((c) => c.getAttribute('role'))).toEqual(['toolbar', 'separator', 'group']);
    const tools = screen.getByRole('toolbar', { name: 'Tools' });
    expect(tools.contains(screen.getByRole('button', { name: 'Layers' }))).toBe(false);
    expect(palette.contains(screen.getByRole('button', { name: 'Show sidebar' }))).toBe(true);
  });
});

describe('board panels toolbar', () => {
  it('opens one panel at a time and toggles it from its button', () => {
    setup(ELEMENTS);
    const layers = screen.getByRole('button', { name: 'Layers' });
    const slides = screen.getByRole('button', { name: 'Slides' });
    fireEvent.click(layers);
    expect(layers.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('complementary', { name: 'Layers' })).toBeTruthy();
    fireEvent.click(slides);
    expect(layers.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('complementary', { name: 'Layers' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Slides' })).toBeTruthy();
    fireEvent.click(slides);
    expect(screen.queryByRole('complementary', { name: 'Slides' })).toBeNull();
  });

  it('the sidebar toggle hides the open panel and brings back the last one', () => {
    setup(ELEMENTS);
    const toggle = () => screen.getByRole('button', { name: /^(Show|Hide) sidebar$/ });
    expect(toggle().getAttribute('aria-label')).toBe('Show sidebar');
    fireEvent.click(toggle()); // nothing opened yet: defaults to Layers
    expect(screen.getByRole('complementary', { name: 'Layers' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Slides' }));
    expect(toggle().getAttribute('aria-label')).toBe('Hide sidebar');
    fireEvent.click(toggle());
    expect(screen.queryByRole('complementary', { name: 'Slides' })).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByRole('complementary', { name: 'Slides' })).toBeTruthy();
  });

  it('shows component masters as previews', () => {
    const { container } = setup(ELEMENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Components' }));
    const card = screen.getByRole('button', { name: 'Go To: Button' });
    expect(card.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(container.querySelectorAll('.ob-components-card')).toHaveLength(1);
  });
});

describe('slides panel', () => {
  it('lists numbered slide previews in reading order without masters, and goes to a slide', () => {
    const { ui } = setup(ELEMENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Slides' }));
    const cards = screen.getAllByRole('button', { name: /^Slide \d+:/ });
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Slide 1: First', 'Slide 2: Second']);
    expect(cards[0]!.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    const seen: unknown[] = [];
    const off = onFocusBounds((b) => seen.push(b));
    fireEvent.click(cards[1]!);
    off();
    expect(ui.getState().selection).toEqual(['s2']);
    expect(seen).toEqual([{ x: 300, y: 0, width: 100, height: 80 }]);
    expect(ops).toEqual([]);
  });

  it('leaves standalone components out until "Include components" is checked', () => {
    setup(ELEMENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Slides' }));
    const include = screen.getByLabelText('Include components') as HTMLInputElement;
    expect(include.checked).toBe(false);
    expect(screen.getAllByRole('button', { name: /^Slide \d+:/ })).toHaveLength(2);
    fireEvent.click(include);
    expect(screen.getAllByRole('button', { name: /^Slide \d+:/ }).map((c) => c.getAttribute('aria-label'))).toEqual([
      'Slide 1: First',
      'Slide 2: Second',
      'Slide 3: Btn',
    ]);
    // Present and Export PDF use the same list.
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect((ops[0]!.input as { frameIds: string[] }).frameIds).toEqual(['s1', 's2', 'm']);
    fireEvent.click(screen.getByRole('button', { name: 'Present' }));
    expect(getPresentation()?.frameIds).toEqual(['s1', 's2', 'm']);
  });

  it('exports every slide as one PDF op in panel order', () => {
    setup(ELEMENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Slides' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(ops).toEqual([
      { tool: 'openboard.export', input: { format: 'pdf', scope: 'frames', frameIds: ['s1', 's2'], scale: 2, background: 'white' } },
    ]);
  });

  it('has no serious axe violations', async () => {
    const { container } = setup(ELEMENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Slides' }));
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('layers panel', () => {
  it('builds a topmost-first tree with readable labels', () => {
    const tree = layerTree({ elements: ELEMENTS });
    expect(tree.map((n) => n.el.id)).toEqual(['m', 's1', 's2']);
    expect(tree[1]!.children.map((n) => layerLabel(n.el))).toEqual(['Hello world']);
  });

  it('filters layers by name, keeping the path to each match, and Escape clears the search', () => {
    setup(ELEMENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    const search = screen.getByLabelText('Search layers') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'hello' } });
    expect(screen.getByRole('button', { name: 'Hello world' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'First' })).toBeTruthy(); // ancestor of the match
    expect(screen.queryByRole('button', { name: 'Second' })).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No layers match "zzz".')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search.value).toBe('');
    expect(screen.getByRole('complementary', { name: 'Layers' })).toBeTruthy(); // still open
    expect(screen.getByRole('button', { name: 'Second' })).toBeTruthy();
  });

  it('selects rows, expands parents of the selection, and stays accessible', async () => {
    const { ui, container } = setup(ELEMENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(ui.getState().selection).toEqual(['s1']);
    expect(screen.queryByRole('button', { name: 'Hello world' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hello world' }), { shiftKey: true });
    expect(ui.getState().selection).toEqual(['s1', 't']);
    // Selecting a nested element from the canvas reveals it.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse First' }));
    act(() => ui.setSelection(['t']));
    expect(screen.getByRole('button', { name: 'Hello world' }).getAttribute('aria-pressed')).toBe('true');
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('presentation mode', () => {
  it('starts from the Present button, steps with keys, jumps by number, and exits with Escape', () => {
    setup(ELEMENTS);
    fireEvent.click(screen.getByRole('button', { name: 'Slides' }));
    fireEvent.click(screen.getByRole('button', { name: 'Present' }));
    const dialog = screen.getByRole('dialog', { name: 'Presentation' });
    expect(getPresentation()).toEqual({ frameIds: ['s1', 's2'], index: 0 });
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('Slide 1: First');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(getPresentation()?.index).toBe(1);
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // clamped at the last slide
    expect(getPresentation()?.index).toBe(1);
    fireEvent.keyDown(window, { key: 'Home' });
    expect(getPresentation()?.index).toBe(0);

    const number = screen.getByLabelText('Slide number') as HTMLInputElement;
    fireEvent.change(number, { target: { value: '2' } });
    fireEvent.keyDown(number, { key: 'Enter' });
    expect(getPresentation()?.index).toBe(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(getPresentation()).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ops).toEqual([]);
  });

  it('keeps board shortcuts from seeing keys while presenting', () => {
    setup(ELEMENTS);
    act(() => startPresentation(['s1', 's2'], 0));
    let reached = 0;
    const spy = (): void => void reached++;
    window.addEventListener('keydown', spy);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'r' });
    window.removeEventListener('keydown', spy);
    expect(reached).toBe(0);
  });

  it('has no serious axe violations', async () => {
    const { container } = setup(ELEMENTS);
    act(() => startPresentation(['s1', 's2'], 1));
    expect(await seriousViolations(container)).toEqual([]);
  });
});
