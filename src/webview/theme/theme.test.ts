import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_PALETTES, resolvePalette, THEME_KINDS } from '../../core/theme';
import {
  createBatcher,
  DEFAULT_UI_FONT_FAMILY,
  frameScheduler,
  paletteToCssVariables,
  resolveFonts,
  sameVariables,
  themeKindFromBodyClasses,
} from './themeCss';

describe('themeKindFromBodyClasses', () => {
  it('detects each kind and defaults to dark', () => {
    expect(themeKindFromBodyClasses(['vscode-light'])).toBe('light');
    expect(themeKindFromBodyClasses(['vscode-dark'])).toBe('dark');
    expect(themeKindFromBodyClasses(['vscode-high-contrast'])).toBe('high-contrast');
    expect(themeKindFromBodyClasses(['vscode-high-contrast', 'vscode-high-contrast-light'])).toBe('high-contrast-light');
    expect(themeKindFromBodyClasses([])).toBe('dark');
  });
});

describe('paletteToCssVariables', () => {
  const fonts = { fontFamily: 'Fira Code', fontSize: '14px' };

  it('maps every UI color and fonts, with built-in fallbacks when variables are missing', () => {
    for (const kind of THEME_KINDS) {
      const vars = paletteToCssVariables(resolvePalette(kind, () => undefined), fonts);
      expect(vars['--ob-bg']).toBe(BUILTIN_PALETTES[kind].background);
      expect(vars['--ob-toolbar-bg']).toBeTruthy();
      expect(vars['--ob-menu-bg']).toBeTruthy();
      expect(vars['--ob-font-family']).toBe('Fira Code');
      expect(vars['--ob-font-size']).toBe('14px');
    }
  });

  it('uses the contrast border for controls in high-contrast themes only', () => {
    const hc = paletteToCssVariables(resolvePalette('high-contrast', (n) => (n === '--vscode-contrastBorder' ? '#ff00ff' : undefined)), fonts);
    expect(hc['--ob-ui-border']).toBe('#ff00ff');
    expect(hc['--ob-hc']).toBe('1');
    const dark = paletteToCssVariables(resolvePalette('dark', () => undefined), fonts);
    expect(dark['--ob-ui-border']).toBe(BUILTIN_PALETTES.dark.border);
    expect(dark['--ob-hc']).toBe('0');
  });

  it('detects changes via sameVariables', () => {
    const a = paletteToCssVariables(resolvePalette('dark'), fonts);
    expect(sameVariables(a, { ...a })).toBe(true);
    expect(sameVariables(a, { ...a, '--ob-bg': '#000001' })).toBe(false);
  });
});

describe('resolveFonts', () => {
  it('reads editor font variables and falls back when blank', () => {
    expect(resolveFonts((n) => (n.endsWith('family') ? 'Consolas' : '12px'))).toEqual({ fontFamily: 'Consolas', fontSize: '12px' });
    expect(resolveFonts(() => '  ').fontFamily).toBe(DEFAULT_UI_FONT_FAMILY);
  });
});

describe('batching', () => {
  it('coalesces triggers into one call and runs by the timeout when no frame fires', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const b = createBatcher(
        frameScheduler(undefined, undefined, (cb, ms) => setTimeout(cb, ms), (id) => clearTimeout(id as ReturnType<typeof setTimeout>)),
        fn,
      );
      b.trigger();
      b.trigger();
      b.trigger();
      vi.advanceTimersByTime(499);
      expect(fn).toHaveBeenCalledTimes(1);
      b.trigger();
      vi.advanceTimersByTime(499);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel prevents the pending call', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const b = createBatcher(
        frameScheduler(undefined, undefined, (cb, ms) => setTimeout(cb, ms), (id) => clearTimeout(id as ReturnType<typeof setTimeout>)),
        fn,
      );
      b.trigger();
      b.cancel();
      vi.advanceTimersByTime(1000);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
