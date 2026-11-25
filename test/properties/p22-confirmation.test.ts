// Feature: openboard, Property 22: Destructive confirmation messages
// **Validates: Requirements 14.17**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { shortAction } from '../../src/codemode/surface';
import {
  registerLmTools,
  type AgentRegistry,
  type LmApi,
  type LmToolImpl,
} from '../../src/host/agent/bridge';
import { buildConfirmation, isDestructiveInvocation } from '../../src/core/tools/confirm';
import { buildFullRegistry } from '../helpers/registry';

const RUNS = { numRuns: 150 };
const BATCH = 'openboard.batch';

function fakeLm() {
  const tools = new Map<string, LmToolImpl>();
  const lm: LmApi = {
    supportsImages: false,
    registerTool(name, impl) {
      tools.set(name, impl);
      return { dispose: () => tools.delete(name) };
    },
  };
  return { lm, tools };
}

/** The full registry; the LM surface is the five tools, destructive actions confirm via openboard_call. */
function buildAgent() {
  const { registry, defs } = buildFullRegistry();
  const agent = registry as unknown as AgentRegistry;
  const { lm, tools } = fakeLm();
  registerLmTools(lm, agent, {
    skill: () => ({ version: '0', topics: [] }),
    windowInfo: () => ({ workspaceName: 'w', folders: [], ide: 'Test' }),
  });
  return { agent, tools, defs };
}

/** `prepareInvocation` of openboard_call for a registry action. */
const prepareCall = (tool: string, input: unknown) =>
  tools.get('openboard_call')!.prepareInvocation({ input: { action: shortAction(tool), input } });

const { agent, tools, defs } = buildAgent();
const destructiveNames = [...defs.values()].filter((d) => d.destructive).map((d) => d.name);
const safeNames = [...defs.values()].filter((d) => !d.destructive).map((d) => d.name);

const text = fc.string({ unit: 'grapheme', maxLength: 600 });
const pathArb = fc.oneof(text, fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 800 }));

describe('Feature: openboard, Property 22: Destructive confirmation messages', () => {
  it('registry flags element.delete and arrange (cut) as destructive', () => {
    expect(destructiveNames).toContain('openboard.element.delete');
    expect(destructiveNames).toContain('openboard.element.arrange');
  });

  it('buildConfirmation: <=300 chars, keeps tool name, board path suffix and effect prefix', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme-ascii', minLength: 1, maxLength: 100 }),
        pathArb,
        fc.string({ unit: 'grapheme', minLength: 1, maxLength: 800 }),
        (tool, path, effect) => {
          const msg = buildConfirmation(tool, path, effect);
          expect(msg.length).toBeLessThanOrEqual(300);
          expect(msg.startsWith(tool)).toBe(true);
          if (`${tool} on ${path}: ${effect}`.length <= 300) {
            expect(msg).toBe(`${tool} on ${path}: ${effect}`);
          } else {
            const pathSuffix = path.slice(-10);
            expect(msg).toContain(pathSuffix);
            expect(msg).toContain(effect.slice(0, 10));
          }
        },
      ),
      RUNS,
    );
  });

  it('prepareInvocation: destructive tools get a bounded message with name, path suffix, effect prefix', () => {
    fc.assert(
      fc.property(fc.constantFrom(...destructiveNames), fc.option(pathArb, { nil: undefined }), (name, board) => {
        const p = prepareCall(name, board === undefined ? {} : { board });
        const msg = p.confirmationMessages?.message;
        expect(msg).toBeDefined();
        expect(msg!.length).toBeLessThanOrEqual(300);
        expect(msg).toContain(name);
        const path = typeof board === 'string' && board.length > 0 ? board : 'the active board';
        expect(msg).toContain(path.length <= 100 ? path : path.slice(-10));
        const effect = /^[^.\n]*\./.exec(agent.def(name).description)![0].trim();
        expect(msg).toContain(effect.slice(0, 10));
      }),
      RUNS,
    );
  });

  it('prepareInvocation: non-destructive tools get no confirmation', () => {
    fc.assert(
      fc.property(fc.constantFrom(...safeNames), fc.option(pathArb, { nil: undefined }), (name, board) => {
        const p = prepareCall(name, board === undefined ? {} : { board });
        expect(p.confirmationMessages).toBeUndefined();
      }),
      RUNS,
    );
  });

  it('batch is confirmed iff it contains a destructive operation', () => {
    const allNames = [...safeNames, ...destructiveNames, 'openboard.unknown'];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...allNames), { maxLength: 8 }),
        fc.option(pathArb, { nil: undefined }),
        (opTools, board) => {
          const operations = opTools.map((tool) => ({ tool, input: {} }));
          const input = board === undefined ? { operations } : { board, operations };
          const expected = opTools.some((t) => destructiveNames.includes(t));
          expect(isDestructiveInvocation(agent, BATCH, input)).toBe(expected);
          const p = prepareCall(BATCH, input);
          if (expected) {
            expect(p.confirmationMessages!.message.length).toBeLessThanOrEqual(300);
            expect(p.confirmationMessages!.message).toContain(BATCH);
          } else {
            expect(p.confirmationMessages).toBeUndefined();
          }
        },
      ),
      RUNS,
    );
  });
});
