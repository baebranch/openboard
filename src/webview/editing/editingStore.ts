/** Transient inline-edit state shared by the canvas and the editing layer. */
import { useSyncExternalStore } from 'react';
import { newId } from '../../core/model';
import type { ElementId } from '../../core/model/types';
import type { Op } from '../canvas/gestures';
import { createTextOp, type EditSession } from './editSession';

export interface EditingState {
  session: EditSession | undefined;
  /** Id of a text element just requested from the host; edit mode starts once it arrives. */
  pendingNew: ElementId | undefined;
}

export class EditingStore {
  private state: EditingState = { session: undefined, pendingNew: undefined };
  private listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): EditingState => this.state;

  private set(next: Partial<EditingState>): void {
    this.state = { ...this.state, ...next };
    for (const l of [...this.listeners]) l();
  }

  /** Click with the Text tool: returns the create op; edit mode opens when the element appears. */
  beginTextCreate = (b: { x: number; y: number; width: number; height: number }): Op => {
    const id = newId();
    this.set({ pendingNew: id });
    return createTextOp(id, b);
  };

  clearPending = (): void => {
    if (this.state.pendingNew !== undefined) this.set({ pendingNew: undefined });
  };

  start = (session: EditSession): void => this.set({ session, pendingNew: undefined });
  stop = (): void => {
    if (this.state.session) this.set({ session: undefined });
  };
}

export const editingStore = new EditingStore();

export function useEditing(s: EditingStore = editingStore): EditingState {
  return useSyncExternalStore(s.subscribe, s.getState, s.getState);
}
