/**
 * Number Tokens in layout spacing fields (Requirement 11.15).
 *
 * A layout `gap` or padding side holds either a finite number or a Token_Reference to a number
 * Token. Resolution is pure and total: a missing Token, or a Token whose value is not a finite
 * number, resolves to 0 (the layout default); a resolved value is clamped to the spacing range.
 * A layout that holds plain numbers is returned as is, so documents without number Tokens
 * lay out exactly as before.
 */
import { LAYOUT_SPACING_RANGE, type LayoutConfig, type LayoutSpec, type Spacing } from '../layout/types';
import type { TokenCollection } from './types';
import { tokenRefName } from './validate';

/** Resolves one spacing value (number or `token:<name>`) to a number in the spacing range. */
export function resolveSpacing(value: Spacing, tokens: TokenCollection | undefined): number {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else {
    const name = tokenRefName(value);
    const bucket = tokens?.numbers;
    const v = name !== undefined && bucket && Object.prototype.hasOwnProperty.call(bucket, name) ? bucket[name] : undefined;
    n = typeof v === 'number' ? v : 0;
  }
  if (!Number.isFinite(n)) return 0;
  return Math.min(LAYOUT_SPACING_RANGE.max, Math.max(LAYOUT_SPACING_RANGE.min, n));
}

/** Returns the layout with gap and padding as numbers; the same object when they already are. */
export function resolveLayoutSpacing(layout: LayoutSpec, tokens: TokenCollection | undefined): LayoutConfig {
  const { gap, padding } = layout;
  if (
    typeof gap === 'number' &&
    typeof padding.top === 'number' &&
    typeof padding.right === 'number' &&
    typeof padding.bottom === 'number' &&
    typeof padding.left === 'number'
  ) {
    return layout as LayoutConfig;
  }
  return {
    ...layout,
    gap: resolveSpacing(gap, tokens),
    padding: {
      top: resolveSpacing(padding.top, tokens),
      right: resolveSpacing(padding.right, tokens),
      bottom: resolveSpacing(padding.bottom, tokens),
      left: resolveSpacing(padding.left, tokens),
    },
  };
}
