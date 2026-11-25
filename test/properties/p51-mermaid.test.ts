import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  parseMermaid,
  printMermaid,
  isMermaidError,
  type MermaidGraph,
  type MermaidLink,
} from '../../src/core/mermaid';
import type { FlowNodePreset } from '../../src/core/model/types';

// Feature: openboard, Property 51: Mermaid import round trip and errors
// **Validates: Requirements 8.11, 8.12**

const presets: FlowNodePreset[] = ['startEnd', 'process', 'decision', 'inputOutput', 'database', 'document', 'annotation'];

// Labels: arbitrary text including quotes, pipes, markup characters, comment markers and newlines (LF only).
const labelArb = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.string({
    unit: fc.constantFrom('a', 'Z', ' ', '"', '|', '#', '<', '>', '%', ';', '\n', '[', ']', '(', ')', '{', '}', '-', '=', '.', '/', '\\', '&'),
    maxLength: 12,
  }),
  fc.constantFrom('<br/>', '#quot;', '#35;', '%% c', 'a;b', '-->'),
).map((s) => s.replace(/\r/g, ''));

const graphArb: fc.Arbitrary<MermaidGraph> = fc
  .record({
    direction: fc.constantFrom('TB', 'BT', 'LR', 'RL' as const),
    nodes: fc.array(fc.record({ label: labelArb, preset: fc.constantFrom(...presets) }), { minLength: 1, maxLength: 6 }),
  })
  .chain(({ direction, nodes }) => {
    const ids = nodes.map((_, i) => `n${i}`);
    const link: fc.Arbitrary<MermaidLink> = fc
      .record({
        source: fc.constantFrom(...ids),
        target: fc.constantFrom(...ids),
        label: fc.option(labelArb, { nil: undefined }),
        style: fc.constantFrom('solid' as const, 'dotted' as const, 'thick' as const),
        arrow: fc.boolean(),
      })
      .map((l) => (l.label === undefined ? { source: l.source, target: l.target, style: l.style, arrow: l.arrow } : l));
    return fc.array(link, { maxLength: 8 }).map((links) => ({
      direction: direction as MermaidGraph['direction'],
      nodes: nodes.map((n, i) => ({ id: ids[i]!, label: n.label, preset: n.preset })),
      links,
    }));
  });

describe('Feature: openboard, Property 51: Mermaid import round trip and errors', () => {
  it('parse(print(graph)) preserves nodes, labels, link labels and direction', () => {
    fc.assert(
      fc.property(graphArb, (g) => {
        const r = parseMermaid(printMermaid(g));
        expect(isMermaidError(r)).toBe(false);
        expect(r).toEqual(g);
      }),
      { numRuns: 200 },
    );
  });

  it('invalid text reports the 1-based line of the first error and yields no graph', () => {
    const badLine = fc.constantFrom('@@@', 'a --> ', '--> b', 'a[unclosed', 'a["unterminated]', 'a b', '!', 'a -x- b');
    fc.assert(
      fc.property(graphArb, badLine, fc.nat(), fc.nat({ max: 3 }), (g, bad, at, blanks) => {
        const lines = printMermaid(g).split('\n').filter((l) => l !== '');
        const k = 1 + (at % lines.length); // insert after the directive line, index in [1, lines.length]
        const inserted = [...lines.slice(0, k), ...Array<string>(blanks).fill(''), bad, ...lines.slice(k)];
        const expectedLine = k + blanks + 1;
        const r = parseMermaid(inserted.join('\n'));
        expect(isMermaidError(r)).toBe(true);
        if (isMermaidError(r)) expect(r.error.line).toBe(expectedLine);
        expect('nodes' in r).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('a missing directive is an error on the first non-empty line', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4 }), (blanks) => {
        const r = parseMermaid(`${'\n'.repeat(blanks)}a --> b`);
        expect(isMermaidError(r) && r.error.line).toBe(blanks + 1);
      }),
      { numRuns: 100 },
    );
  });
});
