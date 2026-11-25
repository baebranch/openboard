/**
 * Test-support: simulated webviews that apply host messages to a local copy of the board, so
 * tests (and the multi-session convergence property test, task 16.8) can assert that every tab
 * converges to the host document. No vscode imports.
 */
import type { BoardDocument } from '../../core/model/types';
import { applyPatches } from '../../core/ops/patches';
import type { HostToWebview } from '../../shared/messages';
import type { Session } from './session';

export class SimulatedWebview {
  doc: BoardDocument | undefined;
  revision = 0;
  readonly received: HostToWebview[] = [];
  readonly acked: string[] = [];
  viewport: { x: number; y: number; zoom: number } | undefined;
  /** Revisions seen out of order (should always stay empty). */
  readonly gaps: number[] = [];
  readonly session: Session;

  constructor(readonly id: string) {
    this.session = { id, post: (m) => this.receive(m) };
  }

  receive(m: HostToWebview): void {
    this.received.push(m);
    switch (m.type) {
      case 'init':
        this.doc = m.doc;
        this.viewport = m.doc.viewport;
        return;
      case 'reset':
        this.doc = m.doc;
        return;
      case 'patch':
        if (this.doc) this.doc = applyPatches(this.doc, m.patches);
        this.noteRevision(m.revision);
        return;
      case 'ack':
        if (this.doc) this.doc = applyPatches(this.doc, m.patches);
        this.acked.push(m.gestureId);
        this.noteRevision(m.revision);
        return;
      case 'viewport':
        this.viewport = m.viewport;
        return;
      default:
        return;
    }
  }

  private noteRevision(r: number): void {
    if (r < this.revision) this.gaps.push(r);
    this.revision = r;
  }
}

/** True when every simulated webview shows the same elements as the host document. */
export function converged(host: BoardDocument | undefined, views: readonly SimulatedWebview[]): boolean {
  return views.every((v) => JSON.stringify(v.doc?.elements) === JSON.stringify(host?.elements));
}

/** Fake timer scheduler advanced manually. */
export class FakeScheduler {
  now = 0;
  private next = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.next++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown): void => void this.timers.delete(h as number);
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = end;
  }
}
