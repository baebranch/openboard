// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listMasters } from '../../core/components/masters';
import { seriousViolations } from '../axeHelper';
import { onFocusBounds } from '../canvas/viewportBus';
import { setOpSender } from '../ops';
import { WebviewStore } from '../store';
import { UiStateStore } from '../uiState';
import type { WebviewStore as Store } from '../store';
import type { UiStateStore as Ui } from '../uiState';
import { BoardPanelsToolbar } from './BoardPanels';
import { PanelStateStore } from './panelState';

/** The sidebar buttons and panels, with a fresh panel state per render. */
function ComponentPanelControl(p: { store: Store; ui: Ui }) {
  const [panels] = useState(() => new PanelStateStore());
  return <BoardPanelsToolbar {...p} panels={panels} />;
}
import { ComponentPanel } from './ComponentPanel';

const frame = (id: string, component?: string) =>
  ({ id, type: 'frame', x: 10, y: 20, width: 100, height: 50, ...(component ? { component } : {}) }) as never;

const boardWith = (elements: unknown[]) =>
  ({ schemaVersion: 1, meta: {}, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [] }) as never;

beforeEach(() =>
  setOpSender(() => {
    throw new Error('Go to master must not dispatch an op');
  }),
);
afterEach(() => {
  cleanup();
  setOpSender(undefined);
});

describe('listMasters', () => {
  it('lists only masters, sorted by name', () => {
    const m = listMasters({ elements: [frame('a', 'Zed'), frame('b'), frame('c', 'Alpha')] });
    expect(m.map((x) => x.name)).toEqual(['Alpha', 'Zed']);
  });
});

describe('ComponentPanel', () => {
  it('shows an empty state with no masters', () => {
    render(<ComponentPanel masters={[]} onGoToMaster={() => {}} />);
    expect(screen.getByRole('status').textContent).toMatch(/No components/);
  });

  it('has no serious axe violations', async () => {
    const masters = listMasters({ elements: [frame('m1', 'Button')] });
    const { container } = render(<ComponentPanel masters={masters} onGoToMaster={() => {}} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('ComponentPanelControl', () => {
  it('toggles the panel and closes on Escape returning focus', () => {
    const store = new WebviewStore();
    store.init(boardWith([]), {} as never, false);
    render(<ComponentPanelControl store={store} ui={new UiStateStore()} />);
    const btn = screen.getByRole('button', { name: 'Components' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('status').textContent).toMatch(/No components/);
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });

  it('has no serious axe violations when open, with unique Go-to-master names (Req 26.3)', async () => {
    const store = new WebviewStore();
    store.init(boardWith([frame('a', 'Alpha'), frame('b', 'Alpha'), frame('c', 'Beta')]), {} as never, false);
    const { container } = render(<ComponentPanelControl store={store} ui={new UiStateStore()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Components' }));
    const names = screen.getAllByRole('button', { name: /^Go To: / }).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('lists masters alphabetically, refreshes on change, and goes to a master without an op', () => {
    const store = new WebviewStore();
    const ui = new UiStateStore();
    store.init(boardWith([frame('b', 'Beta'), frame('z'), frame('a', 'Alpha')]), {} as never, false);
    const seen: unknown[] = [];
    const off = onFocusBounds((b) => seen.push(b));
    render(<ComponentPanelControl store={store} ui={ui} />);
    fireEvent.click(screen.getByRole('button', { name: 'Components' }));
    const names = () => screen.getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent);
    expect(names()).toEqual(['Alpha', 'Beta']);

    act(() => store.init(boardWith([frame('c', 'Cee'), frame('a', 'Alpha')]), {} as never, false));
    expect(names()).toEqual(['Alpha', 'Cee']);

    const cee = screen.getByRole('button', { name: 'Go To: Cee' });
    expect(cee.getAttribute('title')).toBe('Go To: Cee');
    fireEvent.click(cee);
    off();
    expect(ui.getState().selection).toEqual(['c']);
    expect(seen).toEqual([{ x: 10, y: 20, width: 100, height: 50 }]);
  });
});
