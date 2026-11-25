/**
 * Presentation mode state: whether the board is being presented, which frames are the slides
 * (fixed when presenting starts, so panel options such as "Include components" carry over), and
 * which slide is shown. View state only; nothing here edits the document.
 */
import { useSyncExternalStore } from 'react';

export interface PresentationState {
  /** Frame ids of the slides, in order. */
  frameIds: readonly string[];
  /** 0-based slide index. */
  index: number;
}

let state: PresentationState | undefined;
const listeners = new Set<() => void>();

function set(next: PresentationState | undefined): void {
  state = next;
  for (const l of [...listeners]) l();
}

export function startPresentation(frameIds: readonly string[], index = 0): void {
  if (frameIds.length === 0) return;
  set({ frameIds: [...frameIds], index: Math.min(frameIds.length - 1, Math.max(0, Math.floor(index))) });
}

export function stopPresentation(): void {
  if (state) set(undefined);
}

/** Show slide `index`, clamped to 0..count-1. No-op when not presenting. */
export function goToSlide(index: number, count: number): void {
  if (!state || count <= 0) return;
  const i = Math.min(count - 1, Math.max(0, Math.floor(index)));
  if (i !== state.index) set({ ...state, index: i });
}

export function getPresentation(): PresentationState | undefined {
  return state;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePresentation(): PresentationState | undefined {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
