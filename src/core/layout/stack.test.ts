import { describe, expect, it } from 'vitest';
import { arrangeStack, type StackChildInput } from './stack';
import type { LayoutConfig } from './types';

const cfg = (over: Partial<LayoutConfig> = {}): LayoutConfig => ({
  direction: 'horizontal',
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  mainAlign: 'start',
  crossAlign: 'start',
  ...over,
});
const kid = (id: string, x: number, w: number, h = 10, extra: Partial<StackChildInput> = {}): StackChildInput => ({
  id,
  x,
  y: 0,
  width: w,
  height: h,
  ...extra,
});
const frame = (layout: LayoutConfig, width = 100, height = 50) => ({ width, height, layout });

describe('arrangeStack', () => {
  it('returns empty map for no children', () => {
    expect(arrangeStack(frame(cfg()), []).size).toBe(0);
  });

  it('start: sequential with gap and padding', () => {
    const l = cfg({ gap: 5, padding: { top: 2, right: 0, bottom: 0, left: 3 } });
    const r = arrangeStack(frame(l), [kid('a', 0, 10), kid('b', 20, 10)]);
    expect(r.get('a')).toEqual({ x: 3, y: 2 });
    expect(r.get('b')).toEqual({ x: 18, y: 2 });
  });

  it('center and end', () => {
    const kids = [kid('a', 0, 10), kid('b', 20, 10)];
    const c = arrangeStack(frame(cfg({ gap: 10, mainAlign: 'center' })), kids);
    expect(c.get('a')!.x).toBe(35);
    expect(c.get('b')!.x).toBe(55);
    const e = arrangeStack(frame(cfg({ gap: 10, mainAlign: 'end' })), kids);
    expect(e.get('a')!.x).toBe(70);
    expect(e.get('b')!.x).toBe(90);
  });

  it('spaceBetween pins first and last; single child acts as start', () => {
    const r = arrangeStack(
      frame(cfg({ mainAlign: 'spaceBetween', padding: { top: 0, right: 10, bottom: 0, left: 10 } })),
      [kid('a', 0, 10), kid('b', 20, 10), kid('c', 40, 10)],
    );
    expect(r.get('a')!.x).toBe(10);
    expect(r.get('b')!.x).toBe(45);
    expect(r.get('c')!.x).toBe(80);
    const one = arrangeStack(frame(cfg({ mainAlign: 'spaceBetween', padding: { top: 0, right: 0, bottom: 0, left: 7 } })), [kid('a', 0, 10)]);
    expect(one.get('a')!.x).toBe(7);
  });

  it('orders by main-axis center with stored order as tie-break', () => {
    const r = arrangeStack(frame(cfg()), [kid('a', 50, 10), kid('b', 0, 10), kid('c', 0, 10)]);
    expect(r.get('b')!.x).toBe(0);
    expect(r.get('c')!.x).toBe(10);
    expect(r.get('a')!.x).toBe(20);
    // center, not left edge: wide child with smaller x but larger center goes later
    const w = arrangeStack(frame(cfg()), [kid('wide', 0, 100), kid('small', 10, 10)]);
    expect(w.get('small')!.x).toBe(0);
    expect(w.get('wide')!.x).toBe(10);
  });

  it('cross-axis alignment', () => {
    const kids = [kid('a', 0, 10, 20)];
    expect(arrangeStack(frame(cfg({ crossAlign: 'start' })), kids).get('a')!.y).toBe(0);
    expect(arrangeStack(frame(cfg({ crossAlign: 'center' })), kids).get('a')!.y).toBe(15);
    expect(arrangeStack(frame(cfg({ crossAlign: 'end' })), kids).get('a')!.y).toBe(30);
  });

  it('vertical direction swaps axes', () => {
    const l = cfg({ direction: 'vertical', gap: 4, crossAlign: 'end' });
    const kids: StackChildInput[] = [
      { id: 'a', x: 0, y: 30, width: 20, height: 10 },
      { id: 'b', x: 0, y: 0, width: 40, height: 10 },
    ];
    const r = arrangeStack(frame(l), kids);
    expect(r.get('b')).toEqual({ x: 60, y: 0 });
    expect(r.get('a')).toEqual({ x: 80, y: 14 });
  });

  it('overflow places from start padding edge with gap regardless of mainAlign', () => {
    const l = cfg({ gap: 5, mainAlign: 'end', padding: { top: 0, right: 0, bottom: 0, left: 4 } });
    const r = arrangeStack(frame(l, 30), [kid('a', 0, 20), kid('b', 30, 20)]);
    expect(r.get('a')!.x).toBe(4);
    expect(r.get('b')!.x).toBe(29);
    const sb = arrangeStack(frame(cfg({ gap: 5, mainAlign: 'spaceBetween' }), 30), [kid('a', 0, 20), kid('b', 30, 20)]);
    expect(sb.get('b')!.x).toBe(25);
  });

  it('excludes ignoreLayout children', () => {
    const r = arrangeStack(frame(cfg()), [kid('a', 0, 10, 10, { ignoreLayout: true }), kid('b', 20, 10)]);
    expect(r.has('a')).toBe(false);
    expect(r.get('b')!.x).toBe(0);
  });

  it('rounds to 2 decimals and offsets by frame origin', () => {
    const r = arrangeStack(
      { x: 100, y: 200, width: 10, height: 10, layout: cfg({ mainAlign: 'center', crossAlign: 'center' }) },
      [kid('a', 0, 3, 3)],
    );
    expect(r.get('a')).toEqual({ x: 103.5, y: 203.5 });
    const r2 = arrangeStack(frame(cfg({ mainAlign: 'center' }), 10), [kid('a', 0, 3.334)]);
    expect(r2.get('a')!.x).toBe(3.33);
  });

  it('is deterministic and does not mutate input', () => {
    const kids = [kid('a', 5, 10), kid('b', 1, 10)];
    const snap = JSON.stringify(kids);
    const a = arrangeStack(frame(cfg({ gap: 3 })), kids);
    const b = arrangeStack(frame(cfg({ gap: 3 })), kids);
    expect([...a]).toEqual([...b]);
    expect(JSON.stringify(kids)).toBe(snap);
  });
});
