import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format';
import { arbBoardDocument } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 45: Component library names
// **Validates: Requirements 6.15, 6.16**

interface Listed {
  components: Array<{ id: string; name: string; builtin: boolean }>;
}
type Err = { error?: unknown };

const BUILTIN_IDS = [
  ['button', 'builtin:button'],
  ['input field', 'builtin:input-field'],
  ['card', 'builtin:card'],
  ['navigation bar', 'builtin:navigation-bar'],
  ['device outline', 'builtin:device-outline'],
] as const;

const alnum = fc.stringMatching(/^[A-Za-z0-9]+$/);
const validNameArb = alnum.chain((s) => fc.integer({ min: 1, max: 100 }).map((n) => s.repeat(Math.ceil(n / s.length)).slice(0, n)));
const longNameArb = fc.integer({ min: 101, max: 300 }).map((n) => 'n'.repeat(n));

const docArb = arbBoardDocument(15).filter((d) => d.elements.some((e) => e.type !== 'edge'));

const list = async (r: ReturnType<typeof buildFullRegistry>) => (await r.registry.invoke('openboard.library.list', {})) as Listed;

describe('Feature: openboard, Property 45: Component library names', () => {
  it('saves components with 1..100 char names and a non-empty selection', async () => {
    await fc.assert(
      fc.asyncProperty(docArb, validNameArb, fc.nat(), async (doc, name, pick) => {
        const r = buildFullRegistry({ doc });
        const ids = doc.elements.filter((e) => e.type !== 'edge').map((e) => e.id);
        const chosen = ids.slice(0, (pick % ids.length) + 1);
        const before = (await list(r)).components.length;
        const undoBefore = r.history.undoCount();

        const out = (await r.registry.invoke('openboard.library.save', { name, ids: chosen })) as Err;
        expect(out.error).toBeUndefined();

        const after = (await list(r)).components;
        expect(after.length).toBe(before + 1);
        expect(after.some((c) => c.name === name && !c.builtin)).toBe(true);
        expect(r.history.undoCount()).toBe(undoBefore + 1);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects empty names, names over 100 chars, and empty selections without changes', async () => {
    const badArb = fc.oneof(
      fc.record({ kind: fc.constant('empty-name'), name: fc.constant('') }),
      fc.record({ kind: fc.constant('long-name'), name: longNameArb }),
      fc.record({ kind: fc.constant('empty-selection'), name: validNameArb }),
    );
    await fc.assert(
      fc.asyncProperty(docArb, badArb, async (doc, bad) => {
        const r = buildFullRegistry({ doc });
        const ids = doc.elements.filter((e) => e.type !== 'edge').map((e) => e.id);
        const before = serialize(r.model.getDocument());
        const listBefore = await list(r);
        const undoBefore = r.history.undoCount();

        const input = bad.kind === 'empty-selection' ? { name: bad.name } : { name: bad.name, ids: [ids[0]] };
        const out = (await r.registry.invoke('openboard.library.save', input)) as Err;
        expect(out.error).toBeDefined();

        expect(serialize(r.model.getDocument())).toBe(before);
        expect(await list(r)).toEqual(listBefore);
        expect(r.history.undoCount()).toBe(undoBefore);
      }),
      { numRuns: 100 },
    );
  });

  it('always lists and can insert the built-in components', async () => {
    await fc.assert(
      fc.asyncProperty(docArb, fc.constantFrom(...BUILTIN_IDS), async (doc, [name, id]) => {
        const r = buildFullRegistry({ doc });
        const listed = (await list(r)).components;
        expect(listed.some((c) => c.id === id && c.name === name && c.builtin)).toBe(true);

        const count = r.model.getDocument().elements.length;
        const out = (await r.registry.invoke('openboard.library.insert', { component: id })) as Err & { ids?: string[] };
        expect(out.error).toBeUndefined();
        expect(out.ids!.length).toBeGreaterThan(0);
        expect(r.model.getDocument().elements.length).toBe(count + out.ids!.length);
      }),
      { numRuns: 100 },
    );
  });
});
