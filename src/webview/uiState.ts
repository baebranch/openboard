/**
 * Webview UI state shared by the canvas, tool palette and properties panel: the active tool and the
 * selection. The document itself lives in `store.ts`; this holds only transient UI state.
 */
import { useSyncExternalStore } from 'react';
import type { ElementId } from '../core/model/types';

export type ToolId =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'freehand'
  | 'text'
  | 'image'
  | 'frame'
  | 'sticky'
  | 'eraser'
  | 'icon';

export interface UiState {
  activeTool: ToolId;
  selection: readonly ElementId[];
  /** Icon chosen in the icon picker; the Icon tool places this name on click (Req 23.3). */
  iconName: string | undefined;
}

const EMPTY: readonly ElementId[] = Object.freeze([]) as readonly ElementId[];

function sameIds(a: readonly ElementId[], b: readonly ElementId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export class UiStateStore {
  private state: UiState = { activeTool: 'select', selection: EMPTY, iconName: undefined };
  private listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): UiState => this.state;

  private set(next: Partial<UiState>): void {
    this.state = { ...this.state, ...next };
    for (const l of [...this.listeners]) l();
  }

  setActiveTool = (tool: ToolId): void => {
    if (tool !== this.state.activeTool) this.set({ activeTool: tool });
  };

  setIconName = (name: string | undefined): void => {
    if (name !== this.state.iconName) this.set({ iconName: name });
  };

  private cancelListeners = new Set<() => void>();

  /** Subscribe to `cancelCreation`: in-progress creation gestures must be discarded without adding an Element. */
  onCancelCreation = (l: () => void): (() => void) => {
    this.cancelListeners.add(l);
    return () => this.cancelListeners.delete(l);
  };

  /** Emit `cancelCreation` (Esc, Req 5.13). Selection is untouched. */
  cancelCreation = (): void => {
    for (const l of [...this.cancelListeners]) l();
  };

  /** Replace the selection; a no-op when the ids are unchanged. */
  setSelection = (ids: readonly ElementId[]): void => {
    const next = ids.length === 0 ? EMPTY : [...ids];
    if (!sameIds(this.state.selection, next)) this.set({ selection: next });
  };
}

export const uiState = new UiStateStore();

export const getActiveTool = (): ToolId => uiState.getState().activeTool;
export const setActiveTool = (tool: ToolId): void => uiState.setActiveTool(tool);
export const getSelection = (): readonly ElementId[] => uiState.getState().selection;
export const setSelection = (ids: readonly ElementId[]): void => uiState.setSelection(ids);
export const subscribeUiState = (listener: () => void): (() => void) => uiState.subscribe(listener);

export const cancelCreation = (): void => uiState.cancelCreation();
export const onCancelCreation = (l: () => void): (() => void) => uiState.onCancelCreation(l);

export function useUiState(s: UiStateStore = uiState): UiState {
  return useSyncExternalStore(s.subscribe, s.getState, s.getState);
}
