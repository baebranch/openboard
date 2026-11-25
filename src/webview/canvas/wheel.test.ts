import { describe, expect, it } from 'vitest';
import { screenToBoard } from '../../core/viewport';
import { viewportForWheel, wheelDeltaPx, type WheelInput } from './wheel';

const v = { x: 100, y: 50, zoom: 1 };
const screen = { width: 1000, height: 600 };
const ev = (o: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, ...o });

describe('viewportForWheel', () => {
  it('ctrl (pinch) zooms around the pointer, keeping the board point fixed', () => {
    const pointer = { x: 300, y: 200 };
    const before = screenToBoard(v, pointer);
    const next = viewportForWheel(v, ev({ ctrlKey: true, deltaY: -10 }), pointer, screen);
    expect(next.zoom).toBeCloseTo(Math.exp(0.1), 6);
    const after = screenToBoard(next, pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('ctrl with positive deltaY zooms out', () => {
    expect(viewportForWheel(v, ev({ ctrlKey: true, deltaY: 10 }), { x: 0, y: 0 }, screen).zoom).toBeLessThan(1);
  });

  it('plain scroll pans without changing zoom', () => {
    expect(viewportForWheel(v, ev({ deltaY: 30 }), { x: 5, y: 5 }, screen)).toEqual({ x: 100, y: 20, zoom: 1 });
    expect(viewportForWheel(v, ev({ deltaX: -20, deltaY: 10 }), { x: 5, y: 5 }, screen)).toEqual({ x: 120, y: 40, zoom: 1 });
  });

  it('shift with only deltaY pans horizontally', () => {
    expect(viewportForWheel(v, ev({ shiftKey: true, deltaY: 30 }), { x: 0, y: 0 }, screen)).toEqual({ x: 70, y: 50, zoom: 1 });
  });

  it('shift keeps an existing deltaX', () => {
    expect(viewportForWheel(v, ev({ shiftKey: true, deltaX: 10, deltaY: 5 }), { x: 0, y: 0 }, screen)).toEqual({ x: 90, y: 45, zoom: 1 });
  });

  it('normalizes line and page delta modes', () => {
    expect(wheelDeltaPx({ deltaX: 1, deltaY: 3, deltaMode: 1 }, screen)).toEqual({ x: 16, y: 48 });
    expect(wheelDeltaPx({ deltaX: 1, deltaY: 1, deltaMode: 2 }, screen)).toEqual({ x: 1000, y: 600 });
    expect(viewportForWheel(v, ev({ deltaY: 3, deltaMode: 1 }), { x: 0, y: 0 }, screen).y).toBe(50 - 48);
    expect(viewportForWheel(v, ev({ deltaY: 1, deltaMode: 2 }), { x: 0, y: 0 }, screen).y).toBe(50 - 600);
  });
});
