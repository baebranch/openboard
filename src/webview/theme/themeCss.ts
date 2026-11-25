/**
 * Pure helpers for the webview Theme_Adapter: palette -> `--ob-*` CSS variables,
 * body-class kind detection and a frame/timeout batching scheduler (Req 4.1, 4.2, 4.3, 4.6, 4.7, 4.9).
 */
import { themeKindFromClasses, type ThemeKind, type ThemePalette } from '../../core/theme';

export const DEFAULT_UI_FONT_FAMILY = 'monospace';
export const DEFAULT_UI_FONT_SIZE = '13px';

/** Maximum delay between a theme change and the UI update (Req 4.2). */
export const THEME_UPDATE_BUDGET_MS = 500;

export interface ThemeFonts {
  fontFamily: string;
  fontSize: string;
}

export function isHighContrast(kind: ThemeKind): boolean {
  return kind === 'high-contrast' || kind === 'high-contrast-light';
}

/** Derives the theme kind from the body class list (Req 4.1). */
export function themeKindFromBodyClasses(classes: Iterable<string>): ThemeKind {
  return themeKindFromClasses(classes);
}

/** Uses the value when non-blank, else the fallback. */
export function fontOrDefault(value: string | null | undefined, fallback: string): string {
  const v = typeof value === 'string' ? value.trim() : '';
  return v === '' ? fallback : v;
}

/** Reads IDE editor font settings via a variable reader, with built-in fallbacks. */
export function resolveFonts(read: (name: string) => string | null | undefined): ThemeFonts {
  let family: string | null | undefined;
  let size: string | null | undefined;
  try {
    family = read('--vscode-editor-font-family');
    size = read('--vscode-editor-font-size');
  } catch {
    family = undefined;
    size = undefined;
  }
  return {
    fontFamily: fontOrDefault(family, DEFAULT_UI_FONT_FAMILY),
    fontSize: fontOrDefault(size, DEFAULT_UI_FONT_SIZE),
  };
}

/**
 * Maps a palette and fonts to the `--ob-*` custom properties consumed by the webview CSS.
 * In high-contrast themes every control border uses the contrast border color and
 * controls keep their foreground color (Req 4.3).
 */
export function paletteToCssVariables(palette: ThemePalette, fonts: ThemeFonts): Record<string, string> {
  const hc = isHighContrast(palette.kind);
  const dark = palette.kind === 'dark' || palette.kind === 'high-contrast';
  return {
    '--ob-bg': palette.background,
    '--ob-fg': palette.foreground,
    '--ob-panel-bg': palette.panelBackground,
    '--ob-panel-fg': palette.panelForeground,
    '--ob-border': palette.border,
    '--ob-contrast-border': palette.contrastBorder,
    '--ob-ui-border': hc ? palette.contrastBorder : palette.border,
    '--ob-ui-border-width': '1px',
    '--ob-button-bg': palette.buttonBackground,
    '--ob-button-fg': palette.buttonForeground,
    '--ob-input-bg': palette.inputBackground,
    '--ob-input-fg': palette.inputForeground,
    '--ob-menu-bg': palette.panelBackground,
    '--ob-menu-fg': palette.panelForeground,
    '--ob-toolbar-bg': palette.panelBackground,
    '--ob-toolbar-fg': palette.panelForeground,
    // Dropdown / list colors come straight from the IDE variables, with per-kind fallbacks.
    '--ob-list-hover-bg': `var(--vscode-list-hoverBackground, ${dark ? '#2a2d2e' : '#e8e8e8'})`,
    '--ob-list-active-bg': `var(--vscode-list-activeSelectionBackground, ${dark ? '#04395e' : '#0060c0'})`,
    '--ob-list-active-fg': `var(--vscode-list-activeSelectionForeground, #ffffff)`,
    '--ob-dropdown-bg': `var(--vscode-dropdown-background, ${palette.inputBackground})`,
    '--ob-dropdown-fg': `var(--vscode-dropdown-foreground, ${palette.inputForeground})`,
    '--ob-dropdown-border': `var(--vscode-dropdown-border, ${hc ? palette.contrastBorder : palette.border})`,
    '--ob-shadow': hc ? 'none' : `0 2px 8px var(--vscode-widget-shadow, ${dark ? 'rgba(0, 0, 0, 0.36)' : 'rgba(0, 0, 0, 0.16)'})`,
    '--ob-color-scheme': dark ? 'dark' : 'light',
    '--ob-focus': palette.focusBorder,
    '--ob-accent': palette.accent,
    '--ob-default-stroke': palette.defaultStroke,
    '--ob-default-text': palette.defaultText,
    '--ob-font-family': fonts.fontFamily,
    '--ob-font-size': fonts.fontSize,
    '--ob-hc': hc ? '1' : '0',
  };
}

export function sameVariables(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

export interface Scheduler {
  /** Schedules `fn` for the next frame/timeout; returns a cancel function. */
  (fn: () => void): () => void;
}

/**
 * Scheduler that runs on the next animation frame, but never later than
 * `maxDelayMs` (frames are throttled in hidden webviews).
 */
export function frameScheduler(
  raf: ((cb: () => void) => number) | undefined,
  caf: ((id: number) => void) | undefined,
  setT: (cb: () => void, ms: number) => unknown,
  clearT: (id: unknown) => void,
  maxDelayMs: number = THEME_UPDATE_BUDGET_MS / 5,
): Scheduler {
  return (fn) => {
    let done = false;
    let rafId: number | undefined;
    const run = (): void => {
      if (done) return;
      done = true;
      if (rafId !== undefined && caf) caf(rafId);
      clearT(timer);
      fn();
    };
    const timer = setT(run, maxDelayMs);
    if (raf) rafId = raf(run);
    return () => {
      if (done) return;
      done = true;
      if (rafId !== undefined && caf) caf(rafId);
      clearT(timer);
    };
  };
}

/** Coalesces repeated triggers into one scheduled call. */
export function createBatcher(schedule: Scheduler, fn: () => void): { trigger(): void; cancel(): void } {
  let cancel: (() => void) | undefined;
  return {
    trigger() {
      if (cancel) return;
      cancel = schedule(() => {
        cancel = undefined;
        fn();
      });
    },
    cancel() {
      cancel?.();
      cancel = undefined;
    },
  };
}
