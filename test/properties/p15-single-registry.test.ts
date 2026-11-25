import fc from 'fast-check';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPOSED_TOOL_NAMES, shortAction } from '../../src/codemode/surface';
import {
  createApi,
  createInvokeToolCommand,
  registerLmTools,
  type AgentRegistry,
  type LmApi,
  type LmSurfaceOptions,
  type LmToolImpl,
} from '../../src/host/agent/bridge';
import { buildFullRegistry } from '../helpers/registry';
import { loadSkill } from '../helpers/skill';

// Feature: openboard, Property 15: One registry feeds all exposure paths
// The exported API, openboard.invokeTool and the LM tools all go through the one registry; the LM
// tools are the five polymorphic tools and reach every registry action generically.
// **Validates: Requirements 13.3, 13.13, 14.2, 14.3**

const agentOf = () => {
  const full = buildFullRegistry();
  return full.registry as unknown as AgentRegistry;
};

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

const surfaceFor = (agent: AgentRegistry): LmSurfaceOptions => ({
  skill: () => loadSkill(agent),
  windowInfo: () => ({ workspaceName: 'w', folders: [], ide: 'Test' }),
});

const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null));

const elementsArb = fc.array(
  fc.record({
    type: fc.constantFrom('rectangle', 'ellipse'),
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
    width: fc.integer({ min: 1, max: 400 }),
    height: fc.integer({ min: 1, max: 400 }),
  }),
  { minLength: 1, maxLength: 5 },
).map((els) => els.map((e, i) => ({ ...e, id: `e${i}` })));

describe('Property 15: One registry feeds all exposure paths', () => {
  it('Feature: openboard, Property 15: One registry feeds all exposure paths', async () => {
    // Sanity: the tool is valid, so the property below is not vacuous.
    const probe = agentOf();
    const ok = (await probe.invoke('openboard.element.create', { elements: [{ type: 'rectangle', id: 'p' }] })) as {
      ids: string[];
    };
    expect(ok.ids).toEqual(['p']);

    await fc.assert(
      fc.asyncProperty(elementsArb, fc.boolean(), async (elements, asString) => {
        const input = { elements };
        const viaRegistry = agentOf();
        const viaLm = agentOf();
        const viaApi = agentOf();
        const viaCmd = agentOf();

        const { lm, tools } = fakeLm();
        registerLmTools(lm, viaLm, surfaceFor(viaLm));
        const api = createApi(viaApi);
        const cmd = createInvokeToolCommand(viaCmd);

        // Names: registry list() == API list() == command-reachable names; LM tools == the five.
        const names = viaRegistry.list();
        expect(names.length).toBe(40);
        expect(api.list()).toEqual(names);
        expect(viaCmd.list()).toEqual(names);
        expect([...tools.keys()].sort()).toEqual([...EXPOSED_TOOL_NAMES].sort());
        expect(Object.keys(api).sort()).toEqual(['describe', 'invoke', 'list']);
        for (const n of names) {
          expect(api.describe(n)).toEqual(viaRegistry.describe(n));
          await expect(cmd(n, '{"__probe":1}').then(() => 'reached', (e: Error) => e.name)).resolves.not.toBe(
            'InvalidArgumentError',
          );
        }

        // Identical results for identical input on identically seeded boards
        const call = (action: string, body: unknown) => tools.get('openboard_call')!.invoke({ input: { action, input: body } });
        const direct = json(await viaRegistry.invoke('openboard.element.create', input));
        const lmResult = JSON.parse(((await call(shortAction('openboard.element.create'), input))[0] as { text: string }).text);
        const apiResult = json(await api.invoke('openboard.element.create', input));
        const cmdResult = json(await cmd('openboard.element.create', asString ? JSON.stringify(input) : input));

        expect(lmResult).toEqual(direct);
        expect(apiResult).toEqual(direct);
        expect(cmdResult).toEqual(direct);

        // Follow-up query also agrees through every path
        const q = { ids: elements.map((e) => e.id) };
        const dq = json(await viaRegistry.invoke('openboard.element.query', q));
        const lq = JSON.parse(((await call('element.query', q))[0] as { text: string }).text);
        expect(lq).toEqual(dq);
        expect(json(await api.invoke('openboard.element.query', q))).toEqual(dq);
        expect(json(await cmd('openboard.element.query', q))).toEqual(dq);
      }),
      { numRuns: 100 },
    );
  });

  it('manifest languageModelTools names equal the exposed tool names when present', () => {
    const pkgPath = resolve(__dirname, '../../package.json');
    if (!existsSync(pkgPath)) return;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      contributes?: { languageModelTools?: { name: string }[] };
    };
    const tools = pkg.contributes?.languageModelTools;
    if (!tools) return;
    expect(tools.map((t) => t.name)).toEqual([...EXPOSED_TOOL_NAMES]);
  });
});
