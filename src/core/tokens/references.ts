import { resolveSpacing } from './number-fields';
import { resolveTokens } from './resolve';
import type { TokenCategory, TokenCollection, TokenMode, TokenRefOccurrence } from './types';
import { makeTokenRef, tokenRefName } from './validate';

/** Property keys that may hold a Token_Reference, and the category each one draws from. */
export const TOKEN_FIELD_CATEGORIES: Readonly<Record<string, TokenCategory>> = {
  fill: 'colors',
  stroke: 'colors',
  textColor: 'colors',
  fontFamily: 'fonts',
};

/**
 * Number-token fields (Req 11.15), keyed by the parent object key: `layout.gap` and the four
 * `layout.padding` sides. Scoped to their parent so unrelated `gap`/`top` keys are never read.
 */
const NUMBER_FIELDS_BY_PARENT: Readonly<Record<string, readonly string[]>> = {
  layout: ['gap'],
  padding: ['top', 'right', 'bottom', 'left'],
};

/** What a field holds when a detached Token_Reference points at a missing Token (Req 11.17). */
export const DETACH_FALLBACK = { colors: 'theme:default', fonts: 'sans-serif', numbers: 0 } as const;

type Json = unknown;
type Mapper = (category: TokenCategory, name: string) => Json | undefined;

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The token category of property `key` inside an object reached through `parentKey`. */
function fieldCategory(parentKey: string | number | undefined, key: string): TokenCategory | undefined {
  if (Object.prototype.hasOwnProperty.call(TOKEN_FIELD_CATEGORIES, key)) return TOKEN_FIELD_CATEGORIES[key];
  if (typeof parentKey === 'string' && Object.prototype.hasOwnProperty.call(NUMBER_FIELDS_BY_PARENT, parentKey)) {
    if (NUMBER_FIELDS_BY_PARENT[parentKey]!.includes(key)) return 'numbers';
  }
  return undefined;
}

/**
 * Walks a JSON structure (an element, an override map, a Library entry) and
 * rebuilds it, replacing each Token_Reference found in a token-capable field
 * with the mapper's result. A mapper result of undefined keeps the value.
 * Unchanged subtrees keep their identity.
 */
function mapRefs(value: Json, map: Mapper, parentKey?: string | number): Json {
  if (Array.isArray(value)) {
    let out: Json[] | undefined;
    value.forEach((item, i) => {
      const next = mapRefs(item, map, i);
      if (next !== item) {
        out ??= value.slice();
        out[i] = next;
      }
    });
    return out ?? value;
  }
  if (!isPlainObject(value)) return value;
  let out: Record<string, Json> | undefined;
  for (const key of Object.keys(value)) {
    const cur = value[key];
    let next: Json;
    const category = fieldCategory(parentKey, key);
    const refName = category && typeof cur === 'string' ? tokenRefName(cur) : undefined;
    if (category && refName !== undefined) {
      next = map(category, refName) ?? cur;
    } else {
      next = mapRefs(cur, map, key);
    }
    if (next !== cur) {
      out ??= { ...value };
      out[key] = next;
    }
  }
  return out ?? value;
}

/** Lists every Token_Reference inside `value`, with its category, name, and path. */
export function scanTokenReferences(value: Json): TokenRefOccurrence[] {
  const found: TokenRefOccurrence[] = [];
  const walk = (v: Json, path: (string | number)[]): void => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, [...path, i]));
      return;
    }
    if (!isPlainObject(v)) return;
    for (const key of Object.keys(v)) {
      const cur = v[key];
      const category = fieldCategory(path[path.length - 1], key);
      const name = category && typeof cur === 'string' ? tokenRefName(cur) : undefined;
      if (category && name !== undefined) found.push({ category, name, path: [...path, key] });
      else walk(cur, [...path, key]);
    }
  };
  walk(value, []);
  return found;
}

/** Counts references to one token inside `value`. */
export function countTokenReferences(value: Json, category: TokenCategory, name: string): number {
  return scanTokenReferences(value).filter((o) => o.category === category && o.name === name).length;
}

/** Rewrites every reference to `oldName` as `newName` (rename). Returns the same object when nothing changed. */
export function renameTokenReferences<T>(value: T, category: TokenCategory, oldName: string, newName: string): T {
  return mapRefs(value, (c, n) => (c === category && n === oldName ? makeTokenRef(newName) : undefined)) as T;
}

/**
 * Replaces references with literals (detach). With `only`, just that token is
 * detached; otherwise every reference is. A missing token takes `fallback`
 * for its category when provided, otherwise the reference is left in place.
 * Number Tokens detach to numbers; colors and fonts to strings.
 */
export function detachTokenReferences<T>(
  value: T,
  tokens: TokenCollection | undefined,
  options: {
    only?: { category: TokenCategory; name: string };
    fallback?: Partial<Record<TokenCategory, string | number>>;
    /** Mode whose value a two-valued color Token detaches to. Default light. */
    mode?: TokenMode;
  } = {},
): T {
  const resolved = resolveTokens(tokens, options.mode);
  return mapRefs(value, (category, name) => {
    if (options.only && (options.only.category !== category || options.only.name !== name)) return undefined;
    const lit = resolved[category].get(name);
    // Number fields are layout spacing; detaching writes the clamped value the Layout_Pass uses.
    if (lit !== undefined) return category === 'numbers' ? resolveSpacing(lit as number, undefined) : String(lit);
    return options.fallback?.[category];
  }) as T;
}
