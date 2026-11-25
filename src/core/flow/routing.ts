import { center } from '../model/geometry';
import type { Bounds, EdgeElement, EdgeRouting, Element, ElementId, Point } from '../model/types';
import { getFlowNodePreset, type AnchorShape } from './presets';

export interface RouteEndpoint extends Bounds {
  anchorShape?: AnchorShape;
}

export interface EdgeRoute {
  routing: EdgeRouting;
  selfLoop: boolean;
  start: Point;
  end: Point;
  /** Polyline (sampled for curves) from start to end, inclusive. */
  points: Point[];
  /** SVG path data. */
  path: string;
}

/** Distance a self-loop extends beyond the element bounds. */
export const SELF_LOOP_EXTENT = 40;
const CURVE_SAMPLES = 16;

/** Anchor shape for any element (flow nodes use their preset). */
export function anchorShapeOf(el: Element): AnchorShape {
  if (el.type === 'flowNode') return getFlowNodePreset(el.preset).anchorShape;
  if (el.type === 'ellipse') return 'ellipse';
  if (el.type === 'diamond') return 'diamond';
  return 'rect';
}

export function endpointOf(el: Element): RouteEndpoint {
  return { x: el.x, y: el.y, width: el.width, height: el.height, anchorShape: anchorShapeOf(el) };
}

/** Point where the ray from the node center toward `toward` leaves the node outline. */
export function boundaryAnchor(node: RouteEndpoint, toward: Point): Point {
  const c = center(node);
  const hw = node.width / 2;
  const hh = node.height / 2;
  let dx = toward.x - c.x;
  let dy = toward.y - c.y;
  if (dx === 0 && dy === 0) dx = 1;
  if (hw === 0 || hh === 0) return c;
  let t: number;
  switch (node.anchorShape ?? 'rect') {
    case 'ellipse':
      t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
      break;
    case 'diamond':
      t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
      break;
    default:
      t = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

type Side = 'left' | 'right' | 'top' | 'bottom';

function sidePoint(b: Bounds, side: Side): Point {
  switch (side) {
    case 'left':
      return { x: b.x, y: b.y + b.height / 2 };
    case 'right':
      return { x: b.x + b.width, y: b.y + b.height / 2 };
    case 'top':
      return { x: b.x + b.width / 2, y: b.y };
    default:
      return { x: b.x + b.width / 2, y: b.y + b.height };
  }
}

function sideVector(side: Side): Point {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    default:
      return { x: 0, y: 1 };
  }
}

/** Pick facing sides from the dominant axis of the center-to-center vector. */
function facingSides(a: Bounds, b: Bounds): [Side, Side] {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function curveRoute(start: Point, c1: Point, c2: Point, end: Point, selfLoop: boolean): EdgeRoute {
  const points: Point[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) points.push(cubicPoint(start, c1, c2, end, i / CURVE_SAMPLES));
  const path = `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`;
  return { routing: 'curved', selfLoop, start, end, points, path };
}

function polylineRoute(routing: EdgeRouting, points: Point[], selfLoop: boolean): EdgeRoute {
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return { routing, selfLoop, start: points[0]!, end: points[points.length - 1]!, points, path };
}

/** Loop leaving and re-entering the right side of the node, extending outside its bounds (Req 8.7). */
export function routeSelfLoop(node: RouteEndpoint, routing: EdgeRouting = 'curved'): EdgeRoute {
  const d = SELF_LOOP_EXTENT;
  const cy = node.y + node.height / 2;
  const spread = node.height / 4;
  // Diamonds and ellipses are narrower than their box away from the vertical center, so
  // anchor on the actual outline at the loop's vertical offsets.
  const s = outlineAtY(node, cy - spread);
  const e = outlineAtY(node, cy + spread);
  if (routing === 'orthogonal') {
    const x = Math.max(s.x, e.x) + d;
    return polylineRoute('orthogonal', [s, { x, y: s.y }, { x, y: e.y }, e], true);
  }
  const c1 = { x: s.x + (4 * d) / 3, y: s.y };
  const c2 = { x: e.x + (4 * d) / 3, y: e.y };
  return curveRoute(s, c1, c2, e, true);
}

/** Right-hand outline point of the node at a given y. */
function outlineAtY(node: RouteEndpoint, y: number): Point {
  const c = center(node);
  const hw = node.width / 2;
  const hh = node.height / 2;
  const dy = Math.min(Math.abs(y - c.y), hh);
  const r = hh === 0 ? 0 : dy / hh;
  switch (node.anchorShape ?? 'rect') {
    case 'ellipse':
      return { x: c.x + hw * Math.sqrt(Math.max(0, 1 - r * r)), y };
    case 'diamond':
      return { x: c.x + hw * (1 - r), y };
    default:
      return { x: c.x + hw, y };
  }
}

/** Compute the route of an edge between two endpoints. */
export function routeEdge(
  source: RouteEndpoint,
  target: RouteEndpoint,
  routing: EdgeRouting,
  selfLoop = false,
): EdgeRoute {
  if (selfLoop) return routeSelfLoop(source, routing);

  if (routing === 'straight') {
    const start = boundaryAnchor(source, center(target));
    const end = boundaryAnchor(target, center(source));
    return polylineRoute('straight', [start, end], false);
  }

  const [sa, ta] = facingSides(source, target);
  const start = sidePoint(source, sa);
  const end = sidePoint(target, ta);

  if (routing === 'curved') {
    const dist = Math.max(Math.hypot(end.x - start.x, end.y - start.y) / 2, 20);
    const sv = sideVector(sa);
    const tv = sideVector(ta);
    const c1 = { x: start.x + sv.x * dist, y: start.y + sv.y * dist };
    const c2 = { x: end.x + tv.x * dist, y: end.y + tv.y * dist };
    return curveRoute(start, c1, c2, end, false);
  }

  // orthogonal: axis-aligned segments only
  const horizontal = sa === 'left' || sa === 'right';
  let pts: Point[];
  if (horizontal) {
    const midX = (start.x + end.x) / 2;
    pts = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  } else {
    const midY = (start.y + end.y) / 2;
    pts = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
  return polylineRoute('orthogonal', dedupe(pts), false);
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  if (out.length === 1) out.push({ ...out[0]! });
  return out;
}

/** Route an Edge element given the element lookup; undefined when an endpoint is missing. */
export function routeEdgeElement(edge: EdgeElement, lookup: (id: ElementId) => Element | undefined): EdgeRoute | undefined {
  const s = lookup(edge.sourceId);
  const t = lookup(edge.targetId);
  if (!s || !t) return undefined;
  return routeEdge(endpointOf(s), endpointOf(t), edge.routing, edge.sourceId === edge.targetId);
}

/**
 * Recompute routes of every edge attached to any moved element so endpoints stay
 * attached after a move (Req 8.4). Returns routes keyed by edge id.
 */
export function recomputeAttachedEdges(
  elements: readonly Element[],
  movedIds: ReadonlySet<ElementId> | readonly ElementId[],
): Map<ElementId, EdgeRoute> {
  const moved = movedIds instanceof Set ? movedIds : new Set(movedIds as readonly ElementId[]);
  const byId = new Map<ElementId, Element>();
  for (const el of elements) byId.set(el.id, el);
  const result = new Map<ElementId, EdgeRoute>();
  for (const el of elements) {
    if (el.type !== 'edge') continue;
    if (!moved.has(el.sourceId) && !moved.has(el.targetId)) continue;
    const route = routeEdgeElement(el, (id) => byId.get(id));
    if (route) result.set(el.id, route);
  }
  return result;
}
