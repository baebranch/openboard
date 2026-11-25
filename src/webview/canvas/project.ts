/**
 * Pure projection of a board document into ReactFlow nodes/edges (Req 3.1, 17.2).
 * Elements are culled to the viewport plus a 256 px margin; edge endpoints of visible edges are
 * always kept so ReactFlow can resolve them.
 */
import type { Node, Edge } from '@xyflow/react';
import { rotatedBounds, unionBounds } from '../../core/model/geometry';
import type { Asset, BoardDocument, Bounds, Element, EdgeElement, FreehandPoint, Viewport } from '../../core/model/types';
import { cullToViewport } from '../../core/selection';

export interface ScreenSize {
  width: number;
  height: number;
}

export interface ViewportBounds {
  viewport: Viewport;
  screen: ScreenSize;
}

/** Optimistic, gesture-time overrides for an element's geometry. Never written to the document. */
export type ElementPreview = Partial<Pick<Element, 'x' | 'y' | 'width' | 'height' | 'rotation'>> & { points?: FreehandPoint[] };

export interface ProjectOptions {
  selection?: ReadonlySet<string>;
  previews?: ReadonlyMap<string, ElementPreview>;
}

export interface ElementNodeData extends Record<string, unknown> {
  element: Element;
  assets: readonly Asset[];
}

export interface ElementEdgeData extends Record<string, unknown> {
  element: EdgeElement;
  /** The edge's endpoint elements (for routing). */
  endpoints: readonly Element[];
}

export type ObNode = Node<ElementNodeData, 'ob'>;
export type ObEdge = Edge<ElementEdgeData, 'ob'>;

export interface ReactFlowProjection {
  nodes: ObNode[];
  edges: ObEdge[];
}

const NO_ASSETS: readonly Asset[] = [];

function withPreview(el: Element, previews: ProjectOptions['previews']): Element {
  const p = previews?.get(el.id);
  return p ? ({ ...el, ...p } as Element) : el;
}

/**
 * Project the document. When `view` is given, only elements intersecting the viewport expanded by
 * the culling margin are projected (edges are kept when their endpoints' union is visible).
 */
export function toReactFlow(doc: Pick<BoardDocument, 'elements' | 'assets'>, view?: ViewportBounds, options: ProjectOptions = {}): ReactFlowProjection {
  const selection = options.selection ?? new Set<string>();
  const previews = options.previews;
  const byId = new Map<string, Element>();
  for (const e of doc.elements) byId.set(e.id, withPreview(e, previews));

  interface Entry {
    el: Element;
    x: number;
    y: number;
    width: number;
    height: number;
  }
  const entry = (el: Element, b: Bounds): Entry => ({ el, ...b });

  const nodeEntries: Entry[] = [];
  const edgeEntries: Entry[] = [];
  for (const el of byId.values()) {
    if (el.type === 'edge') {
      const a = byId.get(el.sourceId);
      const b = byId.get(el.targetId);
      if (!a || !b || a.type === 'edge' || b.type === 'edge') continue; // dangling edge: not drawn
      const u = unionBounds([rotatedBounds(a), rotatedBounds(b)]);
      if (u) edgeEntries.push(entry(el, u));
    } else {
      nodeEntries.push(entry(el, rotatedBounds(el)));
    }
  }

  const visibleNodes = view ? cullToViewport(nodeEntries, view.viewport, view.screen) : nodeEntries;
  const visibleEdges = view ? cullToViewport(edgeEntries, view.viewport, view.screen) : edgeEntries;

  const nodeIds = new Set(visibleNodes.map((n) => n.el.id));
  const needed = new Set<string>();
  for (const e of visibleEdges) {
    const edge = e.el as EdgeElement;
    for (const id of [edge.sourceId, edge.targetId]) if (!nodeIds.has(id)) needed.add(id);
  }

  // Keep document (z) order: walk the document and keep visible or required elements.
  const nodes: ObNode[] = [];
  for (const src of doc.elements) {
    if (src.type === 'edge') continue;
    if (!nodeIds.has(src.id) && !needed.has(src.id)) continue;
    const el = byId.get(src.id)!;
    nodes.push({
      id: el.id,
      type: 'ob',
      position: { x: el.x, y: el.y },
      width: el.width,
      height: el.height,
      draggable: !el.locked,
      selectable: !el.locked,
      selected: selection.has(el.id),
      data: { element: el, assets: el.type === 'image' ? doc.assets : NO_ASSETS },
    });
  }

  const edgeIds = new Set(visibleEdges.map((e) => e.el.id));
  const edges: ObEdge[] = [];
  for (const src of doc.elements) {
    if (src.type !== 'edge' || !edgeIds.has(src.id)) continue;
    const el = byId.get(src.id) as EdgeElement;
    const a = byId.get(el.sourceId)!;
    const b = byId.get(el.targetId)!;
    edges.push({
      id: el.id,
      type: 'ob',
      source: el.sourceId,
      target: el.targetId,
      selected: selection.has(el.id),
      focusable: false,
      data: { element: el, endpoints: a === b ? [a] : [a, b] },
    });
  }
  return { nodes, edges };
}
