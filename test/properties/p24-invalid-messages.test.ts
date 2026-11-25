import Ajv from 'ajv';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMessageSchemas } from '../../src/core/schema';
import { createMessageValidation, type MessageValidators } from '../../src/shared/messages';

const ajv = new Ajv({ allErrors: false, strict: true, discriminator: true });
const schemas = buildMessageSchemas();
const validators = {
  validateWebviewToHost: ajv.compile(schemas['validateWebviewToHost']!),
  validateHostToWebview: ajv.compile(schemas['validateHostToWebview']!),
} as MessageValidators;

const patches = [{ op: 'replace', path: ['elements', 0, 'x'], value: 1 }];

// Each entry: a valid message plus the required fields and fields with a primitive (string/number) type.
interface Spec {
  msg: Record<string, unknown>;
  required: string[];
  primitives: string[];
}
const toHost: Spec[] = [
  { msg: { type: 'ready' }, required: [], primitives: [] },
  { msg: { type: 'op', gestureId: 'g1', tool: 'board.add', input: { a: 1 } }, required: ['gestureId', 'tool'], primitives: ['gestureId', 'tool'] },
  { msg: { type: 'viewport', viewport: { x: 0, y: 0, zoom: 1 } }, required: ['viewport'], primitives: ['viewport'] },
  { msg: { type: 'selection', ids: ['a', 'b'] }, required: ['ids'], primitives: ['ids'] },
  { msg: { type: 'export:result', requestId: 'r', bytes: 'AA==', mime: 'image/png' }, required: ['requestId', 'bytes', 'mime'], primitives: ['requestId', 'bytes', 'mime'] },
  { msg: { type: 'render:result', requestId: 'r', png: 'AA==' }, required: ['requestId', 'png'], primitives: ['requestId', 'png'] },
  { msg: { type: 'log', level: 'warn', message: 'hi' }, required: ['level', 'message'], primitives: ['level', 'message'] },
];
const toWebview: Spec[] = [
  { msg: { type: 'init', doc: {}, settings: {}, readOnly: false }, required: ['doc', 'settings', 'readOnly'], primitives: ['readOnly'] },
  { msg: { type: 'ack', gestureId: 'g', revision: 2, patches }, required: ['gestureId', 'revision', 'patches'], primitives: ['gestureId', 'revision', 'patches'] },
  { msg: { type: 'patch', revision: 3, patches }, required: ['revision', 'patches'], primitives: ['revision', 'patches'] },
  { msg: { type: 'reset', doc: {} }, required: ['doc'], primitives: [] },
  { msg: { type: 'settings', settings: {} }, required: ['settings'], primitives: [] },
  { msg: { type: 'viewport', viewport: { x: 0, y: 0, zoom: 1 } }, required: ['viewport'], primitives: ['viewport'] },
  { msg: { type: 'render:request', requestId: 'r', spec: {} }, required: ['requestId', 'spec'], primitives: ['requestId', 'spec'] },
  { msg: { type: 'notice', level: 'info', message: 'x' }, required: ['level', 'message'], primitives: ['level', 'message'] },
  { msg: { type: 'view:command', command: 'toggleGrid' }, required: ['command'], primitives: ['command'] },
];

type Dir = 'webview-to-host' | 'host-to-webview';
const dirArb = fc.constantFrom<Dir>('webview-to-host', 'host-to-webview');
const specsFor = (d: Dir) => (d === 'webview-to-host' ? toHost : toWebview);

const nonObject = fc.oneof(
  fc.constantFrom(null, undefined, NaN, 0, 1, true, false, '', 'ready'),
  fc.string(),
  fc.double(),
  fc.array(fc.anything(), { maxLength: 4 }),
);
const junk = fc.dictionary(fc.string({ maxLength: 8 }).filter((k) => k !== 'type'), fc.anything(), { maxKeys: 4 });
const unknownType = fc.oneof(
  fc.string().filter((s) => ![...toHost, ...toWebview].some((x) => x.msg['type'] === s)),
  fc.anything().filter((v) => typeof v !== 'string'),
);

const invalidArb: fc.Arbitrary<{ dir: Dir; data: unknown }> = fc.oneof(
  fc.record({ dir: dirArb, data: nonObject }),
  fc.record({ dir: dirArb, data: fc.tuple(unknownType, junk).map(([t, j]) => ({ ...j, type: t })) }),
  fc.record({ dir: dirArb, data: junk }),
  // wrong direction: every message type from the other side must be rejected unless shared by name
  dirArb.chain((dir) => {
    const other = specsFor(dir === 'webview-to-host' ? 'host-to-webview' : 'webview-to-host');
    const own = new Set(specsFor(dir).map((s) => s.msg['type']));
    return fc.constantFrom(...other.filter((s) => !own.has(s.msg['type']))).map((s) => ({ dir, data: s.msg }));
  }),
  // missing required field
  dirArb.chain((dir) =>
    fc
      .constantFrom(...specsFor(dir).filter((s) => s.required.length > 0))
      .chain((s) => fc.constantFrom(...s.required).map((f) => ({ dir, data: Object.fromEntries(Object.entries(s.msg).filter(([k]) => k !== f)) }))),
  ),
  // wrong type for a primitive field
  dirArb.chain((dir) =>
    fc
      .constantFrom(...specsFor(dir).filter((s) => s.primitives.length > 0))
      .chain((s) =>
        fc.tuple(fc.constantFrom(...s.primitives), fc.constantFrom<unknown>(null, undefined, {}, [], Symbol.iterator.toString().length, true, 'x\u0000')).map(([f, bad]) => {
          const orig = s.msg[f];
          // Pick a replacement whose JS type differs from the original's
          const repl = typeof orig === typeof bad && (Array.isArray(orig) === Array.isArray(bad)) ? (typeof orig === 'string' ? 5 : 'str') : bad;
          return { dir, data: { ...s.msg, [f]: repl } };
        }),
      ),
  ),
);

describe('Feature: openboard, Property 24: Invalid host/webview messages are discarded', () => {
  it('invalid messages are dropped, logged once, and never throw', () => {
    fc.assert(
      fc.property(invalidArb, ({ dir, data }) => {
        const logs: string[] = [];
        const { accept } = createMessageValidation(validators, { warn: (m) => logs.push(m) });
        let result: unknown = 'unset';
        expect(() => {
          result = (accept as (d: Dir, v: unknown) => unknown)(dir, data);
        }).not.toThrow();
        expect(result).toBeUndefined();
        expect(logs).toHaveLength(1);
      }),
      { numRuns: 300 },
    );
  });

  it('valid messages of every type are accepted unchanged without logging', () => {
    fc.assert(
      fc.property(
        dirArb.chain((dir) => fc.constantFrom(...specsFor(dir)).map((s) => ({ dir, msg: s.msg }))),
        ({ dir, msg }) => {
          const logs: string[] = [];
          const { accept } = createMessageValidation(validators, { warn: (m) => logs.push(m) });
          const input = structuredClone(msg);
          const out = (accept as (d: Dir, v: unknown) => unknown)(dir, input);
          expect(out).toBe(input);
          expect(out).toEqual(msg);
          expect(logs).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
