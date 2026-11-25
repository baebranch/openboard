import { describe, expect, it } from 'vitest';
import {
  ICON_COUNT,
  ICON_KEYWORDS,
  ICON_NAMES,
  ICON_PATHS,
  ICON_SEARCH_LIMIT,
  PLACEHOLDER_ICON_PATH,
  isKnownIcon,
  searchIcons,
} from './index';

// Requirements 23.2, 23.10
describe('generated Icon_Set', () => {
  it('embeds at least 100 icons with non-empty absolute path data', () => {
    expect(ICON_COUNT).toBeGreaterThanOrEqual(100);
    expect(ICON_NAMES).toHaveLength(ICON_COUNT);
    for (const name of ICON_NAMES) {
      const d = ICON_PATHS[name];
      // Every icon starts with an absolute moveto so it is safe to draw as one <path>.
      expect(d, name).toMatch(/^M/);
      expect(d, name).not.toMatch(/[^MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]/);
    }
    expect(PLACEHOLDER_ICON_PATH).toMatch(/^M/);
  });

  it('has keywords for exactly the icon names, in lower case', () => {
    expect(Object.keys(ICON_KEYWORDS).sort()).toEqual([...ICON_NAMES]);
    for (const kws of Object.values(ICON_KEYWORDS)) {
      for (const k of kws) expect(k).toBe(k.toLowerCase());
    }
  });

  it('lists names in alphabetical order and recognizes known names', () => {
    expect([...ICON_NAMES]).toEqual([...ICON_NAMES].sort());
    expect(isKnownIcon('check')).toBe(true);
    expect(isKnownIcon('no-such-icon')).toBe(false);
    expect(isKnownIcon('constructor')).toBe(false);
  });
});

describe('searchIcons', () => {
  it('matches by name or keyword, ignoring case, alphabetically, capped at 50', () => {
    expect(searchIcons('CHECK')).toContain('check');
    // `hamburger` is a Lucide keyword of `menu`, not part of its name.
    expect(searchIcons('Hamburger')).toEqual(['menu']);
    const all = searchIcons('e');
    expect(all.length).toBe(ICON_SEARCH_LIMIT);
    expect(all).toEqual([...all].sort());
  });

  it('returns an empty list when nothing matches or the keyword is empty', () => {
    expect(searchIcons('zzzz-not-an-icon')).toEqual([]);
    expect(searchIcons('')).toEqual([]);
  });
});
