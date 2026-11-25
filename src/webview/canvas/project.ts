/**
 * Pure projection of a board document into ReactFlow nodes/edges (Req 3.1, 17.2).
 * Elements are culled to the viewport plus a 256 px margin; edge endpoints of visible edges are
 * always kept so ReactFlow can resolve them.
 */
import type { Node, Edge } from '@xyflow/react';
import { rotatedBounds, unionBounds } from '../../core/model/geometry';
import type { Asset, BoardDocument, BoardSettings, Bounds, Element, EdgeElement, FreehandPoint, Viewport } from '../../core/model/types';
import { backdropCandidates, hasTextBackdrop } from '../../core/export/backdrop';
import { cullToViewport } from '../../core/selection';
import { scanTokenReferences } from '../../core/tokens/references';
import type { ActiveMode, TokenCollection } from '../../core/tokens/types';

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
  /** Document tokens, passed only to elements that reference one. */
  tokens?: TokenCollection;
  /** Stored token mode, passed with `tokens` (absent means auto). */
  activeMode?: ActiveMode;
  /** Ancestor frames (nearest first) plus component masters; present only when a clipping ancestor exists (Req 10.2, 24.8). */
  clipChain?: readonly Element[];
  /** Filled shapes beneath the element's text, topmost first; present only when there are any. */
  backdrop?: readonly Element[];
}

export interface ElementEdgeData extends Record<string, unknown> {
  element: EdgeElement;
  tokens?: TokenCollection;
  /** Stored token mode, passed with `tokens` (absent means auto). */
  activeMode?: ActiveMode;
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
export function toReactFlow(doc: Pick<BoardDocument, 'elements' | 'assets'> & { tokens?: TokenCollection; settings?: BoardSettings }, view?: ViewportBounds, options: ProjectOptions = {}): ReactFlowProjection {
  const selection = options.selection ?? new Set<string>();
  const previews = options.previews;
  const byId = new Map<string, Element>();
  for (const e of doc.elements) byId.set(e.id, withPreview(e, previews));
  // Tokens ride along only for elements that reference one, so unrelated nodes keep their data.
  const activeMode = doc.settings?.activeMode;
  const tokensFor = (el: Element): { tokens: TokenCollection; activeMode?: ActiveMode } | undefined =>
    doc.tokens && scanTokenReferences(el).length > 0 ? { tokens: doc.tokens, ...(activeMode ? { activeMode } : {}) } : undefined;

  /** Ancestor chain the renderer needs to clip a node; absent when nothing clips it. */
  const clipData = (el: Element): { clipChain?: readonly Element[] } => {
    const chain: Element[] = [];
    let clips = false;
    const seen = new Set<string>([el.id]);
    let pid = el.parentId;
    while (pid !== undefined && !seen.has(pid)) {
      seen.add(pid);
      const p = byId.get(pid);
      if (!p) break;
      chain.push(p);
      if (p.type === 'frame') {
        const m = p.instanceOf !== undefined ? byId.get(p.instanceOf) : undefined;
        if (m) chain.push(m);
        if (p.clipContent === true || (m?.type === 'frame' && m.clipContent === true)) clips = true;
      }
      pid = p.parentId;
    }
    return clips ? { clipChain: chain } : {};
  };

  // What sits behind a node's text, so the renderer can keep it legible on light or dark canvases.
  const docOrder = doc.elements.map((e) => byId.get(e.id)!);
  const backdropData = (el: Element, index: number): { backdrop?: readonly Element[] } => {
    if (!hasTextBackdrop(el)) return {};
    const found = backdropCandidates(el, docOrder, byId, index);
    return found.length > 0 ? { backdrop: found } : {};
  };

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
  for (let index = 0; index < doc.elements.length; index++) {
    const src = doc.elements[index]!;
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
      data: { element: el, assets: el.type === 'image' || el.style?.imageFill ? doc.assets : NO_ASSETS, ...tokensFor(el), ...clipData(el), ...backdropData(el, index) },
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
      data: { element: el, endpoints: a === b ? [a] : [a, b], ...tokensFor(el) },
    });
  }
  return { nodes, edges };
}
