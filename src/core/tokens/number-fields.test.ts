import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BoardDocument, Element } from '../model/types';
import { runLayoutPass } from '../layout/run-layout-pass';
import { resolveLayoutSpacing, resolveSpacing } from './number-fields';
import { countTokenReferences, detachTokenReferences, renameTokenReferences, scanTokenReferences } from './references';

// Requirement 11.15: number Tokens in layout gap and padding.
const style = { fill: 'theme:default', stroke: 'theme:default', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, cornerRadius: 0 } as const;
const rect = (id: string, x: number): Element =>
  ({ id, type: 'rectangle', x, y: 0, width: 10, height: 10, rotation: 0, style, parentId: 'f' }) as Element;
const frame = (gap: number | string, left: number | string): Element =>
  ({
    id: 'f', type: 'frame', name: 'f', x: 0, y: 0, width: 200, height: 50, rotation: 0, style,
    layout: { direction: 'horizontal', gap, padding: { top: 0, right: 0, bottom: 0, left }, mainAlign: 'start', crossAlign: 'start' },
  }) as unknown as Element;
const doc = (elements: Element[], numbers?: Record<string, number>): BoardDocument => ({
  schemaVersion: 2, meta: { id: 'b' }, viewport: { x: 0, y: 0, zoom: 1 }, elements, assets: [], library: [],
  ...(numbers ? { tokens: { numbers } } : {}),
});
const xs = (d: BoardDocument): number[] => d.elements.filter((e) => e.type === 'rectangle').map((e) => e.x);

describe('resolveSpacing', () => {
  it('resolves numbers, existing tokens, missing tokens, and clamps', () => {
    const tokens = { numbers: { s: 8, big: 5000, neg: -3 } };
    expect(resolveSpacing(12, tokens)).toBe(12);
    expect(resolveSpacing('token:s', tokens)).toBe(8);
    expect(resolveSpacing('token:gone', tokens)).toBe(0);
    expect(resolveSpacing('token:big', tokens)).toBe(1000);
    expect(resolveSpacing('token:neg', tokens)).toBe(0);
    expect(resolveSpacing('token:toString', tokens)).toBe(0);
  });

  it('returns the same layout object when every value is a number', () => {
    const layout = (frame(4, 2) as unknown as { layout: Parameters<typeof resolveLayoutSpacing>[0] }).layout;
    expect(resolveLayoutSpacing(layout, undefined)).toBe(layout);
  });
});

describe('Layout_Pass with number tokens', () => {
  it('uses the token value for gap and padding', () => {
    const d = runLayoutPass(doc([frame('token:gap', 'token:pad'), rect('a', 0), rect('b', 50)], { gap: 7, pad: 3 })).doc;
    expect(xs(d)).toEqual([3, 20]);
  });

  it('treats a missing token as 0 without failing', () => {
    const d = runLayoutPass(doc([frame('token:gone', 0), rect('a', 0), rect('b', 50)])).doc;
    expect(xs(d)).toEqual([0, 10]);
  });

  // Property: a layout referencing number Tokens lays out exactly like the same layout holding the
  // resolved literals. **Validates: Requirements 11.15**
  it('matches the literal layout for any token values', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (g, p) => {
        const viaTokens = runLayoutPass(doc([frame('token:g', 'token:p'), rect('a', 0), rect('b', 50)], { g, p })).doc;
        const literal = runLayoutPass(doc([frame(g, p), rect('a', 0), rect('b', 50)])).doc;
        expect(xs(viaTokens)).toEqual(xs(literal));
      }),
      { numRuns: 100 },
    );
  });
});

describe('number token references', () => {
  const f = frame('token:gap', 'token:pad');
  it('are found only in layout gap and padding sides', () => {
    expect(scanTokenReferences(f).map((r) => [r.category, r.name, r.path.join('.')])).toEqual([
      ['numbers', 'gap', 'layout.gap'],
      ['numbers', 'pad', 'layout.padding.left'],
    ]);
    expect(scanTokenReferences({ gap: 'token:x', top: 'token:y' })).toEqual([]);
  });

  it('are counted, renamed, and detached to numbers', () => {
    expect(countTokenReferences(f, 'numbers', 'gap')).toBe(1);
    const renamed = renameTokenReferences(f, 'numbers', 'gap', 'space') as unknown as { layout: { gap: string } };
    expect(renamed.layout.gap).toBe('token:space');
    const detached = detachTokenReferences(f, { numbers: { gap: 6 } }, { fallback: { numbers: 0 } }) as unknown as {
      layout: { gap: number; padding: { left: number } };
    };
    expect(detached.layout.gap).toBe(6);
    expect(detached.layout.padding.left).toBe(0);
  });
});
