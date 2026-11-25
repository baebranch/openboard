/**
 * Theme palette resolution (pure; no DOM or vscode imports).
 * Requirements 4.1, 4.4, 4.5, 4.9.
 */

export type ThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';

export const THEME_KINDS: readonly ThemeKind[] = ['light', 'dark', 'high-contrast', 'high-contrast-light'];

/** Sentinel stored in documents for "use the theme default" colors. */
export const THEME_DEFAULT_COLOR = 'theme:default';

/** Minimum contrast ratio for default stroke and text colors (Req 4.4). */
export const MIN_CONTRAST_RATIO = 4.5;

export interface ThemePalette {
  kind: ThemeKind;
  /** Canvas background. */
  background: string;
  foreground: string;
  panelBackground: string;
  panelForeground: string;
  border: string;
  /** High-contrast border color; equals `border` in non-high-contrast themes. */
  contrastBorder: string;
  buttonBackground: string;
  buttonForeground: string;
  inputBackground: string;
  inputForeground: string;
  focusBorder: string;
  accent: string;
  /** Default element stroke color; always >= 4.5:1 against `background`. */
  defaultStroke: string;
  /** Default text color; always >= 4.5:1 against `background`. */
  defaultText: string;
}

type PaletteColorKey = Exclude<keyof ThemePalette, 'kind' | 'defaultStroke' | 'defaultText'>;

/** Maps each palette key to the VS Code CSS variable it is read from (Req 4.1). */
export const THEME_CSS_VARIABLES: Readonly<Record<PaletteColorKey, string>> = {
  background: '--vscode-editor-background',
  foreground: '--vscode-editor-foreground',
  panelBackground: '--vscode-sideBar-background',
  panelForeground: '--vscode-sideBar-foreground',
  border: '--vscode-panel-border',
  contrastBorder: '--vscode-contrastBorder',
  buttonBackground: '--vscode-button-background',
  buttonForeground: '--vscode-button-foreground',
  inputBackground: '--vscode-input-background',
  inputForeground: '--vscode-input-foreground',
  focusBorder: '--vscode-focusBorder',
  accent: '--vscode-textLink-foreground',
};

const PALETTE_COLOR_KEYS = Object.keys(THEME_CSS_VARIABLES) as PaletteColorKey[];

/** Built-in fallback colors per theme kind (Req 4.9). All are `#rrggbb`. */
export const BUILTIN_PALETTES: Readonly<Record<ThemeKind, Readonly<Record<PaletteColorKey, string>>>> = {
  light: {
    background: '#ffffff',
    foreground: '#333333',
    panelBackground: '#f3f3f3',
    panelForeground: '#616161',
    border: '#c8c8c8',
    contrastBorder: '#c8c8c8',
    buttonBackground: '#007acc',
    buttonForeground: '#ffffff',
    inputBackground: '#ffffff',
    inputForeground: '#616161',
    focusBorder: '#0090f1',
    accent: '#006ab1',
  },
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    panelBackground: '#252526',
    panelForeground: '#cccccc',
    border: '#80808059',
    contrastBorder: '#80808059',
    buttonBackground: '#0e639c',
    buttonForeground: '#ffffff',
    inputBackground: '#3c3c3c',
    inputForeground: '#cccccc',
    focusBorder: '#007fd4',
    accent: '#3794ff',
  },
  'high-contrast': {
    background: '#000000',
    foreground: '#ffffff',
    panelBackground: '#000000',
    panelForeground: '#ffffff',
    border: '#6fc3df',
    contrastBorder: '#6fc3df',
    buttonBackground: '#000000',
    buttonForeground: '#ffffff',
    inputBackground: '#000000',
    inputForeground: '#ffffff',
    focusBorder: '#f38518',
    accent: '#3794ff',
  },
  'high-contrast-light': {
    background: '#ffffff',
    foreground: '#292929',
    panelBackground: '#ffffff',
    panelForeground: '#292929',
    border: '#0f4a85',
    contrastBorder: '#0f4a85',
    buttonBackground: '#ffffff',
    buttonForeground: '#292929',
    inputBackground: '#ffffff',
    inputForeground: '#292929',
    focusBorder: '#006bbd',
    accent: '#0f4a85',
  },
};

export interface Rgba {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

const clampByte = (n: number): number => Math.min(255, Math.max(0, n));

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Returns undefined if invalid. */
export function parseColor(input: string | null | undefined): Rgba | undefined {
  if (typeof input !== 'string') return undefined;
  const s = input.trim().toLowerCase();
  if (s === '') return undefined;

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1] as string;
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a,
    };
  }

  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (fn) {
    const parts = (fn[1] as string).split(/[\s,/]+/).filter((p) => p !== '');
    if (parts.length < 3 || parts.length > 4) return undefined;
    const nums: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as string;
      const pct = p.endsWith('%');
      const v = Number(pct ? p.slice(0, -1) : p);
      if (!Number.isFinite(v)) return undefined;
      if (i === 3) nums.push(pct ? v / 100 : v);
      else nums.push(pct ? (v / 100) * 255 : v);
    }
    return {
      r: Math.round(clampByte(nums[0] as number)),
      g: Math.round(clampByte(nums[1] as number)),
      b: Math.round(clampByte(nums[2] as number)),
      a: Math.min(1, Math.max(0, nums[3] ?? 1)),
    };
  }
  return undefined;
}

const toHexByte = (n: number): string => Math.round(clampByte(n)).toString(16).padStart(2, '0');

/** Formats as `#rrggbb`, or `#rrggbbaa` if not fully opaque. */
export function formatHex(c: Rgba): string {
  const base = `#${toHexByte(c.r)}${toHexByte(c.g)}${toHexByte(c.b)}`;
  return c.a >= 1 ? base : base + toHexByte(c.a * 255);
}

/** WCAG relative luminance. */
export function relativeLuminance(c: Rgba): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Composites `fg` over an opaque `bg`. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/**
 * WCAG contrast ratio between two colors (1..21). Translucent foregrounds are
 * composited over the background; a translucent background over white.
 * Returns NaN if either color cannot be parsed.
 */
export function contrastRatio(fg: string, bg: string): number {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return NaN;
  const bgOpaque = over(b, { r: 255, g: 255, b: 255, a: 1 });
  const fgOpaque = over(f, bgOpaque);
  const l1 = relativeLuminance(fgOpaque);
  const l2 = relativeLuminance(bgOpaque);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Picks a color that meets `minRatio` (default 4.5:1) against `background`.
 * Candidates are tried in order; if none qualifies, black or white is chosen,
 * whichever has the higher contrast (which always reaches >= 4.5:1).
 * An unparseable background is treated as white.
 */
export function pickContrastColor(
  background: string,
  candidates: readonly string[] = [],
  minRatio: number = MIN_CONTRAST_RATIO,
): string {
  const bg = parseColor(background) ? background : '#ffffff';
  for (const c of candidates) {
    const r = contrastRatio(c, bg);
    if (parseColor(c) && r >= minRatio) return c;
  }
  return contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg) ? '#000000' : '#ffffff';
}

/** Returns the trimmed value when it is a usable color, else undefined. */
function usable(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return parseColor(v) ? v : undefined;
}

/** Looks up a CSS variable value by name; empty/undefined means "not set". */
export type CssVariableReader = (name: string) => string | null | undefined;

/** Maps a `kind` string to a ThemeKind; unknown values fall back to `dark`. */
export function normalizeThemeKind(kind: string | null | undefined): ThemeKind {
  return (THEME_KINDS as readonly string[]).includes(kind ?? '') ? (kind as ThemeKind) : 'dark';
}

/** Derives the theme kind from `body` class names (Design: Theme_Adapter). */
export function themeKindFromClasses(classes: Iterable<string>): ThemeKind {
  const set = new Set(classes);
  if (set.has('vscode-high-contrast-light')) return 'high-contrast-light';
  if (set.has('vscode-high-contrast')) return 'high-contrast';
  if (set.has('vscode-light')) return 'light';
  return 'dark';
}

/**
 * Builds a ThemePalette from CSS variables. Any variable that is undefined,
 * empty, or unparseable is replaced by the built-in color for `kind` (Req 4.9).
 * Default stroke and text always reach 4.5:1 against the background (Req 4.4).
 * Never throws.
 */
export function resolvePalette(kind: ThemeKind, read: CssVariableReader = () => undefined): ThemePalette {
  const fallback = BUILTIN_PALETTES[normalizeThemeKind(kind)];
  const k = normalizeThemeKind(kind);
  const colors = {} as Record<PaletteColorKey, string>;
  for (const key of PALETTE_COLOR_KEYS) {
    let raw: string | null | undefined;
    try {
      raw = read(THEME_CSS_VARIABLES[key]);
    } catch {
      raw = undefined;
    }
    colors[key] = usable(raw) ?? fallback[key];
  }
  // A translucent canvas background would make contrast ill-defined; use the built-in.
  const bgParsed = parseColor(colors.background);
  if (!bgParsed || bgParsed.a < 1) colors.background = fallback.background;

  const defaultText = pickContrastColor(colors.background, [colors.foreground, fallback.foreground]);
  const defaultStroke = pickContrastColor(colors.background, [colors.foreground, fallback.foreground]);
  return { kind: k, ...colors, defaultStroke, defaultText };
}

/** Convenience: palette made entirely of built-in colors for a kind. */
export function builtinPalette(kind: ThemeKind): ThemePalette {
  return resolvePalette(kind);
}

/** Default text color for new Text_Bearing_Elements: >= 4.5:1 against the canvas in every theme kind (Req 7.9). */
export function defaultTextColor(palette: ThemePalette): string {
  return palette.defaultText;
}

/**
 * Remaps a `textColor` after a theme kind change (Req 7.10). The "theme default" value
 * (`theme:default`, or absent) maps to the new theme's default text color; an explicit color is
 * returned unchanged.
 */
export function remapTextColor(textColor: string | undefined, next: ThemePalette): string {
  if (textColor === undefined || textColor === THEME_DEFAULT_COLOR) return next.defaultText;
  return textColor;
}

export type ColorRole = 'stroke' | 'text';

/**
 * Resolves an element color at render time. `theme:default` maps to the
 * palette default for the role; explicit colors are returned unchanged, so the
 * document is never mutated by a theme change (Req 4.5).
 */
export function resolveElementColor(color: string, palette: ThemePalette, role: ColorRole = 'stroke'): string {
  if (color === THEME_DEFAULT_COLOR) return role === 'text' ? palette.defaultText : palette.defaultStroke;
  return color;
}
