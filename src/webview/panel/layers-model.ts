/**
 * Pure model of the Layers panel: the board's elements as a tree (by `parentId`), topmost first in
 * each level (the reverse of the document's back-to-front order), with a label and icon per element.
 */
import type { BoardDocument, Element, ElementId } from '../../core/model/types';
import type { IconName } from '../icons';
import { t } from '../i18n/t';

export interface LayerNode {
  el: Element;
  depth: number;
  children: LayerNode[];
}

/** Tree of every element; an element whose parent is missing is a root. Cycle-safe. */
export function layerTree(doc: Pick<BoardDocument, 'elements'>): LayerNode[] {
  const ids = new Set(doc.elements.map((e) => e.id));
  const kids = new Map<ElementId, Element[]>();
  const roots: Element[] = [];
  for (const e of doc.elements) {
    if (e.parentId !== undefined && ids.has(e.parentId) && e.parentId !== e.id) {
      const list = kids.get(e.parentId);
      if (list) list.push(e);
      else kids.set(e.parentId, [e]);
    } else roots.push(e);
  }
  const seen = new Set<ElementId>();
  const build = (e: Element, depth: number): LayerNode => {
    seen.add(e.id);
    const children = (kids.get(e.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .reverse()
      .map((c) => build(c, depth + 1));
    return { el: e, depth, children };
  };
  const tree = [...roots].reverse().map((e) => build(e, 0));
  // Elements on a parent cycle never reach a root; list them at the top level so none is hidden.
  for (const e of doc.elements) if (!seen.has(e.id)) tree.push(build(e, 0));
  return tree;
}

/**
 * The tree narrowed to layers whose name contains `query` (case-insensitive), with the ancestors
 * that lead to them so the hierarchy stays readable. An empty query returns the tree unchanged.
 */
export function filterLayers(tree: readonly LayerNode[], query: string): LayerNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...tree];
  const visit = (n: LayerNode): LayerNode | undefined => {
    const children = n.children.map(visit).filter((c): c is LayerNode => c !== undefined);
    if (children.length > 0 || layerLabel(n.el).toLowerCase().includes(q)) return { ...n, children };
    return undefined;
  };
  return tree.map(visit).filter((n): n is LayerNode => n !== undefined);
}

/** Number of layers in a (possibly filtered) tree. */
export function countLayers(tree: readonly LayerNode[]): number {
  return tree.reduce((sum, n) => sum + 1 + countLayers(n.children), 0);
}

/** Ids of the ancestors of `id` (nearest first). */
export function ancestorIds(doc: Pick<BoardDocument, 'elements'>, id: ElementId): ElementId[] {
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const out: ElementId[] = [];
  const seen = new Set<ElementId>([id]);
  for (let p = byId.get(id)?.parentId; p !== undefined && !seen.has(p); p = byId.get(p)?.parentId) {
    if (!byId.has(p)) break;
    out.push(p);
    seen.add(p);
  }
  return out;
}

const TYPE_LABELS: Readonly<Record<string, string>> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  line: 'Line',
  arrow: 'Arrow',
  freehand: 'Drawing',
  text: 'Text',
  sticky: 'Sticky note',
  image: 'Image',
  frame: 'Frame',
  flowNode: 'Flow node',
  edge: 'Connector',
  icon: 'Icon',
};

const LABEL_MAX = 60;

const clip = (s: string): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1)}…` : one;
};

/** Display name: a frame's component or frame name, the text of text-like elements, an icon's name, ... */
export function layerLabel(el: Element): string {
  const fallback = t(TYPE_LABELS[el.type] ?? el.type);
  switch (el.type) {
    case 'frame':
      return clip(el.component ?? el.name) || fallback;
    case 'text':
    case 'sticky':
    case 'flowNode':
      return clip(el.runs.map((r) => r.text).join('')) || fallback;
    case 'icon':
      return clip(el.name) || fallback;
    case 'image':
      return clip(el.alt ?? '') || fallback;
    case 'edge':
      return clip(el.label ?? '') || fallback;
    default:
      return fallback;
  }
}

export type LayerKind = 'master' | 'instance' | 'plain';

export function layerKind(el: Element): LayerKind {
  if (el.type !== 'frame') return 'plain';
  if (el.component !== undefined) return 'master';
  if (el.instanceOf !== undefined) return 'instance';
  return 'plain';
}

export function layerIcon(el: Element): IconName {
  switch (el.type) {
    case 'frame':
      if (el.component !== undefined) return 'components';
      if (el.instanceOf !== undefined) return 'instance';
      return el.layout !== undefined ? 'autoLayout' : 'frame';
    case 'edge':
      return 'connector';
    case 'flowNode':
      return 'rectangle';
    default:
      return el.type;
  }
}
