import { describe, expect, it } from 'vitest';
import {
  InvalidArgumentError,
  createApi,
  createInvokeToolCommand,
  formatResult,
  registerLmTools,
  type AgentRegistry,
  type LmApi,
  type LmSurfaceOptions,
  type LmToolImpl,
} from './bridge';
import { DefaultToolRegistry } from '../../core/tools/registry';
import { EXPOSED_TOOL_NAMES } from '../../codemode/surface';
import { s } from '../../core/schema/builder';

function makeRegistry(): { reg: DefaultToolRegistry; agent: AgentRegistry } {
  const reg = new DefaultToolRegistry();
  reg.register({
    name: 'test.echo',
    description: 'Echo back.',
    inputSchema: s.object({ v: s.opt(s.string()) }),
    outputSchema: s.object({ v: s.opt(s.string()) }),
    boardResolution: 'none',
    handler: (_c, i: { v?: string }) => ({ v: i.v }),
  });
  reg.register({
    name: 'test.wipe',
    description: 'Wipes everything. More detail.',
    inputSchema: s.object({ board: s.opt(s.string()) }),
    outputSchema: s.object({}),
    destructive: true,
    boardResolution: 'none',
    handler: () => ({}),
  });
  reg.register({
    name: 'test.img',
    description: 'Image.',
    inputSchema: s.object({}),
    outputSchema: s.object({ mimeType: s.string(), data: s.string() }),
    boardResolution: 'none',
    handler: () => ({ mimeType: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') }),
  });
  return { reg, agent: reg as unknown as AgentRegistry };
}

function fakeLm(supportsImages: boolean) {
  const tools = new Map<string, LmToolImpl>();
  const lm: LmApi = {
    supportsImages,
    registerTool(name, impl) {
      tools.set(name, impl);
      return { dispose: () => tools.delete(name) };
    },
  };
  return { lm, tools };
}

const surface = (log?: (m: string) => void): LmSurfaceOptions => ({
  skill: () => ({ version: '0', topics: [{ id: 'overview', summary: 'about', content: '# Overview' }] }),
  windowInfo: () => ({ workspaceName: 'w', folders: ['/w'], ide: 'Test' }),
  ...(log ? { log } : {}),
});
const call = (tools: Map<string, LmToolImpl>, action: string, input?: unknown) =>
  tools.get('openboard_call')!.invoke({ input: { action, input } });
const textOf = (parts: Awaited<ReturnType<LmToolImpl['invoke']>>): any => JSON.parse((parts[0] as { text: string }).text);

describe('registerLmTools', () => {
  it('registers exactly the five exposed tools, not one per registry tool', () => {
    const { agent } = makeRegistry();
    const { lm, tools } = fakeLm(true);
    const d = registerLmTools(lm, agent, surface());
    expect([...tools.keys()].sort()).toEqual([...EXPOSED_TOOL_NAMES].sort());
    expect(d).toHaveLength(5);
  });

  it('skips with a single log when lm is absent', () => {
    const { agent } = makeRegistry();
    const logs: string[] = [];
    expect(registerLmTools(undefined, agent, surface((m) => logs.push(m)))).toEqual([]);
    expect(logs).toHaveLength(1);
  });

  it('confirms openboard_call only for destructive actions, and scripts always, within 300 chars', () => {
    const { agent } = makeRegistry();
    const { lm, tools } = fakeLm(true);
    registerLmTools(lm, agent, surface());
    const callTool = tools.get('openboard_call')!;
    expect(callTool.prepareInvocation({ input: { action: 'test.echo', input: {} } })).toEqual({});
    const p = callTool.prepareInvocation({ input: { action: 'test.wipe', input: { board: 'x'.repeat(500) } } });
    expect(p.confirmationMessages!.message.length).toBeLessThanOrEqual(300);
    expect(p.confirmationMessages!.message).toContain('test.wipe');
    const e = tools.get('openboard_execute')!.prepareInvocation({ input: { code: 'return 1; // ' + 'y'.repeat(1000) } });
    expect(e.confirmationMessages!.message.length).toBeLessThanOrEqual(300);
    expect(e.confirmationMessages!.message).toContain('return 1;');
    for (const n of ['openboard_workspaces', 'openboard_read_skill', 'openboard_save']) {
      expect(tools.get(n)!.prepareInvocation({ input: {} })).toEqual({});
    }
  });

  it('dispatches actions generically and returns JSON text and image parts', async () => {
    const { agent } = makeRegistry();
    const { lm, tools } = fakeLm(true);
    registerLmTools(lm, agent, surface());
    expect(await call(tools, 'test.echo', { v: 'a' })).toEqual([{ kind: 'text', text: '{"v":"a"}' }]);
    const img = await call(tools, 'test.img');
    expect(img[1]).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(Array.from((img[1] as { data: Uint8Array }).data)).toEqual([1, 2, 3]);
  });

  it('falls back to text with data when images unsupported', async () => {
    const { agent } = makeRegistry();
    const { lm, tools } = fakeLm(false);
    registerLmTools(lm, agent, surface());
    const img = await call(tools, 'test.img');
    expect(img).toHaveLength(1);
    expect((img[0] as { text: string }).text).toContain('AQID');
  });

  it('reports unknown actions and adds a skill hint to validation errors', async () => {
    const { agent } = makeRegistry();
    const { lm, tools } = fakeLm(true);
    registerLmTools(lm, agent, surface());
    expect(textOf(await call(tools, 'nope')).error.code).toBe('unknown_action');
    const bad = textOf(await call(tools, 'test.echo', { v: 5 }));
    expect(bad.error.code).toBe('invalid_input');
    expect(bad.error.issues.length).toBeGreaterThan(0);
    expect(bad.error.hint).toContain('actions');
  });

  it('reads the skill index and topics, and describes this window', async () => {
    const { agent } = makeRegistry();
    const { lm, tools } = fakeLm(true);
    registerLmTools(lm, agent, surface());
    const skill = tools.get('openboard_read_skill')!;
    expect(((await skill.invoke({ input: {} }))[0] as { text: string }).text).toContain('- overview: about');
    expect(((await skill.invoke({ input: { topic: 'overview' } }))[0] as { text: string }).text).toBe('# Overview');
    expect(textOf(await skill.invoke({ input: { topic: 'zzz' } })).error.code).toBe('unknown_topic');
    const ws = textOf(await tools.get('openboard_workspaces')!.invoke({ input: {} }));
    expect(ws.workspaces).toEqual([{ workspaceName: 'w', folders: ['/w'], ide: 'Test' }]);
  });
});

describe('formatResult', () => {
  it('splits image items in results arrays', () => {
    const parts = formatResult({ results: [{ mimeType: 'image/png', data: 'AQID' }] }, true);
    expect(parts).toHaveLength(2);
  });
});

describe('api and command', () => {
  it('exports exactly list, describe, invoke', async () => {
    const { agent } = makeRegistry();
    const api = createApi(agent);
    expect(Object.keys(api).sort()).toEqual(['describe', 'invoke', 'list']);
    expect(await api.invoke('test.echo', { v: 'z' })).toEqual({ v: 'z' });
  });

  it('accepts object or JSON string, same as registry', async () => {
    const { agent } = makeRegistry();
    const cmd = createInvokeToolCommand(agent);
    expect(await cmd('test.echo', { v: 'q' })).toEqual({ v: 'q' });
    expect(await cmd('test.echo', '{"v":"q"}')).toEqual({ v: 'q' });
  });

  it('throws naming the invalid argument', async () => {
    const { agent } = makeRegistry();
    const cmd = createInvokeToolCommand(agent);
    await expect(cmd('nope', {})).rejects.toThrow(/"name"/);
    await expect(cmd('test.echo', '{bad')).rejects.toThrow(/"input"/);
    await expect(cmd('test.echo', '[1]')).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(cmd(5, {})).rejects.toThrow(/"name"/);
  });
});
