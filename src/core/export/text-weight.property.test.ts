import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Element } from '../model/types';
import { renderToSvg } from './svg';

/**
 * Feature: mockup-design-features, Property 9: Text weight resolution
 * **Validates: Requirements 7.2, 7.3, 7.11**
 */

const style = {
  fill: 'theme:default',
  stroke: 'theme:default',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 100,
  cornerRadius: 0,
} as const;

const base = (id: string) => ({ id, x: 0, y: 0, width: 200, height: 80, rotation: 0, style: { ...style } });

function build(kind: 'text' | 'sticky' | 'flowNode', bold: boolean, fontWeight: number | undefined): Element {
  const t = {
    runs: [{ text: 'hello', bold }],
    fontFamily: 'sans-serif',
    fontSize: 16,
    align: 'left' as const,
    ...(fontWeight === undefined ? {} : { fontWeight }),
  };
  if (kind === 'flowNode') return { ...base('x'), type: 'flowNode', preset: 'process', ...t } as Element;
  return { ...base('x'), type: kind, ...t } as Element;
}

/** Effective weight of the single run: tspan attribute, else group attribute, else 400. */
function renderedWeight(el: Element): number {
  const r = renderToSvg({ elements: [el], assets: [] }, { kind: 'board' });
  if (!r.ok) throw new Error('render failed');
  const svg = r.value.svg;
  const toNum = (w: string): number => (w === 'bold' ? 700 : w === 'normal' ? 400 : Number(w));
  const span = /<tspan[^>]*?\sfont-weight="([^"]+)"[^>]*>/.exec(svg);
  if (span) return toNum(span[1]!);
  const group = /<g font-family="[^"]*"[^>]*?\sfont-weight="([^"]+)"/.exec(svg);
  return group ? toNum(group[1]!) : 400;
}

describe('Property 9: Text weight resolution', () => {
  it('rendered weight equals bold ? max(700, fontWeight ?? 400) : (fontWeight ?? 400)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'text' | 'sticky' | 'flowNode'>('text', 'sticky', 'flowNode'),
        fc.boolean(),
        fc.option(fc.integer({ min: 1, max: 9 }).map((n) => n * 100), { nil: undefined }),
        (kind, bold, fontWeight) => {
          const w = fontWeight ?? 400;
          const expected = bold ? Math.max(700, w) : w;
          expect(renderedWeight(build(kind, bold, fontWeight))).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('an unset weight on a non-bold run is the 400 default', () => {
    expect(renderedWeight(build('text', false, undefined))).toBe(400);
  });
});
