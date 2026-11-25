import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BoardModel, UndoHistory } from '../ops';
import type { BoardDocument } from '../model/types';
import { DefaultToolRegistry } from './registry';
import { ToolSession } from './session';
import { registerElementTools } from './element-tools';
import { executeScript } from '../../codemode/execute';
import { FIELDS, buildUpdateOp, commitField, initFieldState } from '../../webview/properties/model';
import { TOOL_ELEMENT_CREATE } from '../../webview/canvas/gestures';

const emptyDoc = (): BoardDocument => ({
  schemaVersion: 1,
  meta: { id: 'b' },
  viewport: { x: 0, y: 0, zoom: 1 },
  elements: [],
  assets: [],
  library: [],
});

function setup() {
  const history = new UndoHistory();
  const model = new BoardModel('/b.openboard', emptyDoc(), { history });
  const reg = new DefaultToolRegistry({ resolver: { resolve: () => ({ ok: true, model }) } });
  registerElementTools(reg);
  const entries = (): number => (history as unknown as { undoStack: unknown[] }).undoStack.length;
  return { model, reg, entries };
}
/** Document without the wall-clock `meta.modifiedAt`, which legitimately differs between runs. */
const snap = (env: { model: BoardModel }): BoardDocument => {
  const d = structuredClone(env.model.getDocument());
  delete (d.meta as { modifiedAt?: string }).modifiedAt;
  return d;
};
type Env = ReturnType<typeof setup>;

const TYPES = ['rectangle', 'ellipse', 'frame'] as const;
const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, '0')}`);

/** Each entry is one valid ElementPatch field (flat, as the tools and the panel accept it). */
const patchArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record(
    {
      x: fc.integer({ min: -500, max: 500 }),
      y: fc.integer({ min: -500, max: 500 }),
      width: fc.integer({ min: 10, max: 500 }),
      height: fc.integer({ min: 10, max: 500 }),
      rotation: fc.integer({ min: 0, max: 359 }),
      opacity: fc.integer({ min: 0, max: 100 }),
      strokeWidth: fc.integer({ min: 0, max: 20 }),
      fill: hex,
      stroke: hex,
      strokeStyle: fc.constantFrom('solid', 'dashed', 'dotted'),
    },
    { requiredKeys: [] },
  )
  .filter((p) => Object.keys(p).length > 0);

const createArb = fc.record({ type: fc.constantFrom(...TYPES), patch: patchArb });

/** Runs `script` through code mode against `env`, with a session like the host bridge uses. */
async function viaCodeMode(env: Env, code: string): Promise<void> {
  const session = new ToolSession();
  const r = await executeScript(
    { code },
    {
      invoke: (n, i) => session.invoke(env.reg, n, i),
      finish: async (commit) => {
        if (commit) session.commit();
        else session.rollback();
      },
    },
  );
  expect(r.ok).toBe(true);
}

const check = (r: unknown): void => expect((r as { error?: unknown }).error).toBeUndefined();

async function seed(env: Env, type: string): Promise<void> {
  check(await env.reg.invoke('openboard.element.create', { elements: [{ type, id: 'e', x: 0, y: 0, width: 100, height: 80 }] }));
}

describe('Property 33: cross-surface edit equivalence', () => {
  /** **Validates: Requirements 28.5** */
  it('creates the same document with one history entry through the UI op, the MCP tool and a code-mode script', async () => {
    await fc.assert(
      fc.asyncProperty(createArb, async ({ type, patch }) => {
        const el = { type, id: 'e', x: 0, y: 0, width: 100, height: 80, ...patch };
        const ui = setup();
        const mcp = setup();
        const code = setup();
        check(await ui.reg.invoke(TOOL_ELEMENT_CREATE, { elements: [el] }));
        check(await mcp.reg.invoke('openboard.element.create', { elements: [el] }));
        await viaCodeMode(code, `return await ob.board().create(${JSON.stringify([el])});`);
        for (const env of [ui, mcp, code]) expect(env.entries()).toBe(1);
        expect(snap(mcp)).toEqual(snap(ui));
        expect(snap(code)).toEqual(snap(ui));
      }),
      { numRuns: 50 },
    );
  });

  /** **Validates: Requirements 28.5** */
  it('updates the same document with one added history entry through the panel op, the MCP tool and a code-mode script', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TYPES), patchArb, async (type, patch) => {
        const ui = setup();
        const mcp = setup();
        const code = setup();
        for (const env of [ui, mcp, code]) await seed(env, type);
        const before = ui.entries();

        // Panel path: a single numeric/colour/enum field goes through commitField, the rest through buildUpdateOp.
        const keys = Object.keys(patch);
        const def = keys.length === 1 ? FIELDS.find((f) => f.name === keys[0]) : undefined;
        const target = ui.model.getDocument().elements[0]!;
        let op: { tool: string; input: unknown } = buildUpdateOp(['e'], patch);
        if (def) {
          const out = commitField(initFieldState([target], def.name), def, String(patch[def.name]), [target]);
          // An unchanged value commits nothing; the panel then dispatches nothing.
          if (out.op) op = out.op;
          else op = { tool: 'openboard.element.update', input: { ids: ['e'], set: {} } };
        }
        if (op.tool === 'openboard.batch') throw new Error('unexpected batch op');
        if (Object.keys((op.input as { set: object }).set).length === 0) return;
        check(await ui.reg.invoke(op.tool, op.input));

        check(await mcp.reg.invoke('openboard.element.update', { ids: ['e'], set: patch }));
        await viaCodeMode(code, `return await ob.board().update(['e'], ${JSON.stringify(patch)});`);

        for (const env of [ui, mcp, code]) expect(env.entries()).toBe(before + 1);
        expect(snap(mcp)).toEqual(snap(ui));
        expect(snap(code)).toEqual(snap(ui));
      }),
      { numRuns: 50 },
    );
  });
});
