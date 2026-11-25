import { describe, expect, it } from 'vitest';
import { parseMermaid, printMermaid, isMermaidError } from './index';

describe('mermaid parser', () => {
  it('parses shapes, links, and labels', () => {
    const r = parseMermaid(
      'graph LR\n A([Start]) --> B{Ok?}\n B -- yes --> C[(DB)]\n B -.->|no| D[[Doc]]\n D ==> E>Note]; E --- A',
    );
    if (isMermaidError(r)) throw new Error(r.error.message);
    expect(r.direction).toBe('LR');
    expect(r.nodes.map((n) => n.preset)).toEqual(['startEnd', 'decision', 'database', 'document', 'annotation']);
    expect(r.links.map((l) => [l.style, l.arrow, l.label])).toEqual([
      ['solid', true, undefined],
      ['solid', true, 'yes'],
      ['dotted', true, 'no'],
      ['thick', true, undefined],
      ['solid', false, undefined],
    ]);
  });

  it('reports the first error line', () => {
    const r = parseMermaid('flowchart TD\n A --> B\n\n C --> \n D[oops');
    expect(isMermaidError(r) && r.error.line).toBe(4);
  });

  it('round-trips', () => {
    const r = parseMermaid('flowchart BT\n A[/in/] -->|x| B\n B -.- A');
    if (isMermaidError(r)) throw new Error('parse');
    const again = parseMermaid(printMermaid(r));
    expect(again).toEqual(r);
  });
});
