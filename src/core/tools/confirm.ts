import type { ToolDefinition } from './registry';

/** Maximum length of a destructive confirmation message (Req 14.17). */
export const MAX_CONFIRMATION_LENGTH = 300;

const ELLIPSIS = '\u2026';

/** Keeps the last `max` UTF-16 units of `s`, prefixed with an ellipsis when shortened. */
function shortenLeft(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 0) return '';
  let tail = s.slice(s.length - (max - 1));
  // Do not start on a lone low surrogate.
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
  return ELLIPSIS + tail;
}

/** Keeps the first `max` UTF-16 units of `s`, suffixed with an ellipsis when shortened. */
function shortenRight(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 0) return '';
  let head = s.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return head + ELLIPSIS;
}

/**
 * Builds `"<tool> on <board path>: <effect>"` of at most 300 characters. When too long, the
 * board path is shortened from the left (suffix kept) and the effect from the right (prefix kept);
 * the tool name is always kept.
 */
export function buildConfirmation(toolName: string, boardPath: string, effectSummary: string): string {
  const head = `${toolName} on `;
  const sep = ': ';
  const full = `${head}${boardPath}${sep}${effectSummary}`;
  if (full.length <= MAX_CONFIRMATION_LENGTH) return full;

  const room = MAX_CONFIRMATION_LENGTH - head.length - sep.length;
  if (room < 2) return shortenRight(full, MAX_CONFIRMATION_LENGTH);

  // The path takes what the effect leaves, but never less than half the room (or its own length).
  const pathBudget = Math.min(boardPath.length, Math.max(room - effectSummary.length, Math.ceil(room / 2)));
  const path = shortenLeft(boardPath, pathBudget);
  const effect = shortenRight(effectSummary, room - path.length);
  return `${head}${path}${sep}${effect}`;
}

/** Minimal registry view needed to classify invocations. */
export interface DestructiveLookup {
  def(name: string): Pick<ToolDefinition, 'destructive'>;
}

const BATCH_TOOL = 'openboard.batch';

/**
 * True when the tool is flagged destructive, or it is a batch containing any destructive
 * operation. Unknown operation tools are ignored here (they fail validation later).
 */
export function isDestructiveInvocation(registry: DestructiveLookup, toolName: string, input: unknown): boolean {
  let def: Pick<ToolDefinition, 'destructive'>;
  try {
    def = registry.def(toolName);
  } catch {
    return false;
  }
  if (def.destructive) return true;
  if (toolName !== BATCH_TOOL) return false;
  const ops = (input as { operations?: unknown } | null | undefined)?.operations;
  if (!Array.isArray(ops)) return false;
  return ops.some((op) => {
    const tool = (op as { tool?: unknown } | null)?.tool;
    if (typeof tool !== 'string') return false;
    try {
      return registry.def(tool).destructive === true;
    } catch {
      return false;
    }
  });
}
