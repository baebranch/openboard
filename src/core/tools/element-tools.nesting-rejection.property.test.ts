import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BoardModel } from '../ops';
import type { BoardDocument } from '../model/types';
import type { HistoryEntry } from '../ops/patches';
import { DefaultToolRegistry } from './registry';
import { registerElementTools } from './element-tools';
import { registerArrangeTools } from './arrange-tools';

const emptyDoc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

const MAX_DEPTH = 16;

async function setup() {
  const entries: HistoryEntry[] = [];
  const model = new BoardModel('/b.openboard', emptyDoc(), { history: { push: (e: HistoryEntry) => void entries.push(e) } });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerElementTools(reg);
  registerArrangeTools(reg);
  const run = (n: string, i: unknown) => reg.invoke(n, i) as Promise<any>;
  return { model, entries, run };
}

/** Creates a chain `${prefix}0` (root) ... `${prefix}${n-1}` (deepest), each the parent of the next. */
async function makeChain(run: (n: string, i: unknown) => Promise<any>, prefix: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${prefix}${i}`;
    const r = await run('openboard.element.create', {
      elements: [{ type: 'frame', id, x: 0, y: 0, width: 10, height: 10, ...(i > 0 ? { parentId: ids[i - 1] } : {}) }],
    });
    expect(r.error).toBeUndefined();
    ids.push(id);
  }
  return ids;
}

describe('Property 31: nested-frame edit rejection invariant', () => {
  /** **Validates: Requirements 21.6** */
  it('rejects edits that make a Frame its own ancestor, leaving document and history unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.nat(),
        fc.nat(),
        fc.constantFrom('update', 'moveIntoFrame'),
        async (n, a, b, how) => {
          const { model, entries, run } = await setup();
          const chain = await makeChain(run, 'f', n);
          // child index i, new parent index j with j >= i: j is the child itself or one of its descendants.
          const i = a % n;
          const j = i + (b % (n - i));
          const docBefore = JSON.stringify(model.getDocument());
          const histBefore = entries.length;
          const r =
            how === 'update'
              ? await run('openboard.element.update', { ids: [chain[i]], set: { parentId: chain[j] } })
              : await run('openboard.element.arrange', { action: 'moveIntoFrame', ids: [chain[i]], targetId: chain[j] });
          expect(r.error).toBeDefined();
          expect(JSON.stringify(model.getDocument())).toBe(docBefore);
          expect(entries.length).toBe(histBefore);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('rejects edits that push any Frame deeper than 16, leaving document and history unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: MAX_DEPTH }), // depth of the target chain
        fc.integer({ min: 1, max: MAX_DEPTH }), // depth of the moved subtree
        fc.constantFrom('update', 'moveIntoFrame', 'create'),
        async (targetDepth, subDepth, how) => {
          fc.pre(targetDepth + subDepth > MAX_DEPTH);
          const { model, entries, run } = await setup();
          const target = await makeChain(run, 't', targetDepth);
          const deepest = target[targetDepth - 1] as string;
          const sub = how === 'create' ? [] : await makeChain(run, 's', subDepth);
          const docBefore = JSON.stringify(model.getDocument());
          const histBefore = entries.length;
          let r: any;
          if (how === 'update') r = await run('openboard.element.update', { ids: [sub[0]], set: { parentId: deepest } });
          else if (how === 'moveIntoFrame') {
            r = await run('openboard.element.arrange', { action: 'moveIntoFrame', ids: [sub[0]], targetId: deepest });
          } else if (targetDepth === MAX_DEPTH) {
            r = await run('openboard.element.create', {
              elements: [{ type: 'frame', id: 'new', x: 0, y: 0, width: 5, height: 5, parentId: deepest }],
            });
          } else {
            return;
          }
          expect(r.error).toBeDefined();
          expect(JSON.stringify(model.getDocument())).toBe(docBefore);
          expect(entries.length).toBe(histBefore);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('accepts a move landing exactly at depth 16 (boundary control)', async () => {
    const { run, model } = await setup();
    const target = await makeChain(run, 't', 10);
    const sub = await makeChain(run, 's', 6);
    const r = await run('openboard.element.update', { ids: [sub[0]], set: { parentId: target[9] } });
    expect(r.error).toBeUndefined();
    expect(model.getDocument().elements.find((e) => e.id === 's5')).toBeDefined();
  });
});
