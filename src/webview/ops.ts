/**
 * The single dispatcher for document edits (Req 10.5, 16.x). Every edit made in the webview goes
 * through `dispatchOp`, which posts `{ type: 'op', gestureId, tool, input }` to the host. The webview
 * never mutates its document replica locally; the host replies with an ack/patch.
 */
import type { WebviewToHost } from '../shared/messages';

export type OpSender = (message: WebviewToHost) => void;

let sender: OpSender | undefined;
let counter = 0;
const sessionSalt = Math.random().toString(36).slice(2, 8);

/** Wire the transport (called once from main.tsx). */
export function setOpSender(next: OpSender | undefined): void {
  sender = next;
}

/** Unique per gesture within this webview session. */
export function nextGestureId(): string {
  counter += 1;
  return `g-${sessionSalt}-${counter}`;
}

/** Post one operation (one undo entry) to the host. Returns the gesture id used. */
export function dispatchOp(tool: string, input?: unknown, gestureId: string = nextGestureId()): string {
  const message: WebviewToHost = input === undefined ? { type: 'op', gestureId, tool } : { type: 'op', gestureId, tool, input };
  sender?.(message);
  return gestureId;
}

/** Post a (debounced by the caller) viewport change. */
export function postViewport(viewport: { x: number; y: number; zoom: number }): void {
  sender?.({ type: 'viewport', viewport });
}

/** Post the current selection to the host. */
export function postSelection(ids: string[]): void {
  sender?.({ type: 'selection', ids });
}
