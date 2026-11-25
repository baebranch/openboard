/** Design token categories (Requirement 11.1). */
export const TOKEN_CATEGORIES = ['colors', 'fonts', 'numbers'] as const;
export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];

/** Limits from Requirements 11.1 and 11.3. */
export const MAX_TOKEN_NAME_LENGTH = 64;
export const MAX_TOKENS_PER_CATEGORY = 500;
export const MAX_FONT_VALUE_LENGTH = 200;

/** Prefix that marks a Token_Reference inside a color field or `fontFamily`. */
export const TOKEN_REF_PREFIX = 'token:';

/** Token modes (Requirement 12). A color Token holds one literal or one literal per mode. */
export const TOKEN_MODES = ['light', 'dark'] as const;
export type TokenMode = (typeof TOKEN_MODES)[number];
export const ACTIVE_MODES = ['light', 'dark', 'auto'] as const;
export type ActiveMode = (typeof ACTIVE_MODES)[number];
export interface ColorModeValues {
  light: string;
  dark: string;
}
export type ColorTokenValue = string | ColorModeValues;
/** Any token value: a color (one literal or one per mode), a font string, or a number. */
export type TokenValue = ColorTokenValue | number;

/**
 * The optional top-level `tokens` collection of a board document. Values are
 * always literals, never Token_References (Requirement 11.3).
 */
export interface TokenCollection {
  colors?: Record<string, ColorTokenValue>;
  fonts?: Record<string, string>;
  numbers?: Record<string, number>;
}

/** Tokens flattened to literal values, ready for the renderer. */
export interface ResolvedTokens {
  colors: ReadonlyMap<string, string>;
  fonts: ReadonlyMap<string, string>;
  numbers: ReadonlyMap<string, number>;
}

export type TokenErrorCode =
  | 'invalid_name'
  | 'invalid_value'
  | 'token_reference_value'
  | 'duplicate_name'
  | 'limit_exceeded';

export type TokenCheck<T> = { ok: true; value: T } | { ok: false; code: TokenErrorCode; message: string };

/** A Token_Reference occurrence found while scanning a JSON structure. */
export interface TokenRefOccurrence {
  category: TokenCategory;
  name: string;
  /** Property path from the scanned root, e.g. `['style', 'fill']`. */
  path: readonly (string | number)[];
}
