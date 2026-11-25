import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format';
import { arbBoardDocument } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 18: Missing references leave the document unchanged
// **Validates: Requirements 13.17, 14.13**

interface ToolErr {
  error: { code: string; message?: string };
}

const arbMissing = fc.stringMatching(/^[a-z0-9]{1,12}$/).map((s) => `missing-${s}`);

type Call = { tool: string; input: Record<string, unknown> };

/** Calls that reference `missing`, mixing in valid ids from the document where possible. */
function callsFor(doc: { elements: { id: string; type: string }[] }, missing: string): Call[] {
  const validIds = doc.elements.slice(0, 3).map((e) => e.id);
  const nonEdge = doc.elements.find((e) => e.type !== 'edge')?.id;
  const calls: Call[] = [
    { tool: 'openboard.element.update', input: { ids: [...validIds, missing], set: { locked: true } } },
    { tool: 'openboard.element.update', input: { ids: [missing], set: { locked: true } } },
    { tool: 'openboard.element.delete', input: { ids: [...validIds, missing] } },
    { tool: 'openboard.element.delete', input: { ids: [missing] } },
    { tool: 'openboard.element.arrange', input: { action: 'group', ids: [...validIds, missing] } },
    { tool: 'openboard.element.arrange', input: { action: 'duplicate', ids: [...validIds, missing] } },
    { tool: 'openboard.element.arrange', input: { action: 'nudge', ids: [...validIds, missing], dx: 1 } },
    { tool: 'openboard.element.arrange', input: { action: 'cut', ids: [...validIds, missing] } },
    { tool: 'openboard.layout', input: { ids: [...validIds, missing] } },
    { tool: 'openboard.import', input: { source: 'component', component: missing } },
    { tool: 'openboard.connect', input: { edges: [{ sourceId: missing, toPosition: { x: 0, y: 0 } }] } },
    { tool: 'openboard.connect', input: { edges: [{ sourceId: missing, targetId: missing }] } },
  ];
  if (nonEdge !== undefined) {
    calls.push(
      { tool: 'openboard.connect', input: { edges: [{ sourceId: nonEdge, targetId: missing }] } },
      { tool: 'openboard.connect', input: { edges: [{ sourceId: missing, targetId: nonEdge }] } },
      { tool: 'openboard.connect', input: { edges: [{ sourceId: nonEdge, targetId: nonEdge }, { sourceId: nonEdge, targetId: missing }] } },
    );
  }
  return calls;
}

describe('Feature: openboard, Property 18: Missing references leave the document unchanged', () => {
  it('a nonexistent element, component, or endpoint id yields not_found and no change', async () => {
    await fc.assert(
      fc.asyncProperty(arbBoardDocument(15), arbMissing, async (doc, missing) => {
        const { registry, model, history } = buildFullRegistry({ doc });
        const before = serialize(model.getDocument());
        const undoBefore = history.undoCount();
        for (const call of callsFor(doc, missing)) {
          const out = (await registry.invoke(call.tool, call.input)) as ToolErr;
          expect(out.error, `${call.tool} ${JSON.stringify(call.input)}`).toBeDefined();
          expect(out.error.code).toBe('not_found');
          expect(out.error.message).toContain(missing);
          expect(serialize(model.getDocument())).toBe(before);
          expect(history.undoCount()).toBe(undoBefore);
        }
      }),
      { numRuns: 100 },
    );
  });
});
