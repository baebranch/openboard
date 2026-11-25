import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format';
import { arbBoardDocument } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 35: Selection-required operations
// **Validates: Requirements 5.6, 5.7**

const ARRANGE = 'openboard.element.arrange';
const DELETE = 'openboard.element.delete';

type Call = { tool: string; input: Record<string, unknown> };

/** Operations that require a selection (or clipboard), invoked with nothing to act on. */
function emptyCalls(firstId: string | undefined): Call[] {
  const calls: Call[] = [
    { tool: DELETE, input: { ids: [] } },
    { tool: ARRANGE, input: { action: 'paste', clipboard: { elements: [] } } },
  ];
  for (const action of ['copy', 'cut', 'duplicate', 'group', 'ungroup']) {
    calls.push({ tool: ARRANGE, input: { action } });
    calls.push({ tool: ARRANGE, input: { action, ids: [] } });
  }
  if (firstId !== undefined) calls.push({ tool: ARRANGE, input: { action: 'group', ids: [firstId] } });
  return calls;
}

describe('Feature: openboard, Property 35: Selection-required operations', () => {
  it('Feature: openboard, Property 35: Selection-required operations (no selection: no change, no undo entry)', async () => {
    await fc.assert(
      fc.asyncProperty(arbBoardDocument(15), async (doc) => {
        const { registry, model, history } = buildFullRegistry({ doc });
        const before = serialize(model.getDocument());
        for (const call of emptyCalls(doc.elements[0]?.id)) {
          await registry.invoke(call.tool, call.input);
          expect(serialize(model.getDocument()), JSON.stringify(call)).toBe(before);
          expect(history.undoCount(), JSON.stringify(call)).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: openboard, Property 35: Selection-required operations (valid selection: exactly one undo entry, undo restores)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbBoardDocument(15).filter((d) => d.elements.length >= 2),
        fc.constantFrom('delete', 'cut', 'duplicate', 'group', 'ungroup', 'paste'),
        fc.nat(),
        async (doc, kind, seed) => {
          const { registry, model, history } = buildFullRegistry({ doc });
          const els = doc.elements;
          const a = els[seed % els.length]!;
          const b = els[(seed + 1) % els.length]!;
          const ids = [a.id, b.id];
          if (kind === 'ungroup') {
            await registry.invoke(ARRANGE, { action: 'group', ids });
            history.clear();
          }
          const before = serialize(model.getDocument());
          const call: Call =
            kind === 'delete'
              ? { tool: DELETE, input: { ids } }
              : kind === 'paste'
                ? { tool: ARRANGE, input: { action: 'paste', clipboard: { elements: [structuredClone(a)] } } }
                : { tool: ARRANGE, input: { action: kind, ids } };
          const out = (await registry.invoke(call.tool, call.input)) as { error?: unknown };
          expect(out.error, JSON.stringify(out)).toBeUndefined();
          expect(history.undoCount(), JSON.stringify(call)).toBe(1);
          expect(serialize(model.getDocument())).not.toBe(before);
          expect(history.undo(model)).toBe(true);
          expect(serialize(model.getDocument())).toBe(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
