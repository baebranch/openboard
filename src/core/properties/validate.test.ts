import { describe, expect, it } from 'vitest';
import { validateProperty } from './validate';

describe('validateProperty', () => {
  it('accepts range boundaries and rejects outside', () => {
    expect(validateProperty('rectangle', 'strokeWidth', 0)).toEqual({ ok: true, value: 0 });
    expect(validateProperty('rectangle', 'strokeWidth', 100).ok).toBe(true);
    expect(validateProperty('rectangle', 'strokeWidth', 100.5).ok).toBe(false);
    expect(validateProperty('text', 'fontSize', 0).ok).toBe(false);
    expect(validateProperty('text', 'fontSize', 999).ok).toBe(true);
    expect(validateProperty('rectangle', 'rotation', -360).ok).toBe(true);
    expect(validateProperty('rectangle', 'rotation', 361).ok).toBe(false);
    expect(validateProperty('rectangle', 'width', 0.5).ok).toBe(false);
  });

  it('rejects non-numeric values for numeric properties', () => {
    expect(validateProperty('rectangle', 'opacity', '50').ok).toBe(false);
    expect(validateProperty('rectangle', 'opacity', NaN).ok).toBe(false);
  });

  it('rounds position to 2 decimals', () => {
    expect(validateProperty('rectangle', 'x', 1.005 + 0.1234)).toEqual({ ok: true, value: 1.13 });
  });

  it('bounds corner radius by half the shorter side', () => {
    const ctx = { width: 100, height: 40 };
    expect(validateProperty('rectangle', 'cornerRadius', 20, ctx).ok).toBe(true);
    expect(validateProperty('rectangle', 'cornerRadius', 20.1, ctx).ok).toBe(false);
  });

  it('validates enums, colors and freehand width', () => {
    expect(validateProperty('line', 'strokeStyle', 'wavy').ok).toBe(false);
    expect(validateProperty('text', 'align', 'center').ok).toBe(true);
    expect(validateProperty('rectangle', 'fill', '#fff').ok).toBe(true);
    expect(validateProperty('rectangle', 'fill', 'red').ok).toBe(false);
    expect(validateProperty('freehand', 'baseWidth', 0).ok).toBe(false);
    expect(validateProperty('freehand', 'baseWidth', 100).ok).toBe(true);
  });
});
