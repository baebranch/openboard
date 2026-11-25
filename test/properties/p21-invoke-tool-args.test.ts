// Feature: openboard, Property 21: invokeTool argument validation
// **Validates: Requirements 14.5**
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { InvalidArgumentError, createInvokeToolCommand } from '../../src/host/agent/bridge';
import { buildFullRegistry } from '../helpers/registry';

const RUNS = { numRuns: 100 };

const outcome = async (p: Promise<unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> => {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: `${(e as Error).name}: ${(e as Error).message}` };
  }
};

const invalidArg = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidArgumentError);
    return (e as InvalidArgumentError).argument;
  }
  throw new Error('expected rejection');
};

const queryInput = fc.record(
  {
    type: fc.constantFrom('rect', 'ellipse', 'text', 'bogus'),
    limit: fc.integer({ min: -5, max: 600 }),
    offset: fc.integer({ min: 0, max: 5 }),
  },
  { requiredKeys: [] },
);

const createInput = fc.record({
  elements: fc.array(
    fc.record({ type: fc.constant('rect'), x: fc.integer({ min: -100, max: 100 }), y: fc.integer({ min: -100, max: 100 }) }),
    { minLength: 1, maxLength: 5 },
  ),
});

describe('Feature: openboard, Property 21: invokeTool argument validation', () => {
  it('object input and the same input as a JSON string behave identically', async () => {
    await fc.assert(
      fc.asyncProperty(queryInput, async (input) => {
        const a = buildFullRegistry();
        const b = buildFullRegistry();
        const ra = await outcome(createInvokeToolCommand(a.registry)('openboard.element.query', input));
        const rb = await outcome(createInvokeToolCommand(b.registry)('openboard.element.query', JSON.stringify(input)));
        expect(rb).toEqual(ra);
      }),
      RUNS,
    );
  });

  it('mutating tools produce the same board for object and JSON string input', async () => {
    await fc.assert(
      fc.asyncProperty(createInput, async (input) => {
        const a = buildFullRegistry();
        const b = buildFullRegistry();
        const ra = await outcome(createInvokeToolCommand(a.registry)('openboard.element.create', input));
        const rb = await outcome(createInvokeToolCommand(b.registry)('openboard.element.create', JSON.stringify(input)));
        expect(rb.ok).toBe(ra.ok);
        const strip = (els: readonly { id: string }[]) => els.map(({ id: _id, ...rest }) => rest);
        expect(strip(b.model.getDocument().elements as { id: string }[])).toEqual(
          strip(a.model.getDocument().elements as { id: string }[]),
        );
      }),
      RUNS,
    );
  });

  it('unknown tool names throw InvalidArgumentError naming "name" and change nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((s) => !s.startsWith('openboard.')),
        fc.oneof(fc.constant({}), fc.constant('{}'), fc.constant('not json')),
        async (name, input) => {
          const r = buildFullRegistry();
          const before = JSON.stringify(r.model.getDocument());
          expect(await invalidArg(createInvokeToolCommand(r.registry)(name, input))).toBe('name');
          expect(JSON.stringify(r.model.getDocument())).toBe(before);
          expect(r.totalHandlerCalls()).toBe(0);
        },
      ),
      RUNS,
    );
  });

  it('non-string tool names are rejected naming "name"', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined), fc.array(fc.string())), async (name) => {
        const r = buildFullRegistry();
        expect(await invalidArg(createInvokeToolCommand(r.registry)(name, {}))).toBe('name');
        expect(r.totalHandlerCalls()).toBe(0);
      }),
      RUNS,
    );
  });

  it('unparsable JSON strings throw InvalidArgumentError naming "input" and change nothing', async () => {
    const garbage = fc.oneof(
      fc.string().filter((s) => {
        try {
          JSON.parse(s);
          return false;
        } catch {
          return true;
        }
      }),
      // truncated JSON documents
      fc
        .tuple(createInput, fc.integer({ min: 1, max: 200 }))
        .map(([v, n]) => {
          const s = JSON.stringify(v);
          return s.slice(0, Math.max(1, Math.min(s.length - 1, n)));
        })
        .filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('openboard.element.create', 'openboard.element.query'), garbage, async (name, text) => {
        const r = buildFullRegistry();
        const before = JSON.stringify(r.model.getDocument());
        expect(await invalidArg(createInvokeToolCommand(r.registry)(name, text))).toBe('input');
        expect(JSON.stringify(r.model.getDocument())).toBe(before);
        expect(r.totalHandlerCalls()).toBe(0);
      }),
      RUNS,
    );
  });

  it('non-object inputs (numbers, booleans, arrays, JSON scalars/arrays) are rejected naming "input"', async () => {
    const bad = fc.oneof(
      fc.integer(),
      fc.double({ noNaN: true }),
      fc.boolean(),
      fc.array(fc.anything(), { maxLength: 4 }),
      fc.constantFrom('null', '1', '"s"', 'true', '[]', '[1,2]'),
      fc.integer().map((n) => String(n)),
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('openboard.element.create', 'openboard.element.query'), bad, async (name, input) => {
        const r = buildFullRegistry();
        const before = JSON.stringify(r.model.getDocument());
        expect(await invalidArg(createInvokeToolCommand(r.registry)(name, input))).toBe('input');
        expect(JSON.stringify(r.model.getDocument())).toBe(before);
        expect(r.totalHandlerCalls()).toBe(0);
      }),
      RUNS,
    );
  });
});
