/**
 * Custom ReactFlow node/edge renderers. Both draw through the shared pure SVG renderer
 * (`renderElementToSvg`) so the canvas matches exported output (Req 12.3, 4.8).
 */
import { Handle, Position, type EdgeProps, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
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
  svg: string;
}

const cache = new WeakMap<Element, CacheEntry>();

/** SVG fragment for one element, cached per element object (elements are immutable snapshots). */
export function svgFor(el: Element, assets: readonly Asset[], endpoints?: readonly Element[], palette: ThemePalette = currentPalette()): string {
  const hit = cache.get(el);
  if (hit && hit.palette === palette && hit.assets === assets && sameList(hit.endpoints, endpoints)) return hit.svg;
  const svg = renderElementToSvg(el, { assets: [...assets], elements: [...(endpoints ?? [])] }, palette);
  cache.set(el, { palette, assets, endpoints, svg });
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

function ElementNodeImpl({ data }: NodeProps<ObNode>) {
  const { element, assets } = data;
  const palette = useThemePalette();
  const svg = svgFor(element, assets, undefined, palette);
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
  const svg = svgFor(data.element, [], data.endpoints, palette);
  return <g className="ob-edge" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const ElementEdge = memo(ElementEdgeImpl);
