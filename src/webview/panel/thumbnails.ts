/**
 * Preview images of frames (slides, component masters) for the side panels and presentation mode.
 * Drawn with the shared SVG renderer, so a preview matches the canvas and exports, and shown as an
 * `<img>` data URI (allowed by the webview CSP; ids inside each SVG stay isolated).
 *
 * Rendering is cached per frame: a frame is re-rendered only when an element it shows (or the theme
 * palette, assets or tokens) changes. Elements are immutable snapshots, so identity comparison is enough.
 */
import { renderFrameSvg } from '../../core/export/slides';
import { inFrame } from '../../core/export/scope';
import type { BoardDocument, Element } from '../../core/model/types';
import type { ThemePalette } from '../../core/theme';

type Doc = Pick<BoardDocument, 'assets' | 'elements' | 'tokens'> & Partial<Pick<BoardDocument, 'settings'>>;

interface Entry {
  shown: readonly Element[];
  palette: ThemePalette;
  assets: Doc['assets'];
  tokens: Doc['tokens'];
  background: 'transparent' | 'theme';
  uri: string | undefined;
}

const cache = new Map<string, Entry>();
/** Upper bound on cached previews; the oldest are dropped first. */
const CACHE_MAX = 400;

const same = (a: readonly Element[], b: readonly Element[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Data URI of `frame` cut to its box, or undefined when nothing renders. `background: 'theme'`
 * paints the canvas color behind the slide (presentation); `transparent` lets the panel show through.
 */
export function frameImage(doc: Doc, frame: Element, palette: ThemePalette, background: 'transparent' | 'theme' = 'transparent'): string | undefined {
  const key = `${background}:${frame.id}`;
  const shown = inFrame(doc.elements, frame);
  const hit = cache.get(key);
  if (hit && hit.palette === palette && hit.assets === doc.assets && hit.tokens === doc.tokens && same(hit.shown, shown)) return hit.uri;
  let uri: string | undefined;
  try {
    const r = renderFrameSvg(doc, frame, { background, matchTheme: true, palette });
    uri = r.ok ? svgDataUri(r.value.svg) : undefined;
  } catch {
    uri = undefined; // a malformed element must not break the panel; it just has no preview
  }
  cache.delete(key);
  cache.set(key, { shown, palette, assets: doc.assets, tokens: doc.tokens, background, uri });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return uri;
}
