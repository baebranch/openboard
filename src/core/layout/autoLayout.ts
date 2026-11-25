import type { Bounds, ElementId, Point } from '../model/types';

/** Layered auto layout (Req 8.8, 8.9, 8.10). Pure: the caller applies the result in one transaction. */

export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

export const LAYOUT_DIRECTIONS: readonly LayoutDirection[] = ['TB', 'BT', 'LR', 'RL'];

/** Gap between nodes in the same layer. */
export const LAYOUT_NODE_GAP = 40;
/** Gap between consecutive layers. */
export const LAYOUT_LAYER_GAP = 60;

export interface LayoutNode extends Bounds {
  id: ElementId;
}

export interface LayoutEdge {
  sourceId: ElementId;
  targetId: ElementId;
}

export interface LayoutError {
  code: 'too_few_nodes';
  message: string;
}

export type LayoutResult = { ok: true; value: Map<ElementId, Point> } | { ok: false; error: LayoutError };

export const TOO_FEW_NODES_MESSAGE = 'Select at least two flow nodes to auto layout.';

const SWEEPS = 4;

/**
 * Lays out the selected Flow_Nodes in layers. Cycles are broken by reversing back edges, so every
 * other edge points in `direction`. The result keeps the selection's top-left corner in place.
 */
export function autoLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: LayoutDirection,
): LayoutResult {
  const unique: LayoutNode[] = [];
  const index = new Map<ElementId, number>();
  for (const n of nodes) {
    if (index.has(n.id)) continue;
    index.set(n.id, unique.length);
    unique.push(n);
  }
  if (unique.length < 2) {
    return { ok: false, error: { code: 'too_few_nodes', message: TOO_FEW_NODES_MESSAGE } };
  }
  const n = unique.length;

  // Edges between selected nodes; self-loops and duplicates carry no ordering information.
  const seen = new Set<string>();
  const arcs: Array<[number, number]> = [];
  for (const e of edges) {
    const s = index.get(e.sourceId);
    const t = index.get(e.targetId);
    if (s === undefined || t === undefined || s === t) continue;
    const key = `${s}>${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    arcs.push([s, t]);
  }

  // Cycle breaking: DFS; arcs to a node on the current stack are back edges and get reversed.
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const [s, t] of arcs) out[s]!.push(t);
  const state = new Array<number>(n).fill(0); // 0 new, 1 on stack, 2 done
  const dag: Array<[number, number]> = [];
  for (let root = 0; root < n; root++) {
    if (state[root] !== 0) continue;
    state[root] = 1;
    const stack: Array<{ v: number; i: number }> = [{ v: root, i: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const succ = out[top.v]!;
      if (top.i >= succ.length) {
        state[top.v] = 2;
        stack.pop();
        continue;
      }
      const w = succ[top.i++]!;
      if (state[w] === 1) {
        dag.push([w, top.v]); // reversed back edge
      } else {
        dag.push([top.v, w]);
        if (state[w] === 0) {
          state[w] = 1;
          stack.push({ v: w, i: 0 });
        }
      }
    }
  }

  // Longest-path ranking over the acyclic graph (Kahn order).
  const dagOut: number[][] = Array.from({ length: n }, () => []);
  const dagIn: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (const [s, t] of dag) {
    dagOut[s]!.push(t);
    dagIn[t]!.push(s);
    indeg[t]!++;
  }
  const rank = new Array<number>(n).fill(0);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]!;
    for (const w of dagOut[v]!) {
      if (rank[w]! < rank[v]! + 1) rank[w] = rank[v]! + 1;
      if (--indeg[w]! === 0) queue.push(w);
    }
  }
  const layerCount = Math.max(...rank) + 1;
  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  for (let i = 0; i < n; i++) layers[rank[i]!]!.push(i);

  const vertical = direction === 'TB' || direction === 'BT';
  const crossSize = (i: number): number => (vertical ? unique[i]!.width : unique[i]!.height);
  const rankSize = (i: number): number => (vertical ? unique[i]!.height : unique[i]!.width);

  // Cross-axis placement: pack each layer, center it, then reorder by neighbour barycenters.
  const cross = new Array<number>(n).fill(0); // center coordinate on the cross axis
  const pack = (): void => {
    const widths = layers.map((l) => l.reduce((a, i) => a + crossSize(i), 0) + LAYOUT_NODE_GAP * Math.max(0, l.length - 1));
    const maxW = Math.max(...widths);
    layers.forEach((l, li) => {
      let pos = (maxW - widths[li]!) / 2;
      for (const i of l) {
        cross[i] = pos + crossSize(i) / 2;
        pos += crossSize(i) + LAYOUT_NODE_GAP;
      }
    });
  };
  pack();
  for (let s = 0; s < SWEEPS; s++) {
    const down = s % 2 === 0;
    const order = down ? layers.map((_, i) => i) : layers.map((_, i) => layerCount - 1 - i);
    for (const li of order) {
      const layer = layers[li]!;
      const bary = new Map<number, number>();
      for (const v of layer) {
        const nbrs = down ? dagIn[v]! : dagOut[v]!;
        bary.set(v, nbrs.length === 0 ? cross[v]! : nbrs.reduce((a, w) => a + cross[w]!, 0) / nbrs.length);
      }
      layer.sort((a, b) => bary.get(a)! - bary.get(b)! || a - b);
      pack();
    }
  }

  // Rank-axis placement: layers stacked with a gap, each as thick as its largest node.
  const thickness = layers.map((l) => Math.max(...l.map(rankSize)));
  const start = new Array<number>(layerCount).fill(0);
  let acc = 0;
  const forward = direction === 'TB' || direction === 'LR';
  for (let k = 0; k < layerCount; k++) {
    const li = forward ? k : layerCount - 1 - k;
    start[li] = acc;
    acc += thickness[li]! + LAYOUT_LAYER_GAP;
  }

  const raw: Point[] = unique.map((node, i) => {
    const r = start[rank[i]!]! + (thickness[rank[i]!]! - rankSize(i)) / 2;
    const c = cross[i]! - crossSize(i) / 2;
    return vertical ? { x: c, y: r } : { x: r, y: c };
  });

  // Anchor: keep the selection's original top-left.
  const origMinX = Math.min(...unique.map((u) => u.x));
  const origMinY = Math.min(...unique.map((u) => u.y));
  const newMinX = Math.min(...raw.map((p) => p.x));
  const newMinY = Math.min(...raw.map((p) => p.y));
  const result = new Map<ElementId, Point>();
  unique.forEach((u, i) => {
    result.set(u.id, { x: raw[i]!.x - newMinX + origMinX, y: raw[i]!.y - newMinY + origMinY });
  });
  return { ok: true, value: result };
}
