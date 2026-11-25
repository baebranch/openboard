import { describe, expect, it } from 'vitest';
import { snapToAlignment, snapToGrid } from '../src/core/snap';

describe('snapToGrid', () => {
  it('snaps to nearest multiple', () => {
    expect(snapToGrid(13, 10)).toBe(10);
    expect(snapToGrid(16, 10)).toBe(20);
    expect(snapToGrid(-14, 10)).toBe(-10);
  });
});

describe('snapToAlignment', () => {
  const other = { x: 100, y: 100, width: 50, height: 50 };
  it('snaps within 8 screen px and reports a guide', () => {
    const r = snapToAlignment({ x: 104, y: 300, width: 10, height: 10 }, [other], 1);
    expect(r.x).toBe(100);
    expect(r.y).toBe(300);
    expect(r.guides.some((g) => g.axis === 'vertical' && g.position === 100)).toBe(true);
  });
  it('scales threshold by zoom', () => {
    // 4 canvas units at zoom 2 = 8 screen px -> snaps; 5 units = 10px -> no
    expect(snapToAlignment({ x: 104, y: 300, width: 10, height: 10 }, [other], 2).x).toBe(100);
    const r = snapToAlignment({ x: 105, y: 300, width: 10, height: 10 }, [other], 2);
    expect(r.x).toBe(105);
    expect(r.guides).toEqual([]);
  });
  it('snaps centers', () => {
    const r = snapToAlignment({ x: 0, y: 118, width: 20, height: 20 }, [other], 1);
    expect(r.y + 10).toBe(125);
  });
});
