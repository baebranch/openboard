import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Ajv from 'ajv';
import { parse } from '../../src/core/format/parser';
import { buildBoardSchema } from '../../src/core/schema/board';
import { buildMessageSchemas } from '../../src/core/schema/messages';
import { createMessageValidation, type MessageValidators } from '../../src/shared/messages';
import type { Settings } from '../../src/core/settings/settings';
import type { Tx } from '../../src/core/ops/model';
import { loadFromBytes } from '../../src/host/editor/loader';
import { SessionHub, routeMessage } from '../../src/host/editor/session';
import { BoardDocumentState } from '../../src/host/editor/state';
import { SimulatedWebview, converged } from '../../src/host/editor/syncHarness';
import { arbEditSequence } from '../arbitraries';
import type { EditOp } from '../arbitraries';

const ajv = new Ajv({ strict: false, discriminator: true });
const schemas = buildMessageSchemas();
const validators = {
  validateWebviewToHost: ajv.compile(schemas['validateWebviewToHost']!),
  validateHostToWebview: ajv.compile(schemas['validateHostToWebview']!),
} as MessageValidators;
const validateBoard = ajv.compile(buildBoardSchema());
const logger = { warn: () => undefined };
const accept = createMessageValidation(validators, logger).accept;

function newState(): BoardDocumentState {
  return new BoardDocumentState('mem', loadFromBytes(new TextEncoder().encode(''), (t) => parse(t, { validator: validateBoard })));
}

/** Applies one abstract op as a single transaction; invalid ops roll back and emit nothing. */
function applyOp(state: BoardDocumentState, op: EditOp): void {
  const model = state.model!;
  const els = model.getDocument().elements;
  try {
    model.transact(op.kind, (tx: Tx) => {
      if (op.kind === 'add') {
        tx.create(op.element);
        return;
      }
      if (els.length === 0) throw new Error('no target');
      const el = els[op.target % els.length]!;
      const id = el.id;
      switch (op.kind) {
        case 'move':
          tx.update(id, { x: el.x + op.dx, y: el.y + op.dy });
          break;
        case 'resize':
          tx.update(id, { width: op.width, height: op.height });
          break;
        case 'rotate':
          tx.update(id, { rotation: op.rotation });
          break;
        case 'setOpacity':
          tx.update(id, { style: { opacity: op.opacity } });
          break;
        case 'toggleLock':
          tx.update(id, { locked: !el.locked });
          break;
        case 'delete':
          tx.remove(id);
          break;
        case 'reorder':
          tx.reorder([id], op.mode);
          break;
      }
    });
  } catch {
    // rolled back
  }
}

type Act = 'edit' | 'edit' | 'edit' | 'undo' | 'redo' | 'open' | 'close';
const arbStep = fc.record({
  tab: fc.integer({ min: 0, max: 3 }),
  act: fc.constantFrom<Act>('edit', 'edit', 'edit', 'undo', 'redo', 'open', 'close'),
});

// Feature: openboard, Property 62: Multi-tab replicas converge
// **Validates: Requirements 2.5**
describe('Feature: openboard, Property 62: Multi-tab replicas converge', () => {
  it('every open tab equals the host document after each step; revisions are monotonic', () => {
    fc.assert(
      fc.property(arbEditSequence(30), fc.array(arbStep, { minLength: 30, maxLength: 30 }), (ops, steps) => {
        const state = newState();
        const hub = new SessionHub(state);
        const deps = { state, accept, getSettings: () => ({}) as Settings, logger, hub };
        const open = new Map<number, { view: SimulatedWebview; off: () => void }>();
        let serial = 0;
        const openTab = (n: number): void => {
          if (open.has(n)) return;
          const view = new SimulatedWebview(`t${n}-${serial++}`);
          const off = hub.attach(view.session);
          routeMessage(deps, view.session, { type: 'ready' }); // late joiners converge via init
          open.set(n, { view, off });
        };
        openTab(0);
        const lastRev = new Map<SimulatedWebview, number>();

        steps.forEach((step, i) => {
          if (step.act === 'open') openTab(step.tab);
          else if (step.act === 'close') {
            if (open.size > 1) {
              open.get(step.tab)?.off();
              open.delete(step.tab);
            }
          } else {
            openTab(step.tab);
            const origin = open.get(step.tab)!.view;
            hub.runGesture(origin.session, `g${i}`, () => {
              if (step.act === 'edit') {
                if (ops.length > 0) applyOp(state, ops[i % ops.length]!);
              }
              else if (step.act === 'undo') state.history!.undo(state.model!);
              else state.history!.redo(state.model!);
            });
          }
          const views = [...open.values()].map((o) => o.view);
          expect(converged(state.getDocument(), views)).toBe(true);
          for (const v of views) {
            expect(v.gaps).toEqual([]);
            expect(v.revision).toBeGreaterThanOrEqual(lastRev.get(v) ?? 0);
            expect(v.revision).toBeLessThanOrEqual(state.revision);
            lastRev.set(v, v.revision);
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});
