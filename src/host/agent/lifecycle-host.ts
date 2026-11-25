/**
 * Host side of the board lifecycle tools (task 8.3).
 *
 * TODO(16.12): back this with the BoardEditorProvider's open documents (the provider keeps no
 * documents map yet) and wire it into extension activation. Until then every operation reports
 * `not_implemented` so the tools stay registered but fail cleanly.
 */
import type { BoardInfo, BoardLifecycleHost } from '../../core/tools/board-tools';

function notImplemented(op: string): never {
  throw Object.assign(new Error(`Board lifecycle operation "${op}" is not wired to the editor yet`), {
    code: 'not_implemented',
  });
}

export class StubBoardLifecycleHost implements BoardLifecycleHost {
  list(): BoardInfo[] {
    return [];
  }
  active(): string | undefined {
    return undefined;
  }
  open(): Promise<BoardInfo> {
    return Promise.reject(Object.assign(new Error('not wired'), { code: 'not_implemented' }));
  }
  create(): Promise<BoardInfo> {
    return Promise.resolve(notImplemented('create'));
  }
  save(): Promise<void> {
    return Promise.resolve(notImplemented('save'));
  }
  close(): Promise<void> {
    return Promise.resolve(notImplemented('close'));
  }
}
