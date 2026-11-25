/** Numeric ranges from the requirements (inclusive on both ends). */

export interface Range {
  readonly min: number;
  readonly max: number;
}

export const CURRENT_SCHEMA_VERSION = 1;

/** Canvas coordinate range per axis (Req 3.1). */
export const COORD_RANGE: Range = { min: -1_000_000, max: 1_000_000 };
/** Zoom 2%..800% (Req 3.4). */
export const ZOOM_RANGE: Range = { min: 0.02, max: 8 };
export const MIN_SIZE = 1;
export const ROTATION_RANGE: Range = { min: -360, max: 360 };
export const STROKE_WIDTH_RANGE: Range = { min: 0, max: 100 };
export const OPACITY_RANGE: Range = { min: 0, max: 100 };
export const FONT_SIZE_RANGE: Range = { min: 1, max: 999 };
export const FREEHAND_BASE_WIDTH_RANGE: Range = { min: 1, max: 100 };
export const LIBRARY_NAME_LENGTH: Range = { min: 1, max: 100 };
export const ALT_TEXT_MAX = 500;
export const EDGE_LABEL_MAX = 200;

export function clamp(value: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, value));
}

export function inRange(value: number, range: Range): boolean {
  return value >= range.min && value <= range.max;
}

/** Round to 2 decimal places (position and size precision). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Corner radius upper bound: half of the shorter side. */
export function maxCornerRadius(width: number, height: number): number {
  return Math.min(width, height) / 2;
}
