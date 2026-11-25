/**
 * Pure single-frame stack arrangement (Auto Layout). No vscode or DOM imports.
 *
 * Callers resolve hug/fill sizes first; this function only computes positions.
 * Rotation is never read: layout uses unrotated bounds.
 */

import type { ElementId } from '../model/types';
import { round2 } from '../model/ranges';
import type { TokenCollection } from '../tokens/types';
import { resolveLayoutSpacing } from '../tokens/number-fields';
import type { LayoutSpec } from './types';

export interface StackChildInput {
  id: ElementId;
  /** Current position, used only to order children along the main axis. */
  x: number;
  y: number;
  /** Already-resolved size. */
  width: number;
  height: number;
  ignoreLayout?: boolean;
}

export interface StackFrameInput {
  width: number;
  height: number;
  /** Frame origin in document coordinates. Defaults to 0 (offsets relative to the frame). */
  x?: number;
  y?: number;
  layout: LayoutSpec;
  /** Resolves Token_References in gap and padding (Req 11.15). */
  tokens?: TokenCollection;
}

/** Round to 2 decimals and normalise negative zero. */
function r2(value: number): number {
  return round2(value) + 0;
}

/**
 * Compute child positions for a stack Layout_Frame.
 * Children with `ignoreLayout` are omitted from the result.
 * Children are ordered by main-axis center (ties by input order).
 */
export function arrangeStack(
  frame: StackFrameInput,
  children: readonly StackChildInput[],
): Map<ElementId, { x: number; y: number }> {
  const out = new Map<ElementId, { x: number; y: number }>();
  const layout = resolveLayoutSpacing(frame.layout, frame.tokens);
  const horizontal = layout.direction === 'horizontal';
  const { top, right, bottom, left } = layout.padding;

  const originX = frame.x ?? 0;
  const originY = frame.y ?? 0;

  const mainStart = (horizontal ? left : top) + (horizontal ? originX : originY);
  const crossStart = (horizontal ? top : left) + (horizontal ? originY : originX);
  const innerMain = (horizontal ? frame.width - left - right : frame.height - top - bottom);
  const innerCross = (horizontal ? frame.height - top - bottom : frame.width - left - right);

  const mainSize = (c: StackChildInput): number => (horizontal ? c.width : c.height);
  const crossSize = (c: StackChildInput): number => (horizontal ? c.height : c.width);
  const mainCenter = (c: StackChildInput): number =>
    horizontal ? c.x + c.width / 2 : c.y + c.height / 2;

  // Stable sort by main-axis center; index is the explicit tie-break.
  const ordered = children
    .filter((c) => !c.ignoreLayout)
    .map((c, index) => ({ c, index, center: mainCenter(c) }))
    .sort((a, b) => a.center - b.center || a.index - b.index)
    .map((e) => e.c);

  const n = ordered.length;
  if (n === 0) return out;

  const gap = layout.gap;
  const total = ordered.reduce((s, c) => s + mainSize(c), 0);
  const run = total + gap * (n - 1);
  const overflow = run > innerMain;

  let offset = 0;
  let step = gap;
  if (!overflow) {
    switch (layout.mainAlign) {
      case 'center':
        offset = (innerMain - run) / 2;
        break;
      case 'end':
        offset = innerMain - run;
        break;
      case 'spaceBetween':
        if (n > 1) step = (innerMain - total) / (n - 1);
        break;
      default:
        break;
    }
  }

  let cursor = mainStart + offset;
  for (const c of ordered) {
    let crossOffset = 0;
    const free = innerCross - crossSize(c);
    if (layout.crossAlign === 'center') crossOffset = free / 2;
    else if (layout.crossAlign === 'end') crossOffset = free;
    const cross = crossStart + crossOffset;
    out.set(
      c.id,
      horizontal ? { x: r2(cursor), y: r2(cross) } : { x: r2(cross), y: r2(cursor) },
    );
    cursor += mainSize(c) + step;
  }
  return out;
}
