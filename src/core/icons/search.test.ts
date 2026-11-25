import { describe, expect, it } from 'vitest';
import { ICON_KEYWORDS, ICON_NAMES, ICON_SEARCH_LIMIT, searchIcons } from './index';

// Requirements 23.7, 23.10
describe('searchIcons', () => {
  it('matches by icon name', () => {
    const r = searchIcons('arrow-up');
    expect(r).toContain('arrow-up');
    expect(r).toContain('arrow-up-right');
    for (const n of r) expect(n.includes('arrow-up') || ICON_KEYWORDS[n]!.some((k) => k.includes('arrow-up'))).toBe(true);
  });

  it('matches by keyword that is not part of the name', () => {
    expect(ICON_NAMES).not.toContain('hamburger');
    expect(searchIcons('hamburger')).toEqual(['menu']);
  });

  it('is case-insensitive', () => {
    expect(searchIcons('CHECK')).toEqual(searchIcons('check'));
    expect(searchIcons('HamBurger')).toEqual(['menu']);
    expect(searchIcons('check').length).toBeGreaterThan(0);
  });

  it('returns results in alphabetical order', () => {
    const r = searchIcons('a');
    expect(r).toEqual([...r].sort());
  });

  it('caps results at 50 and keeps the alphabetically first matches', () => {
    expect(ICON_SEARCH_LIMIT).toBe(50);
    const r = searchIcons('e');
    expect(r).toHaveLength(50);
    expect(r).toEqual(ICON_NAMES.filter((n) => searchIcons('e').includes(n)));
    expect(r[0]).toBe([...r].sort()[0]);
  });

  it('returns an empty list for an empty keyword', () => {
    expect(searchIcons('')).toEqual([]);
  });

  it('returns an empty list for an unknown keyword', () => {
    expect(searchIcons('zzzz-not-an-icon')).toEqual([]);
  });
});
