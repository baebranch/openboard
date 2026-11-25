import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/core/format';
import type { BoardDocument } from '../../src/core/model/types';
import { ACTIONS, ActionId, buildAction } from '../../src/webview/actions';
import {
  RESIZE_HANDLES,
  connectOp,
  createOp,
  deleteOp,
  drawGeometry,
  freehandOp,
  moveOp,
  resizeBounds,
  resizeOp,
  rotateOp,
  selectionBounds,
  type DrawTool,
  type Op,
} from '../../src/webview/canvas/gestures';
import { buildUpdateOp } from '../../src/webview/properties/model';
import { arbBoardDocument } from '../arbitraries';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 16: UI and agent edits are equivalent
// **Validates: Requirements 13.12**

const NUM_RUNS = 100;
const TAG = 'Feature: openboard, Property 16: UI and agent edits are equivalent';

const DRAW_TOOLS: readonly DrawTool[] = ['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'frame', 'sticky', 'text'];
const ACTION_IDS = Object.keys(ACTIONS).filter((a) => a !== ActionId.Paste) as ActionId[];

const num = fc.double({ min: -2000, max: 2000, noNaN: true, noDefaultInfinity: true });
const pt = fc.record({ x: num, y: num });

const arbGesture = (doc: BoardDocument): fc.Arbitrary<Op | undefined> => {
  const els = doc.elements;
  const ids = els.map((e) => e.id);
  const pick = ids.length > 0 ? fc.subarray(ids, { minLength: 0 }) : fc.constant([] as string[]);
  const anyId = ids.length > 0 ? fc.constantFrom(...ids) : fc.constant('missing');
  // The UI never dispatches property/arrange/delete ops for an empty selection.
  const pickNE = ids.length > 0 ? fc.subarray(ids, { minLength: 1 }) : fc.constant(['missing']);
  return fc.oneof(
    fc.tuple(pick, num, num).map(([s, dx, dy]) => moveOp(els, s, dx, dy)),
    fc
      .tuple(pick, fc.constantFrom(...RESIZE_HANDLES), num, num, fc.boolean())
      .map(([s, h, dx, dy, keep]) => {
        const from = selectionBounds(els, s);
        return from ? resizeOp(els, s, from, resizeBounds(from, h, dx, dy, keep)) : undefined;
      }),
    fc.tuple(pick, fc.double({ min: -720, max: 720, noNaN: true })).map(([s, d]) => rotateOp(els, s, d)),
    fc
      .tuple(fc.constantFrom(...DRAW_TOOLS), pt, pt, fc.boolean(), fc.boolean())
      .map(([t, a, b, click, shift]) => createOp(t, drawGeometry(t, a, b, click, shift))),
    fc
      .tuple(
        fc.array(fc.record({ x: num, y: num, p: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }) }), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.boolean(),
      )
      .map(([samples, shift]) => freehandOp(samples.map((s) => (s.p === undefined ? { x: s.x, y: s.y } : s)), shift)),
    pickNE.map((s) => deleteOp(s)),
    fc
      .tuple(anyId, fc.option(anyId, { nil: undefined }), pt)
      .map(([s, t, drop]) => connectOp(s, t, drop)),
    fc.tuple(pickNE, fc.constantFrom('x', 'y', 'width', 'height', 'rotation', 'opacity'), num).map(([s, k, v]) =>
      buildUpdateOp(s, { [k]: v }),
    ),
    fc
      .tuple(pickNE, fc.constantFrom(...ACTION_IDS), fc.integer({ min: -5, max: 5 }), fc.integer({ min: -5, max: 5 }), fc.constantFrom(1 as const, 10 as const))
      .map(([s, a, dx, dy, amount]) => buildAction(a, { ids: s, dx, dy, amount }) as Op),
  );
};

const arbCase = arbBoardDocument(8).chain((doc) => arbGesture(doc).map((op) => ({ doc, op })));

/** Run one op on a fresh board with deterministic generated ids (so two runs are comparable). */
const run = async (doc: BoardDocument, op: Op) => {
  const env = buildFullRegistry({ doc: structuredClone(doc) });
  const real = globalThis.crypto.randomUUID.bind(globalThis.crypto);
  let n = 0;
  (globalThis.crypto as { randomUUID: () => string }).randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  try {
    const out = (await env.registry.invoke(op.tool, op.input)) as { error?: { code?: string } } | undefined;
    return { env, out };
  } finally {
    (globalThis.crypto as { randomUUID: () => string }).randomUUID = real;
  }
};

describe('Property 16: UI and agent edits are equivalent', () => {
  it(TAG, async () => {
    let applied = 0;
    await fc.assert(
      fc.asyncProperty(arbCase, async ({ doc, op }) => {
        if (!op) return;
        // The tool exists and the UI-built input satisfies its schema (not rejected as invalid).
        const probe = buildFullRegistry({ doc: structuredClone(doc) });
        expect(probe.registry.list()).toContain(op.tool);

        // UI path: the op as the webview produced it. Agent path: same tool, equal input (JSON round trip).
        const ui = await run(doc, op);
        const agent = await run(doc, { tool: op.tool, input: JSON.parse(JSON.stringify(op.input)) });

        expect(ui.out?.error?.code).not.toBe('invalid_input');
        expect(ui.out?.error?.code).not.toBe('unknown_tool');

        expect(serialize(ui.env.model.getDocument())).toBe(serialize(agent.env.model.getDocument()));
        expect(ui.env.history.undoCount()).toBe(agent.env.history.undoCount());
        expect(ui.env.history.undoCount()).toBeLessThanOrEqual(1);
        if (ui.env.history.undoCount() === 1) applied++;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(applied).toBeGreaterThan(0);
  });
});
