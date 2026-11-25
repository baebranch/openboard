import { describe, expect, it } from 'vitest';
import { autoLayout, type LayoutNode } from './autoLayout';

const node = (id: string, x = 0, y = 0): LayoutNode => ({ id, x, y, width: 80, height: 40 });

describe('autoLayout', () => {
  it('errors with fewer than two nodes', () => {
    const r = autoLayout([node('a')], [], 'TB');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('too_few_nodes');
  });

  it('points edges in each direction and breaks cycles', () => {
    const nodes = [node('a', 10, 20), node('b', 30, 50), node('c', 15, 25)];
    const edges = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'b', targetId: 'c' },
      { sourceId: 'c', targetId: 'a' },
    ];
    for (const dir of ['TB', 'BT', 'LR', 'RL'] as const) {
      const r = autoLayout(nodes, edges, dir);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const p = (id: string) => r.value.get(id)!;
      const sign = dir === 'TB' || dir === 'LR' ? 1 : -1;
      const axis = dir === 'TB' || dir === 'BT' ? 'y' : 'x';
      expect((p('b')[axis] - p('a')[axis]) * sign).toBeGreaterThan(0);
      expect((p('c')[axis] - p('b')[axis]) * sign).toBeGreaterThan(0);
      expect(Math.min(...nodes.map((n) => p(n.id).x))).toBe(10);
      expect(Math.min(...nodes.map((n) => p(n.id).y))).toBe(20);
    }
  });

  it('does not overlap disconnected nodes', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => node(id));
    const r = autoLayout(nodes, [], 'TB');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ps = nodes.map((n) => r.value.get(n.id)!);
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const sep = Math.abs(ps[i]!.x - ps[j]!.x) >= 80 || Math.abs(ps[i]!.y - ps[j]!.y) >= 40;
        expect(sep).toBe(true);
      }
  });
});
