import { parseColor } from '../theme';
import {
  MAX_FONT_VALUE_LENGTH,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKENS_PER_CATEGORY,
  TOKEN_REF_PREFIX,
  type TokenCategory,
  type TokenCheck,
  type ColorModeValues,
  type TokenCollection,
  type TokenValue,
} from './types';

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** True when the string is a Token_Reference (`token:<name>`). */
export function isTokenReference(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(TOKEN_REF_PREFIX);
}

/** Extracts the name from a Token_Reference, or undefined for any other value. */
export function tokenRefName(value: unknown): string | undefined {
  return isTokenReference(value) ? value.slice(TOKEN_REF_PREFIX.length) : undefined;
}

export function makeTokenRef(name: string): string {
  return TOKEN_REF_PREFIX + name;
}

/** Validates a token name: 1 to 64 characters from letters, digits, hyphen, underscore, period. */
export function validateTokenName(name: unknown): TokenCheck<string> {
  if (typeof name !== 'string' || name.length < 1 || name.length > MAX_TOKEN_NAME_LENGTH || !NAME_RE.test(name)) {
    return {
      ok: false,
      code: 'invalid_name',
      message: `Token name must be 1 to ${MAX_TOKEN_NAME_LENGTH} characters from letters, digits, hyphen, underscore, and period.`,
    };
  }
  return { ok: true, value: name };
}

function isColorLiteral(value: unknown): value is string {
  return typeof value === 'string' && (value === 'theme:default' || parseColor(value) !== undefined);
}

/** True for a plain object that looks like a light/dark pair (its members are validated separately). */
function isModeValue(value: unknown): value is { light: unknown; dark: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes('light') && keys.includes('dark');
}

/** True when a color Token holds one value per mode. */
export function hasModeValues(value: unknown): value is ColorModeValues {
  return isModeValue(value) && typeof value.light === 'string' && typeof value.dark === 'string';
}

/** True when at least one color Token holds a light and a dark value (token modes are in use). */
export function hasModeTokens(tokens: TokenCollection | undefined): boolean {
  return Object.values(tokens?.colors ?? {}).some(hasModeValues);
}

const REF_MESSAGE = 'A Token value must be a literal, not a Token_Reference.';

/** Validates a token value for its category. A Token_Reference is never a valid value. */
export function validateTokenValue(category: TokenCategory, value: unknown): TokenCheck<TokenValue> {
  if (isTokenReference(value)) return { ok: false, code: 'token_reference_value', message: REF_MESSAGE };
  switch (category) {
    case 'colors':
      if (isColorLiteral(value)) return { ok: true, value };
      if (isModeValue(value)) {
        if (isTokenReference(value.light) || isTokenReference(value.dark)) {
          return { ok: false, code: 'token_reference_value', message: REF_MESSAGE };
        }
        if (isColorLiteral(value.light) && isColorLiteral(value.dark)) {
          return { ok: true, value: { light: value.light, dark: value.dark } };
        }
        return {
          ok: false,
          code: 'invalid_value',
          message: 'A color Token with modes must hold a valid color literal for both light and dark.',
        };
      }
      return { ok: false, code: 'invalid_value', message: 'A color Token value must be a valid color literal.' };
    case 'fonts':
      if (typeof value === 'string' && value.length >= 1 && value.length <= MAX_FONT_VALUE_LENGTH) {
        return { ok: true, value };
      }
      return {
        ok: false,
        code: 'invalid_value',
        message: `A font Token value must be a string of 1 to ${MAX_FONT_VALUE_LENGTH} characters.`,
      };
    case 'numbers':
      if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
      return { ok: false, code: 'invalid_value', message: 'A number Token value must be a finite number.' };
  }
}

/** Checks that a new token can be added to a category (name valid, unused, under the limit). */
export function validateNewToken(
  tokens: TokenCollection | undefined,
  category: TokenCategory,
  name: unknown,
  value: unknown,
): TokenCheck<{ name: string; value: TokenValue }> {
  const n = validateTokenName(name);
  if (!n.ok) return n;
  const v = validateTokenValue(category, value);
  if (!v.ok) return v;
  const bucket = tokens?.[category] as Record<string, unknown> | undefined;
  if (bucket && Object.prototype.hasOwnProperty.call(bucket, n.value)) {
    return { ok: false, code: 'duplicate_name', message: `A ${category} Token named "${n.value}" already exists.` };
  }
  if (bucket && Object.keys(bucket).length >= MAX_TOKENS_PER_CATEGORY) {
    return {
      ok: false,
      code: 'limit_exceeded',
      message: `A category holds at most ${MAX_TOKENS_PER_CATEGORY} Tokens.`,
    };
  }
  return { ok: true, value: { name: n.value, value: v.value } };
}
