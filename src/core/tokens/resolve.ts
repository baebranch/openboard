import type { ActiveMode, ColorTokenValue, ResolvedTokens, TokenCategory, TokenCollection, TokenMode } from './types';
import { isTokenReference, tokenRefName } from './validate';

function toMap<T>(rec: Record<string, T> | undefined): Map<string, T> {
  const m = new Map<string, T>();
  if (!rec) return m;
  for (const k of Object.keys(rec)) m.set(k, rec[k] as T);
  return m;
}

/** The literal a color Token shows in `mode`; a single literal shows in every mode (Req 12.4). */
export function colorForMode(value: ColorTokenValue, mode: TokenMode): string {
  return typeof value === 'string' ? value : value[mode];
}

/**
 * Resolves the mode to render in (Req 12.2, 12.7): an explicit `light` or `dark` wins; `auto` (or no
 * stored mode) follows the IDE theme kind, where dark and high-contrast are dark and the rest light.
 */
export function resolveMode(active: ActiveMode | undefined, themeKind?: string): TokenMode {
  if (active === 'light' || active === 'dark') return active;
  return themeKind === 'dark' || themeKind === 'high-contrast' ? 'dark' : 'light';
}

/** Flattens a token collection to lookup maps for one mode. Safe on undefined. */
export function resolveTokens(tokens: TokenCollection | undefined, mode: TokenMode = 'light'): ResolvedTokens {
  const colors = new Map<string, string>();
  for (const [k, v] of Object.entries(tokens?.colors ?? {})) colors.set(k, colorForMode(v, mode));
  return { colors, fonts: toMap(tokens?.fonts), numbers: toMap(tokens?.numbers) };
}

/**
 * Resolves a field value: a Token_Reference becomes the token's literal, or
 * undefined if the token is missing; any other value is returned unchanged.
 */
export function resolveTokenValue(
  resolved: ResolvedTokens,
  category: TokenCategory,
  value: string,
): string | undefined {
  if (!isTokenReference(value)) return value;
  const name = tokenRefName(value) as string;
  const v = resolved[category].get(name);
  return v === undefined ? undefined : String(v);
}
