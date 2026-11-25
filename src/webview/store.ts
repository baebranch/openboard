/** Webview state store, consumed through useSyncExternalStore (Req 16.1). */
import { useSyncExternalStore } from 'react';
import type { BoardDocument } from '../core/model/types';
import { applyPatches, type Patch } from '../core/ops/patches';
import type { Settings } from '../core/settings/settings';

export interface Notice {
  id: number;
  level: string;
  message: string;
}

export interface WebviewState {
  doc: BoardDocument | undefined;
  revision: number;
  settings: Settings | undefined;
  readOnly: boolean;
  notices: readonly Notice[];
}

const MAX_NOTICES = 20;

export class WebviewStore {
  private state: WebviewState = { doc: undefined, revision: 0, settings: undefined, readOnly: false, notices: [] };
  private listeners = new Set<() => void>();
  private nextNoticeId = 1;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): WebviewState => this.state;

  private set(next: Partial<WebviewState>): void {
    this.state = { ...this.state, ...next };
    for (const l of [...this.listeners]) l();
  }

  init(doc: BoardDocument, settings: Settings, readOnly: boolean): void {
    this.set({ doc, settings, readOnly, revision: 0 });
  }

  reset(doc: BoardDocument): void {
    this.set({ doc });
  }

  setSettings(settings: Settings): void {
    this.set({ settings });
  }

  /** Apply host patches to the local replica; returns false when there is no document yet or a patch fails. */
  applyPatches(patches: readonly Patch[], revision: number): boolean {
    const doc = this.state.doc;
    if (!doc) return false;
    try {
      this.set({ doc: applyPatches(doc, patches), revision });
      return true;
    } catch {
      return false;
    }
  }

  addNotice(level: string, message: string): void {
    const notices = [...this.state.notices, { id: this.nextNoticeId++, level, message }].slice(-MAX_NOTICES);
    this.set({ notices });
  }

  dismissNotice(id: number): void {
    this.set({ notices: this.state.notices.filter((n) => n.id !== id) });
  }
}

export const store = new WebviewStore();

export function useWebviewState(s: WebviewStore = store): WebviewState {
  return useSyncExternalStore(s.subscribe, s.getState, s.getState);
}
