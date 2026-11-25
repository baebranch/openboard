/** Bridges host `viewport` messages (messaging.ts) to the mounted Canvas. */
import type { Viewport } from '../../core/model/types';
import type { ViewCommandName } from '../../shared/messages';

type Listener = (v: Viewport) => void;

const listeners = new Set<Listener>();

type ViewCommandListener = (c: ViewCommandName) => void;
const viewCommandListeners = new Set<ViewCommandListener>();

/** Called by messaging for host `view:command` messages (zoom to fit, toggle grid/minimap). */
export function emitViewCommand(c: ViewCommandName): void {
  for (const l of [...viewCommandListeners]) l(c);
}

export function onViewCommand(l: ViewCommandListener): () => void {
  viewCommandListeners.add(l);
  return () => viewCommandListeners.delete(l);
}

/** Called by messaging when the host asks the webview to restore a viewport. */
export function emitHostViewport(v: Viewport): void {
  for (const l of [...listeners]) l(v);
}

export function onHostViewport(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Debounce helper for viewport posts; `flush` runs a pending call immediately. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const run = (): void => {
    timer = undefined;
    if (pending) {
      const a = pending;
      pending = undefined;
      fn(...a);
    }
  };
  const d = ((...a: A) => {
    pending = a;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as ((...a: A) => void) & { flush(): void; cancel(): void };
  d.flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    run();
  };
  d.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  return d;
}
