import { describe, expect, it } from "vitest";
import {
  constrainToAngle,
  eraseIntersecting,
  finalizeStroke,
  pressureWidth,
  smoothStroke,
} from "../src/core/freehand";

describe("freehand", () => {
  it("creates a single dot for one sample", () => {
    expect(finalizeStroke([{ x: 5, y: 6 }])).toEqual([{ x: 5, y: 6 }]);
    expect(finalizeStroke([])).toBeNull();
  });

  it("smooths collinear noise within 2px and keeps endpoints", () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: i % 2 ? 1 : 0 }));
    const out = smoothStroke(pts);
    expect(out.length).toBeLessThan(pts.length);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("clamps pressure width to 25%..200%", () => {
    expect(pressureWidth(10, 0)).toBe(2.5);
    expect(pressureWidth(10, 1)).toBe(20);
    expect(pressureWidth(10, 0.5)).toBe(10);
    expect(pressureWidth(10)).toBe(10);
  });

  it("snaps to 15 degrees with Shift", () => {
    const p = constrainToAngle({ x: 0, y: 0 }, { x: 100, y: 3 });
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(100, 3));
    const out = finalizeStroke([{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 3 }], { shift: true })!;
    expect(out).toHaveLength(2);
  });

  it("erases elements intersected by the path", () => {
    const els = [
      { id: "a", bounds: { x: 0, y: 0, width: 10, height: 10 } },
      { id: "b", bounds: { x: 100, y: 100, width: 10, height: 10 } },
    ];
    expect(eraseIntersecting([{ x: -5, y: 5 }, { x: 15, y: 5 }], els)).toEqual(["a"]);
    expect(eraseIntersecting([{ x: 105, y: 105 }], els)).toEqual(["b"]);
  });
});
