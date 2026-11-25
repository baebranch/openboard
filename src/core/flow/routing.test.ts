import { describe, expect, it } from 'vitest';
import { FLOW_NODE_PRESETS } from './presets';
import { boundaryAnchor, recomputeAttachedEdges, routeEdge, routeSelfLoop } from './routing';
import type { EdgeElement, FlowNodeElement } from '../model/types';

const A = { x: 0, y: 0, width: 100, height: 60 };
const B = { x: 300, y: 100, width: 100, height: 60 };

const style = {
  fill: 'theme:default',
  stroke: 'theme:default',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 100,
  cornerRadius: 0,
} as const;

function node(id: string, x: number, y: number): FlowNodeElement {
  return {
    id, type: 'flowNode', x, y, width: 100, height: 60, rotation: 0, style,
    preset: 'process', runs: [], fontFamily: 'sans', fontSize: 14, align: 'center',
  };
}

describe('flow routing', () => {
  it('has seven presets', () => {
    expect(FLOW_NODE_PRESETS).toHaveLength(7);
    expect(new Set(FLOW_NODE_PRESETS.map((p) => p.preset)).size).toBe(7);
  });

  it('straight route ends on node boundaries', () => {
    const r = routeEdge(A, B, 'straight');
    expect(r.start.x).toBeCloseTo(100);
    expect(r.end.x).toBeCloseTo(300);
    expect(r.points).toHaveLength(2);
  });

  it('orthogonal route has only axis-aligned segments', () => {
    const r = routeEdge(A, B, 'orthogonal');
    for (let i = 1; i < r.points.length; i++) {
      const p = r.points[i - 1]!;
      const q = r.points[i]!;
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
  });

  it('curved route starts and ends at anchors', () => {
    const r = routeEdge(A, B, 'curved');
    expect(r.points[0]).toEqual(r.start);
    expect(r.points[r.points.length - 1]).toEqual(r.end);
    expect(r.path.startsWith('M')).toBe(true);
  });

  it('diamond anchor lies on the diamond outline', () => {
    const p = boundaryAnchor({ ...A, anchorShape: 'diamond' }, { x: 500, y: 30 });
    expect(p.x).toBeCloseTo(100);
  });

  it('self-loop extends outside bounds for every routing style', () => {
    for (const routing of ['straight', 'curved', 'orthogonal'] as const) {
      const r = routeSelfLoop(A, routing);
      expect(Math.max(...r.points.map((p) => p.x))).toBeGreaterThan(A.x + A.width);
      expect(r.selfLoop).toBe(true);
    }
    expect(routeEdge(A, A, 'straight', true).selfLoop).toBe(true);
  });

  it('recomputes attached edges on move and keeps endpoints attached', () => {
    const a = node('a', 0, 0);
    const b = node('b', 300, 0);
    const c = node('c', 0, 300);
    const e1: EdgeElement = {
      id: 'e1', type: 'edge', x: 0, y: 0, width: 0, height: 0, rotation: 0, style,
      sourceId: 'a', targetId: 'b', routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow',
    };
    const e2: EdgeElement = { ...e1, id: 'e2', sourceId: 'c', targetId: 'c' };
    const before = recomputeAttachedEdges([a, b, c, e1, e2], ['a']);
    expect([...before.keys()]).toEqual(['e1']);
    const moved = { ...a, y: 200 };
    const after = recomputeAttachedEdges([moved, b, c, e1, e2], ['a']);
    expect(after.get('e1')!.start).not.toEqual(before.get('e1')!.start);
    expect(after.get('e1')!.start.x).toBeLessThanOrEqual(moved.x + moved.width + 1e-6);
  });
});
