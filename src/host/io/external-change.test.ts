import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../../core/format/parser';
import type { LoadOutcome } from '../editor/loader';
import {
  CHOICE_COMPARE,
  CHOICE_KEEP_LOCAL,
  CHOICE_LOAD_DISK,
  CONFLICT_CHOICES,
  ExternalChangeHandler,
  OwnWriteRegistry,
  type ConflictChoice,
} from './external-change';

const enc = (s: string) => new TextEncoder().encode(s);

function setup(opts: { dirty?: boolean; disk?: string; choices?: (ConflictChoice | undefined)[] } = {}) {
  const reg = new OwnWriteRegistry();
  const s = {
    disk: opts.disk ?? 'disk-v1',
    dirty: opts.dirty ?? false,
    applied: [] as unknown[],
    prompts: [] as { message: string; choices: readonly string[] }[],
    diffs: 0,
    clock: 0,
    choices: [...(opts.choices ?? [])],
  };
  const handler = new ExternalChangeHandler({
    readFile: async () => enc(s.disk),
    hash: (b) => new TextDecoder().decode(b),
    parse: (b): LoadOutcome => ({ ok: true, doc: createEmptyDocument(), readOnly: false, rawText: new TextDecoder().decode(b) }),
    isDirty: () => s.dirty,
    isOwnWrite: (b) => reg.isOwnWrite('k', b),
    forgetOwnWrite: () => reg.forget('k'),
    getViewport: () => ({ x: 5, y: 6, zoom: 2 }),
    applyDisk: (o) => (s.applied.push(o.doc), true),
    showPrompt: async (message, choices) => {
      s.prompts.push({ message, choices });
      return s.choices.shift();
    },
    openDiff: async () => void s.diffs++,
    now: () => (s.clock += 10),
    warn: () => undefined,
  });
  return { s, reg, handler };
}

describe('ExternalChangeHandler', () => {
  it('ignores events caused by our own write', async () => {
    const { s, reg, handler } = setup({ disk: 'mine' });
    reg.recordOwnWrite('k', enc('mine'));
    expect(await handler.handleChange()).toEqual({ kind: 'ignored-own-write' });
    expect(await handler.handleChange()).toEqual({ kind: 'ignored-own-write' });
    expect(s.applied).toHaveLength(0);
  });

  it('reloads a clean document, preserving the viewport, within 2 s', async () => {
    const { s, reg, handler } = setup({ disk: 'other' });
    reg.recordOwnWrite('k', enc('mine'));
    const r = await handler.handleChange();
    expect(r.kind).toBe('reloaded');
    if (r.kind === 'reloaded') expect(r.elapsedMs).toBeLessThan(2000);
    expect((s.applied[0] as { viewport: unknown }).viewport).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(s.prompts).toHaveLength(0);
  });

  it('reports invalid disk content without touching the document', async () => {
    const reg = new OwnWriteRegistry();
    let applied = 0;
    const h = new ExternalChangeHandler({
      readFile: async () => enc('x'),
      hash: () => 'h',
      parse: () => ({ ok: false, reason: { kind: 'json', line: 1, column: 1, message: 'bad' } }),
      isDirty: () => false,
      isOwnWrite: (b) => reg.isOwnWrite('k', b),
      forgetOwnWrite: () => undefined,
      getViewport: () => undefined,
      applyDisk: () => (applied++, true),
      showPrompt: async () => undefined,
      openDiff: async () => undefined,
      now: () => 0,
      warn: () => undefined,
    });
    expect(await h.handleChange()).toEqual({ kind: 'invalid-on-disk' });
    expect(applied).toBe(0);
  });

  it('offers exactly three choices when dirty and leaves the document unchanged on Keep local', async () => {
    const { s, handler } = setup({ dirty: true, choices: [CHOICE_KEEP_LOCAL] });
    expect(await handler.handleChange()).toEqual({ kind: 'conflict', choice: 'keep-local' });
    expect(s.prompts[0]!.choices).toEqual(['Keep local', 'Load disk version', 'Compare as JSON text']);
    expect(s.prompts[0]!.choices).toEqual([...CONFLICT_CHOICES]);
    expect(s.applied).toHaveLength(0);
    // same disk content does not re-prompt
    expect(await handler.handleChange()).toEqual({ kind: 'ignored-duplicate' });
  });

  it('Compare opens the diff, keeps the document unchanged, then asks again', async () => {
    const { s, handler } = setup({ dirty: true, choices: [CHOICE_COMPARE, CHOICE_LOAD_DISK] });
    expect(await handler.handleChange()).toEqual({ kind: 'conflict', choice: 'load-disk' });
    expect(s.diffs).toBe(1);
    expect(s.prompts).toHaveLength(2);
    expect(s.applied).toHaveLength(1);
  });

  it('dismissing the prompt keeps local edits', async () => {
    const { s, handler } = setup({ dirty: true, choices: [undefined] });
    expect(await handler.handleChange()).toEqual({ kind: 'conflict', choice: 'dismissed' });
    expect(s.applied).toHaveLength(0);
  });
});
