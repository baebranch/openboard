/**
 * Pure per-document state shared by every editor tab of one board: the BoardModel, its
 * UndoHistory, dirty-tracking edit events and read-only/invalid status. No vscode imports.
 */
import { serialize } from '../../core/format/serializer';
import { createEmptyDocument } from '../../core/format/parser';
import type { BoardDocument, Viewport } from '../../core/model/types';
import { BoardModel, type ChangeEvent } from '../../core/ops/model';
import { UndoHistory } from '../../core/ops/history';
import type { Patch } from '../../core/ops/patches';
import { LARGE_BOARD_ELEMENT_THRESHOLD, type InvalidReason, type LoadOutcome } from './loader';

/** Edit event handed to the IDE; the callbacks route IDE Undo/Redo into UndoHistory (Req 10.10). */
export interface EditEvent {
  label: string;
  undo(): void;
  redo(): void;
}

/** Content change to broadcast to every attached webview session. */
export type ContentEvent =
  | { kind: 'patch'; revision: number; patches: Patch[] }
  | { kind: 'reset'; doc: BoardDocument };

export type Disposer = () => void;

export class BoardDocumentState {
  readonly model: BoardModel | undefined;
  readonly history: UndoHistory | undefined;
  readonly readOnly: boolean;
  readonly invalid: InvalidReason | undefined;
  /** Raw file text retained for newer-version (read-only) documents (Req 11.10). */
  readonly rawText: string | undefined;
  /** Last viewport reported by a webview (Req 2.10). */
  viewport: Viewport | undefined;

  private revisionCounter = 0;
  private readonly editListeners = new Set<(e: EditEvent) => void>();
  private readonly contentListeners = new Set<(e: ContentEvent) => void>();
  private offModel: Disposer | undefined;

  constructor(path: string, outcome: LoadOutcome, historyLimit?: number) {
    if (outcome.ok) {
      this.readOnly = outcome.readOnly;
      this.rawText = outcome.rawText;
      this.invalid = undefined;
      this.history = new UndoHistory(historyLimit);
      this.model = new BoardModel(path, outcome.doc, { history: this.history });
      this.offModel = this.model.onDidChange((e) => this.onModelChange(e));
    } else {
      this.readOnly = true;
      this.rawText = undefined;
      this.invalid = outcome.reason;
      this.model = undefined;
      this.history = undefined;
    }
  }

  /** A new, empty, unsaved board (Req 2.2). */
  static untitled(path: string, historyLimit?: number): BoardDocumentState {
    return new BoardDocumentState(path, { ok: true, doc: createEmptyDocument(), readOnly: false }, historyLimit);
  }

  get isValid(): boolean {
    return this.model !== undefined;
  }

  get canEdit(): boolean {
    return this.model !== undefined && !this.readOnly;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  getDocument(): BoardDocument | undefined {
    return this.model?.getDocument();
  }

  elementCount(): number {
    return this.model?.getDocument().elements.length ?? 0;
  }

  /** True when the performance notice applies (Req 17.6). */
  isLarge(): boolean {
    return this.elementCount() > LARGE_BOARD_ELEMENT_THRESHOLD;
  }

  onDidEdit(l: (e: EditEvent) => void): Disposer {
    this.editListeners.add(l);
    return () => this.editListeners.delete(l);
  }

  onDidChangeContent(l: (e: ContentEvent) => void): Disposer {
    this.contentListeners.add(l);
    return () => this.contentListeners.delete(l);
  }

  /** Bytes to write on Save. Newer-version documents are written back verbatim, never reserialized. */
  toBytes(): Uint8Array {
    if (!this.model) throw new Error('Cannot save an invalid board');
    const text = this.readOnly && this.rawText !== undefined ? this.rawText : serialize(this.model.getDocument());
    return new TextEncoder().encode(text);
  }

  /** Replaces the content (revert / reload from disk). Clears history and tells every session. */
  replaceContent(outcome: LoadOutcome): boolean {
    if (!this.model || !outcome.ok || outcome.readOnly !== this.readOnly) return false;
    this.model.reset(outcome.doc);
    this.history?.clear();
    this.revisionCounter++;
    this.emitContent({ kind: 'reset', doc: outcome.doc });
    return true;
  }

  dispose(): void {
    this.offModel?.();
    this.offModel = undefined;
    this.editListeners.clear();
    this.contentListeners.clear();
  }

  private onModelChange(e: ChangeEvent): void {
    // `scope-commit` only records the merged undo entry; its content went out with the `scoped` events.
    if (e.kind !== 'scope-commit') {
      this.revisionCounter++;
      this.emitContent({ kind: 'patch', revision: this.revisionCounter, patches: e.patches });
    }
    // undo/redo/rollback applications and in-scope edits are not IDE edits (the commit is)
    if (e.kind !== 'transact' && e.kind !== 'scope-commit') return;
    const model = this.model;
    const history = this.history;
    if (!model || !history) return;
    const event: EditEvent = {
      label: e.label,
      undo: () => void history.undo(model),
      redo: () => void history.redo(model),
    };
    for (const l of [...this.editListeners]) l(event);
  }

  private emitContent(e: ContentEvent): void {
    for (const l of [...this.contentListeners]) l(e);
  }
}
