import { describe, expect, it } from 'vitest';
import { buildConfirmation, isDestructiveInvocation } from './confirm';

describe('buildConfirmation', () => {
  it('returns the full message when short', () => {
    expect(buildConfirmation('openboard.element.delete', 'a/b.board', 'deletes 3 elements')).toBe(
      'openboard.element.delete on a/b.board: deletes 3 elements',
    );
  });

  it('caps at 300 chars keeping name, path suffix and effect prefix', () => {
    const path = '/very/long/' + 'd/'.repeat(300) + 'final.board';
    const effect = 'EFFECT' + 'x'.repeat(500);
    const msg = buildConfirmation('openboard.undo', path, effect);
    expect(msg.length).toBeLessThanOrEqual(300);
    expect(msg.startsWith('openboard.undo on \u2026')).toBe(true);
    expect(msg).toContain('final.board: ');
    expect(msg).toContain('EFFECT');
  });

  it('stays within 300 for a long tool name', () => {
    const msg = buildConfirmation('t'.repeat(64), 'p'.repeat(1000), 'e'.repeat(1000));
    expect(msg.length).toBeLessThanOrEqual(300);
    expect(msg.startsWith('t'.repeat(64))).toBe(true);
  });
});

describe('isDestructiveInvocation', () => {
  const defs: Record<string, { destructive?: boolean }> = {
    'openboard.batch': {},
    'openboard.element.delete': { destructive: true },
    'openboard.element.create': {},
    'openboard.undo': { destructive: true },
  };
  const registry = {
    def(name: string) {
      const d = defs[name];
      if (!d) throw new Error('Unknown tool');
      return d;
    },
  };

  it('uses the destructive flag', () => {
    expect(isDestructiveInvocation(registry, 'openboard.undo', {})).toBe(true);
    expect(isDestructiveInvocation(registry, 'openboard.element.create', {})).toBe(false);
  });

  it('detects destructive operations inside a batch', () => {
    const op = (tool: string) => ({ tool, input: {} });
    expect(
      isDestructiveInvocation(registry, 'openboard.batch', {
        operations: [op('openboard.element.create'), op('openboard.element.delete')],
      }),
    ).toBe(true);
    expect(
      isDestructiveInvocation(registry, 'openboard.batch', { operations: [op('openboard.element.create'), op('nope')] }),
    ).toBe(false);
    expect(isDestructiveInvocation(registry, 'openboard.batch', {})).toBe(false);
  });

  it('returns false for unknown tools', () => {
    expect(isDestructiveInvocation(registry, 'nope', {})).toBe(false);
  });
});
