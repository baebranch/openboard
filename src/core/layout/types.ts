/** Auto Layout data model types. Pure TypeScript: no vscode or DOM imports. */

export const SIZING_MODES = ['fixed', 'hug', 'fill'] as const;
export type SizingMode = (typeof SIZING_MODES)[number];

export const MAIN_AXIS_ALIGNS = ['start', 'center', 'end', 'spaceBetween'] as const;
export type MainAxisAlign = (typeof MAIN_AXIS_ALIGNS)[number];

export const CROSS_AXIS_ALIGNS = ['start', 'center', 'end'] as const;
export type CrossAxisAlign = (typeof CROSS_AXIS_ALIGNS)[number];

export const STACK_DIRECTIONS = ['horizontal', 'vertical'] as const;
export type StackDirection = (typeof STACK_DIRECTIONS)[number];

/** Inclusive range for `gap` and every padding side. */
export const LAYOUT_SPACING_RANGE = { min: 0, max: 1000 } as const;

/** A spacing value: a number, or a Token_Reference (`token:<name>`) to a number Token (Req 11.15). */
export type Spacing = number | string;

export interface LayoutPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A resolved layout: every spacing value is a number. */
export interface LayoutConfig {
  direction: StackDirection;
  /** 0..1000 */
  gap: number;
  /** Each side 0..1000 */
  padding: LayoutPadding;
  mainAlign: MainAxisAlign;
  crossAlign: CrossAxisAlign;
}

/**
 * A layout as stored on a Frame: gap and padding sides may be Token_References to number
 * Tokens (Req 11.15). Every LayoutConfig is a LayoutSpec.
 */
export interface LayoutSpec extends Omit<LayoutConfig, 'gap' | 'padding'> {
  gap: Spacing;
  padding: { top: Spacing; right: Spacing; bottom: Spacing; left: Spacing };
}

export interface Sizing {
  width: SizingMode;
  height: SizingMode;
}
