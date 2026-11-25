import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HostBoardResolver, normalizeBoardPath, type BoardHost } from '../../src/core/tools/resolution';
import type { ToolDefinition } from '../../src/core/tools/registry';
import type { BoardModel } from '../../src/core/ops';

// Feature: openboard, Property 19: Board resolution
// **Validates: Requirements 14.9, 14.10, 14.11, 14.12, 14.13**

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f'];
const canonPath = fc.tuple(fc.constantFrom('x', 'y'), fc.constantFrom(...NAMES)).map(([d, n]) => `/ws/${d}/${n}.board`);

/** Spell a canonical path differently: backslashes, ./ segments, dir/../ detours. */
const spell = (p: string, { back, dot, detour }: { back: boolean; dot: boolean; detour: boolean }) => {
  let s = p;
  if (detour) s = s.replace('/ws/', '/ws/zz/../');
  if (dot) s = s.replace('/ws/', '/ws/./');
  return back ? s.replace(/\//g, '\\') : s;
};

interface FakeFields {
  path: string;
  doc: string;
}
type Fake = FakeFields;
const asModel = (f: Fake | undefined): BoardModel | undefined => f as unknown as BoardModel | undefined;
const mk = (path: string): Fake => ({ path, doc: `doc:${path}` });

const stateArb = fc
  .record({
    open: fc.uniqueArray(canonPath, { maxLength: 4 }),
    files: fc.uniqueArray(canonPath, { maxLength: 6 }),
    activeIdx: fc.option(fc.nat(10), { nil: undefined }),
  })
  .map(({ open, files, activeIdx }) => ({
    open,
    files: [...new Set([...files, ...open])],
    active: activeIdx !== undefined && open.length ? open[activeIdx % open.length] : undefined,
  }));

function setup(state: { open: string[]; files: string[]; active?: string }) {
  const models = new Map(state.open.map((p) => [p, mk(p)]));
  const files = new Set(state.files);
  const before = new Map([...models].map(([p, m]) => [p, m.doc]));
  const opened: string[] = [];
  const host: BoardHost = {
    isOpen: (p) => asModel(models.get(p)),
    exists: (p) => files.has(p),
    openInBackground: (p) => {
      opened.push(p);
      const m = mk(p);
      models.set(p, m);
      return asModel(m) as BoardModel;
    },
    activeBoard: () => (state.active ? asModel(models.get(state.active)) : undefined),
    openBoards: () => [...models.keys()],
    isWorkspaceTrusted: () => true,
  };
  return { host, models, files, before, opened };
}

const def = (boardResolution: ToolDefinition['boardResolution']): ToolDefinition =>
  ({ name: 't', description: 'd', inputSchema: {}, outputSchema: {}, boardResolution, handler: () => ({}) }) as ToolDefinition;

describe('Property 19: Board resolution', () => {
  it('Feature: openboard, Property 19: Board resolution', async () => {
    await fc.assert(
      fc.asyncProperty(
        stateArb,
        canonPath,
        fc.boolean(),
        fc.boolean(),
        fc.record({ back: fc.boolean(), dot: fc.boolean(), detour: fc.boolean() }),
        fc.nat(10),
        async (state, target0, given, preferOpen, style, idx) => {
          // target: an open board, an existing one, or an arbitrary (often missing) one
          const pool = preferOpen && state.open.length ? state.open : state.files.length && idx % 2 ? state.files : [target0];
          const target = given ? pool[idx % pool.length]! : undefined;
          const spelled = target === undefined ? undefined : spell(target, style);
          const { host, models, files, before, opened } = setup(state);
          const filesBefore = [...files];
          const resolver = new HostBoardResolver(host);
          const input = spelled === undefined ? {} : { board: spelled };
          const res = await resolver.resolve(def('required-or-active'), input);
          const norm = target;

          // never creates files, never mutates existing docs
          expect([...files]).toEqual(filesBefore);
          for (const [p, d] of before) expect(models.get(p)!.doc).toBe(d);

          if (norm !== undefined) {
            expect(normalizeBoardPath(spelled!)).toBe(norm);
            if (state.open.includes(norm)) {
              expect(res).toEqual({ ok: true, model: models.get(norm) });
              expect(opened).toEqual([]);
            } else if (files.has(norm)) {
              expect(res.ok).toBe(true);
              expect(opened).toEqual([norm]); // opened in background
              if (res.ok) expect((res.model as unknown as Fake).path).toBe(norm);
            } else {
              expect(opened).toEqual([]);
              expect(res.ok).toBe(false);
              if (!res.ok) {
                expect(res.error.code).toBe('not_found');
                expect(res.error.message).toContain(norm);
              }
            }
          } else if (state.active) {
            expect(res).toEqual({ ok: true, model: models.get(state.active) });
            expect(opened).toEqual([]);
          } else {
            expect(opened).toEqual([]);
            expect(res.ok).toBe(false);
            if (!res.ok) {
              expect(res.error.code).toBe('no_active_board');
              for (const p of state.open) expect(res.error.message).toContain(p);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
