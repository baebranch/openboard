// Feature: openboard, Property 20: Serial execution per board
// **Validates: Requirements 14.16**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { BoardDocument } from '../../src/core/model/types';
import { BoardModel, UndoHistory } from '../../src/core/ops';
import { SerialQueue } from '../../src/core/ops/serial-queue';
import { DefaultToolRegistry, type BoardResolver } from '../../src/core/tools/registry';

const doc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

const tick = (n: number) => new Promise<void>((r) => setTimeout(r, n));

describe('Feature: openboard, Property 20: Serial execution per board', () => {
  it('registry invocations on one board run in arrival order; failures do not block; boards are independent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ board: fc.constantFrom('a', 'b'), fail: fc.boolean() }), { minLength: 1, maxLength: 25 }),
        async (calls) => {
          const models: Record<string, BoardModel> = {
            a: new BoardModel('/a.openboard', doc(), { history: new UndoHistory() }),
            b: new BoardModel('/b.openboard', doc(), { history: new UndoHistory() }),
          };
          const resolver: BoardResolver = {
            resolve: (_def, input) => ({ ok: true, model: models[(input as { board: string }).board] }),
          };
          const registry = new DefaultToolRegistry({ resolver });
          const log: Record<string, number[]> = { a: [], b: [] };
          registry.register({
            name: 'test.step',
            description: 'records execution order',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            boardResolution: 'required-or-active',
            handler: (_ctx, input: { board: string; n: number; fail: boolean }) => {
              const seen = log[input.board]!.length;
              log[input.board]!.push(input.n);
              if (input.fail) throw new Error('boom');
              return { n: input.n, seen };
            },
          });

          const promises = calls.map((c, n) => registry.invoke('test.step', { board: c.board, n, fail: c.fail }));
          const results = (await Promise.all(promises)) as Array<Record<string, any>>;

          for (const board of ['a', 'b']) {
            const expected = calls.map((c, n) => ({ c, n })).filter((x) => x.c.board === board);
            expect(log[board]).toEqual(expected.map((x) => x.n));
            expected.forEach((x, i) => {
              const r = results[x.n]!;
              if (x.c.fail) expect(r.error).toBeDefined();
              else expect(r).toEqual({ n: x.n, seen: i }); // each sees all previous tasks' effects
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('SerialQueue runs async tasks non-overlapping in arrival order; rejections do not block', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            queue: fc.constantFrom(0, 1),
            delay: fc.integer({ min: 0, max: 2 }),
            fail: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (tasks) => {
          const queues = [new SerialQueue(), new SerialQueue()];
          const events: Array<{ q: number; i: number; ev: 'start' | 'end' }> = [];
          const promises = tasks.map((t, i) =>
            queues[t.queue]!.run(async () => {
              events.push({ q: t.queue, i, ev: 'start' });
              await tick(t.delay);
              events.push({ q: t.queue, i, ev: 'end' });
              if (t.fail) throw new Error('x');
              return i;
            }),
          );
          const settled = await Promise.allSettled(promises);

          settled.forEach((s, i) => {
            if (tasks[i]!.fail) expect(s.status).toBe('rejected');
            else expect(s).toEqual({ status: 'fulfilled', value: i });
          });
          for (const q of [0, 1]) {
            const ids = tasks.map((t, i) => ({ t, i })).filter((x) => x.t.queue === q).map((x) => x.i);
            const evs = events.filter((e) => e.q === q);
            // strictly start,end pairs in arrival order => no overlap
            expect(evs).toEqual(ids.flatMap((i) => [{ q, i, ev: 'start' }, { q, i, ev: 'end' }]));
          }
          expect(queues[0]!.size + queues[1]!.size).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  }, 60000);
});
