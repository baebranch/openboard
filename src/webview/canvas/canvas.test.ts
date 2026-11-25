import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element, EdgeElement } from '../../core/model/types';
import { defaultStyle } from '../../core/shapes';
import {
  TOOL_BATCH,
  TOOL_CONNECT,
  TOOL_ELEMENT_CREATE,
  TOOL_ELEMENT_DELETE,
  TOOL_ELEMENT_UPDATE,
  connectOp,
  createOp,
  deleteOp,
  drawGeometry,
  formatZoomPercent,
  freehandOp,
  moveOp,
  resizeBounds,
  resizeOp,
  rotateOp,
  snapMoveDelta,
} from './gestures';
import { toReactFlow } from './project';
import { dispatchOp, nextGestureId, setOpSender } from '../ops';

function rect(id: string, x: number, y: number, w = 100, h = 50): Element {
  return { id, type: 'rectangle', x, y, width: w, height: h, rotation: 0, style: defaultStyle() } as Element;
}
function edge(id: string, s: string, t: string): EdgeElement {
  return {
    id, type: 'edge', x: 0, y: 0, width: 100, height: 100, rotation: 0, style: defaultStyle(),
    sourceId: s, targetId: t, routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow',
  };
}
const doc = (elements: Element[]): Pick<BoardDocument, 'elements' | 'assets'> => ({ elements, assets: [] });
const screen = { width: 800, height: 600 };
const view = (x = 0, y = 0, zoom = 1) => ({ viewport: { x, y, zoom }, screen });

describe('toReactFlow', () => {
  it('projects elements to nodes and edges in document order', () => {
    const d = doc([rect('a', 0, 0), rect('b', 200, 0), edge('e', 'a', 'b')]);
    const p = toReactFlow(d, view());
    expect(p.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(p.edges.map((e) => e.id)).toEqual(['e']);
    expect(p.nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it('culls elements beyond the 256 px margin but keeps those within it', () => {
    const d = doc([rect('in', 10, 10), rect('margin', 800 + 200, 0), rect('far', 800 + 300, 0)]);
    expect(toReactFlow(d, view()).nodes.map((n) => n.id)).toEqual(['in', 'margin']);
  });

  it('accounts for pan and zoom when culling', () => {
    const d = doc([rect('a', 0, 0), rect('b', 5000, 0)]);
    // viewport shifted so board x=5000 is on screen
    expect(toReactFlow(d, view(-5000, 0, 1)).nodes.map((n) => n.id)).toEqual(['b']);
    // zoomed out to 10% the whole board fits
    expect(toReactFlow(d, view(0, 0, 0.1)).nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('keeps endpoints of visible edges and drops dangling edges', () => {
    const d = doc([rect('a', 0, 0), rect('b', 5000, 0), edge('e', 'a', 'b'), edge('dangling', 'a', 'missing')]);
    const p = toReactFlow(d, view());
    expect(p.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(p.edges.map((e) => e.id)).toEqual(['e']);
  });

  it('marks selection and applies previews without touching the document', () => {
    const els = [rect('a', 0, 0)];
    const p = toReactFlow(doc(els), view(), { selection: new Set(['a']), previews: new Map([['a', { x: 40, y: 5 }]]) });
    expect(p.nodes[0]!.selected).toBe(true);
    expect(p.nodes[0]!.position).toEqual({ x: 40, y: 5 });
    expect(els[0]!.x).toBe(0);
  });

  it('projects everything without a viewport', () => {
    const d = doc([rect('a', 0, 0), rect('b', 99999, 0)]);
    expect(toReactFlow(d).nodes).toHaveLength(2);
  });
});

describe('gesture -> op mapping', () => {
  const els = [rect('a', 10, 10), rect('b', 100, 100)];

  it('a single-element move is one update; a group move is one batch', () => {
    expect(moveOp(els, ['a'], 5, 7)).toEqual({ tool: TOOL_ELEMENT_UPDATE, input: { ids: ['a'], set: { x: 15, y: 17 } } });
    const g = moveOp(els, ['a', 'b'], 5, 0)!;
    expect(g.tool).toBe(TOOL_BATCH);
    expect((g.input as { operations: unknown[] }).operations).toHaveLength(2);
  });

  it('a zero move produces no op', () => {
    expect(moveOp(els, ['a', 'b'], 0, 0)).toBeUndefined();
  });

  it('grid snap rounds the group top-left to the spacing', () => {
    expect(snapMoveDelta({ x: 10, y: 10, width: 5, height: 5 }, 13, 4, 20)).toEqual({ dx: 10, dy: 10 });
    expect(snapMoveDelta({ x: 10, y: 10, width: 5, height: 5 }, 13, 4, undefined)).toEqual({ dx: 13, dy: 4 });
  });

  it('resizeBounds moves the dragged edges and enforces a 1 px minimum', () => {
    const b = { x: 0, y: 0, width: 100, height: 50 };
    expect(resizeBounds(b, 'se', 20, 10)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
    expect(resizeBounds(b, 'nw', 10, 5)).toEqual({ x: 10, y: 5, width: 90, height: 45 });
    expect(resizeBounds(b, 'e', -500, 0).width).toBe(1);
    const k = resizeBounds(b, 'se', 100, 0, true);
    expect(k.width / k.height).toBeCloseTo(2);
  });

  it('resize scales every selected element in one op', () => {
    const op = resizeOp(els, ['a'], { x: 10, y: 10, width: 100, height: 50 }, { x: 10, y: 10, width: 200, height: 100 })!;
    expect(op.input).toEqual({ ids: ['a'], set: { x: 10, y: 10, width: 200, height: 100 } });
    expect(resizeOp(els, ['a'], { x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 })).toBeUndefined();
  });

  it('rotate adds the delta and wraps within range', () => {
    expect(rotateOp(els, ['a'], 90)!.input).toEqual({ ids: ['a'], set: { rotation: 90 } });
    expect(rotateOp(els, ['a'], 0)).toBeUndefined();
  });

  it('drawing creates exactly one element; click uses default size', () => {
    const g = drawGeometry('rectangle', { x: 50, y: 50 }, { x: 10, y: 20 }, false);
    expect(g).toMatchObject({ x: 10, y: 20, width: 40, height: 30 });
    const op = createOp('rectangle', drawGeometry('rectangle', { x: 5, y: 5 }, { x: 5, y: 5 }, true));
    expect(op.tool).toBe(TOOL_ELEMENT_CREATE);
    expect((op.input as { elements: unknown[] }).elements).toHaveLength(1);
  });

  it('lines keep direction via rotation', () => {
    const g = drawGeometry('arrow', { x: 0, y: 0 }, { x: 0, y: 100 }, false);
    expect(g.rotation).toBe(90);
    expect(g.width).toBe(100);
  });

  it('a freehand stroke is one create op with absolute points', () => {
    const op = freehandOp([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], false)!;
    expect(op.tool).toBe(TOOL_ELEMENT_CREATE);
    const el = (op.input as { elements: Array<Record<string, unknown>> }).elements[0]!;
    expect(el['type']).toBe('freehand');
    expect(el['points']).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
    expect(freehandOp([], false)).toBeUndefined();
  });

  it('connect: to an element makes one edge; to empty space adds a new node position', () => {
    expect(connectOp('a', 'b', { x: 0, y: 0 })).toEqual({ tool: TOOL_CONNECT, input: { edges: [{ sourceId: 'a', targetId: 'b' }] } });
    expect(connectOp('a', undefined, { x: 5, y: 6 }).input).toEqual({ edges: [{ sourceId: 'a', toPosition: { x: 5, y: 6 } }] });
  });

  it('delete maps to one op and nothing for an empty list', () => {
    expect(deleteOp(['a', 'b'])).toEqual({ tool: TOOL_ELEMENT_DELETE, input: { ids: ['a', 'b'] } });
    expect(deleteOp([])).toBeUndefined();
  });

  it('formats zoom as a whole percent', () => {
    expect(formatZoomPercent(1)).toBe('100%');
    expect(formatZoomPercent(0.3333)).toBe('33%');
    expect(formatZoomPercent(0.02)).toBe('2%');
  });
});

describe('dispatchOp', () => {
  it('posts one op message with a unique gesture id', () => {
    const sent: unknown[] = [];
    setOpSender((m) => sent.push(m));
    const id = dispatchOp('openboard.element.delete', { ids: ['a'] });
    setOpSender(undefined);
    expect(sent).toEqual([{ type: 'op', gestureId: id, tool: 'openboard.element.delete', input: { ids: ['a'] } }]);
    expect(nextGestureId()).not.toBe(nextGestureId());
  });
});
