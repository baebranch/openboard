import { ICON_KEYWORDS, ICON_PATHS } from './icon-set';

export { ICON_COUNT, ICON_KEYWORDS, ICON_PATHS, PLACEHOLDER_ICON_PATH } from './icon-set';

/** Maximum number of names `searchIcons` returns (Req 23.10). */
export const ICON_SEARCH_LIMIT = 50;

/** Every icon name in the Icon_Set, sorted alphabetically. */
export const ICON_NAMES: readonly string[] = Object.keys(ICON_PATHS).sort();

/** True when `name` is an icon of the embedded Icon_Set. */
export function isKnownIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
}

/**
 * Names of the Icon_Set icons whose name or one of its keywords contains `keyword`, ignoring
 * letter case, ordered alphabetically by name, at most `ICON_SEARCH_LIMIT` results. An empty
 * keyword matches nothing. Pure and deterministic; input length limits are the caller's
 * concern (the Tool_Registry validates 1 to 64 characters).
 */
export function searchIcons(keyword: string): string[] {
  const needle = keyword.toLowerCase();
  if (needle.length === 0) return [];
  const out: string[] = [];
  for (const name of ICON_NAMES) {
    const hit =
      name.toLowerCase().includes(needle) ||
      (ICON_KEYWORDS[name] ?? []).some((k) => k.toLowerCase().includes(needle));
    if (hit) {
      out.push(name);
      if (out.length === ICON_SEARCH_LIMIT) break;
    }
  }
  return out;
}
