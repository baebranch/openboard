/**
 * Custom ReactFlow node/edge renderers. Both draw through the shared pure SVG renderer
 * (`renderElementToSvg`) so the canvas matches exported output (Req 12.3, 4.8).
 */
import { Handle, Position, useViewport, type EdgeProps, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { renderContextKey, usedTokenValues, type RenderKeyContext } from '../../core/export/render-key';
import { resolveMode } from '../../core/tokens/resolve';
import type { ActiveMode, TokenCollection } from '../../core/tokens/types';
import { renderElementToSvg } from '../../core/export/svg';
import type { Asset, Element } from '../../core/model/types';
import { builtinPalette, type ThemePalette } from '../../core/theme';
import { getThemeAdapter } from '../theme/ThemeAdapter';
import { useThemePalette } from '../theme/useThemePalette';
import type { ObEdge, ObNode } from './project';

/** Current theme palette from the Theme_Adapter (built-in dark outside a DOM). */
export function currentPalette(): ThemePalette {
  return typeof document === 'undefined' ? builtinPalette('dark') : getThemeAdapter().getPalette();
}

interface CacheEntry {
  palette: ThemePalette;
  assets: readonly Asset[];
  endpoints: readonly Element[] | undefined;
  key: string;
  svg: string;
}

const cache = new WeakMap<Element, CacheEntry>();

/** SVG fragment for one element, cached per element object (elements are immutable snapshots). */
export function svgFor(
  el: Element,
  assets: readonly Asset[],
  endpoints?: readonly Element[],
  palette: ThemePalette = currentPalette(),
  keyCtx: RenderKeyContext = {},
  tokens?: TokenCollection,
  activeMode?: ActiveMode,
): string {
  // `auto` follows the IDE theme kind, which the palette carries (Req 12.7); re-render keys on the resolved values.
  const used = keyCtx.tokens ?? usedTokenValues(el, tokens, resolveMode(activeMode, palette.kind));
  const key = renderContextKey(el, { assets, ...keyCtx, ...(used ? { tokens: used } : {}) });
  const hit = cache.get(el);
  if (hit && hit.palette === palette && hit.assets === assets && hit.key === key && sameList(hit.endpoints, endpoints)) return hit.svg;
  const svg = renderElementToSvg(el, { assets: [...assets], elements: [...(endpoints ?? [])], tokens, ...(activeMode ? { settings: { activeMode } } : {}) }, palette);
  cache.set(el, { palette, assets, endpoints, key, svg });
  return svg;
}

function sameList(a: readonly Element[] | undefined, b: readonly Element[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

const SIDES: ReadonlyArray<[string, Position]> = [
  ['t', Position.Top],
  ['r', Position.Right],
  ['b', Position.Bottom],
  ['l', Position.Left],
];

/**
 * Component_Master indicator (Req 13.5): a dashed outline and a name badge drawn as DOM next to the
 * rendered SVG, never through `renderElementToSvg`, so no export (which only uses the renderer) can
 * contain it. Both are counter-scaled by the viewport zoom so they stay visible at every zoom level.
 */
function MasterIndicator({ name }: { name: string }) {
  const zoom = useViewport().zoom || 1;
  return (
    <div className="ob-master-indicator" data-testid="master-indicator" aria-hidden="true" style={{ borderWidth: 2 / zoom }}>
      <span className="ob-master-badge" style={{ transform: `scale(${1 / zoom})` }}>
        {'\u25C7 '}
        {name}
      </span>
    </div>
  );
}

function ElementNodeImpl({ data }: NodeProps<ObNode>) {
  const { element, assets, tokens, activeMode, clipChain, backdrop } = data;
  const palette = useThemePalette();
  // The clip chain rides in the `endpoints` slot so the renderer can resolve parents and masters (Req 10.2, 24.8).
  // Backdrop shapes ride along so text stays legible on what sits behind it; the element-wise list
  // comparison in `svgFor` re-renders when one of them changes. The renderer reads the list bottom
  // first, so the (topmost-first) backdrop goes last and reversed; clipping only looks elements up by id.
  const context = backdrop
    ? [...(clipChain ?? []).filter((c) => !backdrop.includes(c)), ...[...backdrop].reverse()]
    : clipChain;
  const svg = svgFor(element, assets, context, palette, clipChain ? { clipAncestors: clipChain.map((c) => c.id) } : {}, tokens, activeMode);
  return (
    <div className="ob-node" data-element-id={element.id} data-type={element.type} style={{ width: element.width, height: element.height }}>
      <svg
        className="ob-node-svg"
        width={Math.max(element.width, 1)}
        height={Math.max(element.height, 1)}
        style={{ overflow: 'visible', position: 'absolute', left: 0, top: 0 }}
        aria-hidden="true"
      >
        <g transform={`translate(${-element.x} ${-element.y})`} dangerouslySetInnerHTML={{ __html: svg }} />
      </svg>
      {element.type === 'frame' && element.component !== undefined ? <MasterIndicator name={element.component} /> : null}
      {SIDES.map(([id, position]) => (
        <Handle key={id} id={id} type="source" position={position} className="ob-handle" />
      ))}
    </div>
  );
}

export const ElementNode = memo(ElementNodeImpl);

function ElementEdgeImpl({ data }: EdgeProps<ObEdge>) {
  const palette = useThemePalette();
  if (!data) return null;
  const svg = svgFor(data.element, [], data.endpoints, palette, {}, data.tokens, data.activeMode);
  return <g className="ob-edge" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const ElementEdge = memo(ElementEdgeImpl);
