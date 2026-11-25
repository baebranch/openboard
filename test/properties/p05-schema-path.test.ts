import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, serialize } from '../../src/core/format';
import type { BoardValidator } from '../../src/core/format';
import { arbBoardDocument } from '../arbitraries';
import { getBoardValidator } from '../helpers/validator';

let validator: BoardValidator;
beforeAll(() => {
  validator = getBoardValidator();
});

type Json = Record<string, unknown>;

/** A mutation of one known property at a known JSON pointer (`{i}` = element index). */
interface Mutation {
  pointer: string;
  /** `undefined` means: delete the property (missing required field). */
  value: unknown;
}

const BAD_TYPES: unknown[] = ['abc', true, null, [], {}];

const arbMutation: fc.Arbitrary<Mutation> = fc.oneof(
  // wrong type
  fc.tuple(fc.constantFrom('/viewport/zoom', '/viewport/x', '/viewport/y', '/elements/{i}/x', '/elements/{i}/y', '/elements/{i}/width', '/elements/{i}/height', '/elements/{i}/rotation', '/elements/{i}/style/opacity', '/elements/{i}/style/strokeWidth', '/elements/{i}/id', '/elements/{i}/locked'), fc.constantFrom(...BAD_TYPES))
    .filter(([p, v]) => !(p.endsWith('/locked') && typeof v === 'boolean') && !(p.endsWith('/id') && typeof v === 'string'))
    .map(([pointer, value]) => ({ pointer, value })),
  // out of range
  fc.constantFrom<Mutation>(
    { pointer: '/viewport/zoom', value: 0 },
    { pointer: '/viewport/zoom', value: -1 },
    { pointer: '/viewport/zoom', value: 801 },
    { pointer: '/elements/{i}/style/opacity', value: 101 },
    { pointer: '/elements/{i}/style/opacity', value: -1 },
  ),
  // missing required property
  fc.constantFrom('/viewport/zoom', '/viewport/x', '/elements/{i}/id', '/elements/{i}/type', '/elements/{i}/x', '/elements/{i}/width', '/elements/{i}/style').map((pointer) => ({ pointer, value: undefined })),
);

function applyMutation(doc: unknown, pointer: string, value: unknown): void {
  const parts = pointer.split('/').slice(1);
  let cur = doc as Json;
  for (const part of parts.slice(0, -1)) cur = cur[part] as Json;
  const last = parts[parts.length - 1]!;
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

// Feature: openboard, Property 5: Schema violations name the offending path
describe('Feature: openboard, Property 5: Schema violations name the offending path', () => {
  it('parse reports a schema error whose path is the mutated pointer', () => {
    // **Validates: Requirements 11.8**
    fc.assert(
      fc.property(
        arbBoardDocument(15).filter((d) => d.elements.length >= 1),
        arbMutation,
        fc.nat(),
        (doc, mutation, rawIndex) => {
          const index = rawIndex % doc.elements.length;
          const pointer = mutation.pointer.replace('{i}', String(index));
          const json = JSON.parse(serialize(doc)) as unknown;
          applyMutation(json, pointer, mutation.value);
          const result = parse(JSON.stringify(json), { validator });
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.kind).toBe('schema');
          if (result.kind !== 'schema') return;
          const missing = mutation.value === undefined;
          if (missing) {
            // Missing required properties: error starts at / names the property.
            expect(result.path === pointer || result.path.startsWith(pointer) || pointer.startsWith(result.path)).toBe(true);
          } else {
            expect(result.path).toBe(pointer);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('names /viewport/zoom for zoom 0', () => {
    const doc = fc.sample(arbBoardDocument(5).filter((d) => d.elements.length >= 1), 1)[0]!;
    const json = JSON.parse(serialize(doc)) as { viewport: { zoom: number } };
    json.viewport.zoom = 0;
    const r = parse(JSON.stringify(json), { validator });
    expect(r.ok).toBe(false);
    if (!r.ok && r.kind === 'schema') expect(r.path).toBe('/viewport/zoom');
  });
});
