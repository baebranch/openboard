import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HostBoardResolver, checkTrust, type BoardHost } from '../../src/core/tools/resolution';
import type { ToolDefinition } from '../../src/core/tools/registry';
import type { BoardModel } from '../../src/core/ops';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 23: Workspace trust gate
// **Validates: Requirements 16.9**

const ACTIVE = '/ws/active.board';
const OTHERS = ['/ws/a.board', '/ws/b.board', '/ws/sub/c.board'];

const mkModel = (path: string) => ({ path }) as unknown as BoardModel;

function makeHost(trusted: boolean) {
  const models = new Map([ACTIVE, ...OTHERS].map((p) => [p, mkModel(p)]));
  const calls = { opened: 0, resolved: 0 };
  const host: BoardHost = {
    isOpen: (p) => {
      calls.resolved += 1;
      return models.get(p);
    },
    exists: (p) => models.has(p),
    openInBackground: (p) => {
      calls.opened += 1;
      return models.get(p)!;
    },
    activeBoard: () => models.get(ACTIVE),
    openBoards: () => [...models.keys()],
    isWorkspaceTrusted: () => trusted,
  };
  return { host, calls };
}

const mkDef = (flags: { readOnly: boolean; writesElsewhere: boolean }): ToolDefinition =>
  ({
    name: 't',
    description: 'd',
    inputSchema: {},
    outputSchema: {},
    boardResolution: 'required-or-active',
    handler: () => ({}),
    ...flags,
  }) as ToolDefinition;

const flagsArb = fc.record({ readOnly: fc.boolean(), writesElsewhere: fc.boolean() });
const spelled = (p: string, back: boolean) => (back ? p.replace(/\//g, '\\') : p);
const targetArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom(ACTIVE, ...OTHERS).chain((p) => fc.boolean().map((b) => spelled(p, b))),
);
const inputOf = (board: string | undefined) => (board === undefined ? {} : { board });
const isActive = (board: string | undefined) =>
  board === undefined || board.replace(/\\/g, '/') === ACTIVE;

describe('Property 23: Workspace trust gate', () => {
  it('Feature: openboard, Property 23: Workspace trust gate', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), flagsArb, targetArb, async (trusted, flags, board) => {
        const { host, calls } = makeHost(trusted);
        const def = mkDef(flags);
        const res = await new HostBoardResolver(host).resolve(def, inputOf(board));

        const mustReject = !trusted && (flags.writesElsewhere || (!flags.readOnly && !isActive(board)));
        if (mustReject) {
          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.error.code).toBe('workspace_untrusted');
          // nothing happened: no board looked up or opened
          expect(calls.resolved).toBe(0);
          expect(calls.opened).toBe(0);
          expect(checkTrust(host, def, inputOf(board))?.ok).toBe(false);
        } else {
          expect(checkTrust(host, def, inputOf(board))).toBeUndefined();
          expect(res.ok).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('tool flags allow viewing other boards when untrusted but block export', async () => {
    const { defs } = buildFullRegistry();
    for (const name of ['openboard.element.query', 'openboard.board.preview']) {
      expect(defs.get(name)?.readOnly, name).toBe(true);
    }
    // View-style tools are always readOnly.
    for (const [name, def] of defs) {
      if (/\.(query|preview|summary|get|list)$/.test(name)) expect(def.readOnly, name).toBe(true);
    }
    // Export is conservatively writesElsewhere.
    expect(defs.get('openboard.export')?.writesElsewhere).toBe(true);
    // No tool is both readOnly and mutating-elsewhere.
    for (const [name, def] of defs) expect(def.readOnly && def.writesElsewhere, name).toBeFalsy();

    // Real defs: untrusted + other board.
    const { host } = makeHost(false);
    const other = { board: OTHERS[0] };
    const verdict = (name: string) => checkTrust(host, defs.get(name)!, other);
    expect(verdict('openboard.element.query')).toBeUndefined();
    expect(verdict('openboard.board.preview')).toBeUndefined();
    expect(verdict('openboard.element.create')?.ok).toBe(false);
    expect(verdict('openboard.export')?.ok).toBe(false);
  });
});
