/**
 * Which board sidebar panel (Layers, Slides, Components) is open. Shared by the buttons in the tool
 * palette and the sidebar itself, which render in different places. The last panel shown is
 * remembered so the sidebar toggle can bring it back. View state only.
 */
import { useSyncExternalStore } from 'react';

export type PanelId = 'layers' | 'slides' | 'components';

export interface PanelState {
  open: PanelId | undefined;
  /** Panel the sidebar toggle reopens. */
  last: PanelId;
}

export class PanelStateStore {
  private state: PanelState = { open: undefined, last: 'layers' };
  private readonly listeners = new Set<() => void>();

  getState = (): PanelState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(next: PanelState): void {
    if (next.open === this.state.open && next.last === this.state.last) return;
    this.state = next;
    for (const l of [...this.listeners]) l();
  }

  /** Open `id`, or close it when it is already open. */
  toggle(id: PanelId): void {
    this.set(this.state.open === id ? { ...this.state, open: undefined } : { open: id, last: id });
  }

  /** Show or hide the sidebar, reopening the last panel. */
  toggleSidebar(): void {
    this.set(this.state.open ? { ...this.state, open: undefined } : { ...this.state, open: this.state.last });
  }

  close(): void {
    this.set({ ...this.state, open: undefined });
  }
}

export const panelState = new PanelStateStore();

export function usePanelState(s: PanelStateStore = panelState): PanelState {
  return useSyncExternalStore(s.subscribe, s.getState, s.getState);
}

/** Attribute that marks a panel's button, so closing a panel can return focus to it. */
export const PANEL_BUTTON_ATTR = 'data-panel-button';
