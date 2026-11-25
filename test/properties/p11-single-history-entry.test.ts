import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format';
import type { BoardDocument } from '../../src/core/model/types';
import { arbBoardDocument } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 11: Successful tool invocation is one history entry
// **Validates: Requirements 10.6, 13.11**

const NUM_RUNS = 100;
const MERMAID = 'graph TD\n  A[Start] --> B[End]';

/** Placeholders replaced by the real ids of the four setup elements. */
const IDS = { r1: '$r1', r2: '$r2', f1: '$f1', f2: '$f2' };
interface Call {
  tool: string;
  input: Record<string, unknown>;
}

const coord = fc.integer({ min: -1000, max: 1000 });
const point = fc.record({ x: coord, y: coord });

const rectCreate = (p: { x: number; y: number }): Call => ({
  tool: 'openboard.element.create',
  input: { elements: [{ type: 'rectangle', x: p.x, y: p.y, width: 80, height: 40 }] },
});

const arrange = (input: Record<string, unknown>): Call => ({ tool: 'openboard.element.arrange', input });

/** Mutating calls (valid against the setup elements) that normally change the document. */
const mutatingArb: fc.Arbitrary<Call> = fc.oneof(
  point.map(rectCreate),
  fc.tuple(point, point).map(([a, b]): Call => ({
    tool: 'openboard.element.create',
    input: {
      elements: [
        { type: 'ellipse', x: a.x, y: a.y, width: 50, height: 50 },
        { type: 'sticky', x: b.x, y: b.y, text: 'hi' },
      ],
    },
  })),
  fc.integer({ min: 5000, max: 6000 }).map((x): Call => ({
    tool: 'openboard.element.update',
    input: { ids: [IDS.r1, IDS.r2], set: { x } },
  })),
  fc.constantFrom(IDS.r1, IDS.r2, IDS.f1).map((id): Call => ({ tool: 'openboard.element.delete', input: { ids: [id] } })),
  fc.constantFrom('left', 'right', 'top', 'bottom', 'center', 'middle').map((alignment) =>
    arrange({ action: 'align', ids: [IDS.r1, IDS.r2], alignment }),
  ),
  fc.constant(arrange({ action: 'group', ids: [IDS.r1, IDS.r2] })),
  fc.constant(arrange({ action: 'duplicate', ids: [IDS.r1, IDS.f1] })),
  fc.constantFrom('front', 'back').map((mode) => arrange({ action: 'zorder', ids: [IDS.r1], mode })),
  fc.integer({ min: 1, max: 5 }).map((dx) => arrange({ action: 'nudge', ids: [IDS.r1, IDS.f1], dx, dy: 1, amount: 10 })),
  fc.constantFrom('straight', 'curved', 'orthogonal').map((routing): Call => ({
    tool: 'openboard.connect',
    input: { edges: [{ sourceId: IDS.f1, targetId: IDS.f2, routing }] },
  })),
  point.map((toPosition): Call => ({
    tool: 'openboard.connect',
    input: { edges: [{ sourceId: IDS.f1, toPosition }] },
  })),
  fc.constantFrom('TB', 'LR', 'BT', 'RL').map((direction): Call => ({
    tool: 'openboard.layout',
    input: { ids: [IDS.f1, IDS.f2], direction },
  })),
  fc.constant<Call>({ tool: 'openboard.import', input: { source: 'mermaid', text: MERMAID } }),
  fc.tuple(fc.constantFrom('button', 'card', 'input field', 'device outline'), point).map(
    ([component, p]): Call => ({ tool: 'openboard.import', input: { source: 'component', component, x: p.x, y: p.y } }),
  ),
  fc.stringMatching(/^[a-z]{1,20}$/).map((name): Call => ({
    tool: 'openboard.library.save',
    input: { name, ids: [IDS.r1, IDS.r2] },
  })),
  fc.tuple(fc.constantFrom('button', 'card', 'navigation bar'), point).map(
    ([component, p]): Call => ({ tool: 'openboard.library.insert', input: { component, x: p.x, y: p.y } }),
  ),
  fc.array(point, { minLength: 1, maxLength: 6 }).map((ps): Call => ({
    tool: 'openboard.batch',
    input: { operations: ps.map(rectCreate) },
  })),
);

const readOnlyCalls: Call[] = [
  { tool: 'openboard.element.query', input: {} },
  { tool: 'openboard.board.summary', input: {} },
  { tool: 'openboard.schema', input: {} },
  { tool: 'openboard.board.preview', input: {} },
  { tool: 'openboard.board.list', input: {} },
  { tool: 'openboard.library.list', input: {} },
];

async function setup(doc: BoardDocument) {
  const env = buildFullRegistry({ doc });
  const created = (await env.registry.invoke('openboard.element.create', {
    elements: [
      { type: 'rectangle', x: 0, y: 0, width: 60, height: 30 },
      { type: 'rectangle', x: 300, y: 120, width: 90, height: 50 },
      { type: 'flowNode', x: 10, y: 400, text: 'one' },
      { type: 'flowNode', x: 500, y: 20, text: 'two' },
    ],
  })) as { ids?: string[]; error?: unknown };
  expect(created.error).toBeUndefined();
  const [r1, r2, f1, f2] = created.ids as [string, string, string, string];
  const real: Record<string, string> = { [IDS.r1]: r1, [IDS.r2]: r2, [IDS.f1]: f1, [IDS.f2]: f2 };
  const bind = (call: Call): Call =>
    JSON.parse(JSON.stringify(call), (_k, v: unknown) => (typeof v === 'string' && v in real ? real[v] : v)) as Call;
  return { env, bind };
}

describe('Feature: openboard, Property 11: Successful tool invocation is one history entry', () => {
  it('a successful mutating call adds exactly one undo entry and one undo restores the document byte-identically', async () => {
    let changedRuns = 0;
    await fc.assert(
      fc.asyncProperty(arbBoardDocument(10), mutatingArb, async (doc, rawCall) => {
        const { env, bind } = await setup(doc);
        const call = bind(rawCall);
        const before = serialize(env.model.getDocument());
        const undo = env.history.undoCount();
        const out = (await env.registry.invoke(call.tool, call.input)) as { error?: unknown; ok?: boolean };
        const failed = out.error !== undefined || out.ok === false;
        const after = serialize(env.model.getDocument());
        if (failed || after === before) {
          // A rejected or no-op call records nothing.
          expect(env.history.undoCount()).toBe(undo);
          expect(after).toBe(before);
          return;
        }
        changedRuns++;
        expect(env.history.undoCount()).toBe(undo + 1);
        expect(env.history.undo(env.model)).toBe(true);
        expect(serialize(env.model.getDocument())).toBe(before);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(changedRuns).toBeGreaterThan(NUM_RUNS / 2);
  });

  it('read-only tools add no undo entry and leave the document unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(arbBoardDocument(10), fc.constantFrom(...readOnlyCalls), async (doc, call) => {
        const { env } = await setup(doc);
        const before = serialize(env.model.getDocument());
        const undo = env.history.undoCount();
        await env.registry.invoke(call.tool, call.input);
        expect(env.history.undoCount()).toBe(undo);
        expect(serialize(env.model.getDocument())).toBe(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
