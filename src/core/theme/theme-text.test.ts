import { describe, expect, it } from 'vitest';
import {
  THEME_DEFAULT_COLOR,
  THEME_KINDS,
  builtinPalette,
  contrastRatio,
  defaultTextColor,
  remapTextColor,
} from './theme';

describe('defaultTextColor (Req 7.9)', () => {
  for (const kind of THEME_KINDS) {
    it(`meets 4.5:1 against the canvas in ${kind}`, () => {
      const p = builtinPalette(kind);
      expect(contrastRatio(defaultTextColor(p), p.background)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('remapTextColor (Req 7.10)', () => {
  const light = builtinPalette('light');
  const dark = builtinPalette('dark');

  it('maps theme:default to the new theme default text color', () => {
    expect(remapTextColor(THEME_DEFAULT_COLOR, dark)).toBe(dark.defaultText);
    expect(remapTextColor(THEME_DEFAULT_COLOR, light)).toBe(light.defaultText);
  });

  it('maps an absent value to the new theme default text color', () => {
    expect(remapTextColor(undefined, dark)).toBe(dark.defaultText);
  });

  it('leaves an explicit color unchanged', () => {
    expect(remapTextColor('#ff0000', dark)).toBe('#ff0000');
    expect(remapTextColor('#ff0000', light)).toBe('#ff0000');
  });
});
