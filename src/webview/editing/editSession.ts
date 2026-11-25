/**
 * Pure inline-text-edit state machine (Req 6.3, 6.4, 6.5, 6.11). No DOM, no React.
 * A session starts on an element, tracks its runs while editing and yields at most one op on exit.
 */
import { elementToDeleteOnTextEditExit } from '../../core/shapes';
import { applyStyleToRange, normalizeRuns, rangeHasStyle, type RunStyleKey } from '../../core/text';
import type { Element, ElementId, TextRun } from '../../core/model/types';
import { deleteOp, TOOL_ELEMENT_CREATE, TOOL_ELEMENT_UPDATE, type Op } from '../canvas/gestures';

/** Entering edit mode must happen within this many ms of a double-click (Req 6.5). */
export const EDIT_ENTER_BUDGET_MS = 100;

export type TextBearing = Extract<Element, { type: 'text' | 'sticky' | 'flowNode' }>;

export function isTextBearing(el: Element | undefined): el is TextBearing {
  return !!el && (el.type === 'text' || el.type === 'sticky' || el.type === 'flowNode');
}

export interface EditSession {
  readonly elementId: ElementId;
  /** True when the element was created by this edit (click with the Text tool). */
  readonly isNew: boolean;
  /** Runs at the moment editing started (existing text is preserved). */
  readonly original: readonly TextRun[];
}

export function beginEdit(el: TextBearing, isNew = false): EditSession {
  return { elementId: el.id, isNew, original: normalizeRuns(el.runs) };
}

/** Double-click target: the topmost text-bearing element, or undefined. */
export function editTargetForDoubleClick(el: Element | undefined, readOnly: boolean): TextBearing | undefined {
  if (readOnly || !isTextBearing(el) || el.locked) return undefined;
  return el;
}

/** Op that creates an empty text element with a caller-chosen id so edit mode can start at once. */
export function createTextOp(id: ElementId, b: { x: number; y: number; width: number; height: number }): Op {
  return {
    tool: TOOL_ELEMENT_CREATE,
    input: { elements: [{ id, type: 'text', x: b.x, y: b.y, width: b.width, height: b.height, text: '' }] },
  };
}

export type EditOutcome =
  | { kind: 'delete'; op: Op }
  | { kind: 'update'; op: Op }
  | { kind: 'none' };

function sameRuns(a: readonly TextRun[], b: readonly TextRun[]): boolean {
  const x = normalizeRuns(a);
  const y = normalizeRuns(b);
  return x.length === y.length && x.every((r, i) => r.text === y[i]!.text && !!r.bold === !!y[i]!.bold && !!r.italic === !!y[i]!.italic && !!r.underline === !!y[i]!.underline);
}

/**
 * Result of leaving edit mode with `runs`: an empty text element is deleted (Req 6.4), changed
 * runs commit as one update, an unchanged element is left alone.
 */
export function endEdit(session: EditSession, el: TextBearing | undefined, runs: readonly TextRun[]): EditOutcome {
  if (!el) return { kind: 'none' };
  const next = normalizeRuns(runs);
  const doomed = elementToDeleteOnTextEditExit({ ...el, runs: next } as Element);
  if (doomed !== undefined) {
    const op = deleteOp([doomed]);
    return op ? { kind: 'delete', op } : { kind: 'none' };
  }
  if (sameRuns(session.original, next)) return { kind: 'none' };
  return { kind: 'update', op: { tool: TOOL_ELEMENT_UPDATE, input: { ids: [el.id], set: { runs: next } } } };
}

export const STYLE_SHORTCUTS: Readonly<Record<string, RunStyleKey>> = { b: 'bold', i: 'italic', u: 'underline' };

/** Ctrl/Cmd+B/I/U -> the style to toggle, otherwise undefined. */
export function styleForShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean }): RunStyleKey | undefined {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return undefined;
  return STYLE_SHORTCUTS[e.key.toLowerCase()];
}

/** Toggle `key` over the character range: removes it when the whole range has it, otherwise applies it. */
export function toggleStyle(runs: readonly TextRun[], start: number, end: number, key: RunStyleKey): TextRun[] {
  const on = rangeHasStyle(runs, start, end, key);
  return applyStyleToRange(runs, start, end, key, !on);
}
