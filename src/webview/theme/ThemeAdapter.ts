/**
 * Webview Theme_Adapter: reads `--vscode-*` variables, publishes `--ob-*` custom properties and
 * notifies subscribers on theme changes without reloading or touching document state
 * (Req 4.1, 4.2, 4.3, 4.6, 4.7, 4.9).
 */
import { defaultTextColor, remapTextColor, resolvePalette, type ThemePalette } from '../../core/theme';
import {
  DEFAULT_UI_FONT_FAMILY,
  frameScheduler,
  createBatcher,
  paletteToCssVariables,
  resolveFonts,
  sameVariables,
  themeKindFromBodyClasses,
  type ThemeFonts,
} from './themeCss';

export type ThemeListener = (palette: ThemePalette) => void;

export class ThemeAdapter {
  private palette: ThemePalette;
  private fonts: ThemeFonts;
  private vars: Record<string, string> = {};
  private readonly listeners = new Set<ThemeListener>();
  private observer: MutationObserver | undefined;
  private readonly batcher;

  constructor(private readonly doc: Document = document) {
    const win = doc.defaultView ?? window;
    this.batcher = createBatcher(
      frameScheduler(
        typeof win.requestAnimationFrame === 'function' ? (cb) => win.requestAnimationFrame(() => cb()) : undefined,
        typeof win.cancelAnimationFrame === 'function' ? (id) => win.cancelAnimationFrame(id) : undefined,
        (cb, ms) => win.setTimeout(cb, ms),
        (id) => win.clearTimeout(id as number),
      ),
      () => this.refresh(),
    );
    const { palette, fonts } = this.compute();
    this.palette = palette;
    this.fonts = fonts;
    this.apply();
  }

  private readVar = (name: string): string => {
    const el = this.doc.body ?? this.doc.documentElement;
    const view = this.doc.defaultView;
    if (!view) return '';
    return view.getComputedStyle(el).getPropertyValue(name).trim();
  };

  private compute(): { palette: ThemePalette; fonts: ThemeFonts } {
    const kind = themeKindFromBodyClasses(this.doc.body?.classList ?? []);
    return { palette: resolvePalette(kind, this.readVar), fonts: resolveFonts(this.readVar) };
  }

  private apply(): void {
    const next = paletteToCssVariables(this.palette, this.fonts);
    const style = this.doc.documentElement.style;
    for (const [k, v] of Object.entries(next)) style.setProperty(k, v);
    this.vars = next;
  }

  /** Recomputes the palette; notifies subscribers only when something changed. */
  refresh(): void {
    const { palette, fonts } = this.compute();
    const next = paletteToCssVariables(palette, fonts);
    if (sameVariables(next, this.vars)) return;
    this.palette = palette;
    this.fonts = fonts;
    this.apply();
    for (const l of [...this.listeners]) l(palette);
  }

  getPalette(): ThemePalette {
    return this.palette;
  }

  /** Font family for new text elements: the IDE editor font (Req 4.7). */
  getDefaultFontFamily(): string {
    return this.fonts.fontFamily || DEFAULT_UI_FONT_FAMILY;
  }

  /** Default text color for new Text_Bearing_Elements in the current theme (Req 7.9). */
  getDefaultTextColor(): string {
    return defaultTextColor(this.palette);
  }

  /**
   * Resolves a `textColor` for the current theme: "theme default" tracks the theme, explicit colors stay
   * unchanged (Req 7.10). Subscribers are notified on the same frame as the theme change.
   */
  resolveTextColor(textColor: string | undefined): string {
    return remapTextColor(textColor, this.palette);
  }

  getFonts(): ThemeFonts {
    return this.fonts;
  }

  subscribe(listener: ThemeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts observing body class/style and documentElement class/style changes. */
  start(): void {
    if (this.observer) return;
    const Observer = this.doc.defaultView?.MutationObserver;
    if (!Observer) return;
    this.observer = new Observer(() => this.batcher.trigger());
    const opts = { attributes: true, attributeFilter: ['class', 'style'] };
    this.observer.observe(this.doc.documentElement, opts);
    if (this.doc.body) this.observer.observe(this.doc.body, opts);
    this.refresh();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.batcher.cancel();
  }
}

let shared: ThemeAdapter | undefined;

/** Lazily created, started shared adapter for the webview document. */
export function getThemeAdapter(): ThemeAdapter {
  if (!shared) {
    shared = new ThemeAdapter();
    shared.start();
  }
  return shared;
}

/** Default text color for new Text_Bearing_Elements (Req 7.9). */
export function getDefaultTextColor(): string {
  return getThemeAdapter().getDefaultTextColor();
}

/** Default font family for new text elements (Req 4.7). */
export function getDefaultFontFamily(): string {
  return getThemeAdapter().getDefaultFontFamily();
}
