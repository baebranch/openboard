import { Ajv } from 'ajv';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultValidatorFactory, type JSONSchema } from '../../src/core/tools/json-schema';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 13: Tool schemas accept valid and reject invalid samples
// **Validates: Requirements 19.2, 13.1**

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const MAX_DEPTH = 6;

function deref(root: JSONSchema, schema: JSONSchema): JSONSchema {
  let cur = schema;
  for (let i = 0; i < 8 && typeof cur['$ref'] === 'string'; i++) {
    let t: unknown = root;
    for (const part of (cur['$ref'] as string).slice(2).split('/')) t = isObj(t) ? t[part] : undefined;
    if (!isObj(t)) break;
    cur = t;
  }
  return cur;
}

const branchesOf = (schema: JSONSchema): JSONSchema[] => (Array.isArray(schema['oneOf']) ? (schema['oneOf'] as JSONSchema[]) : []);

/** Minimal valid value; `pick` varies oneOf branch choice and optional-property inclusion. */
function sample(root: JSONSchema, raw: JSONSchema, pick: number, depth = 0): unknown {
  const schema = deref(root, raw);
  if ('const' in schema) return schema['const'];
  if (Array.isArray(schema['enum'])) return schema['enum'][pick % schema['enum'].length];
  const branches = branchesOf(schema);
  if (branches.length > 0) return sample(root, branches[pick % branches.length]!, pick, depth + 1);
  const type = Array.isArray(schema['type']) ? (schema['type'] as string[])[0] : schema['type'];
  switch (type) {
    case 'string':
      return 'x'.repeat(Math.max(1, (schema['minLength'] as number | undefined) ?? 1));
    case 'integer':
    case 'number': {
      const min = schema['minimum'] as number | undefined;
      const max = schema['maximum'] as number | undefined;
      return min !== undefined ? min : max !== undefined ? Math.min(0, max) : 0;
    }
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'array': {
      const n = (schema['minItems'] as number | undefined) ?? 0;
      const items = isObj(schema['items']) && depth < MAX_DEPTH ? (schema['items'] as JSONSchema) : undefined;
      return items ? Array.from({ length: n }, () => sample(root, items, pick, depth + 1)) : [];
    }
    case 'object': {
      const out: Obj = {};
      const props = isObj(schema['properties']) ? (schema['properties'] as Record<string, JSONSchema>) : {};
      const required = (schema['required'] as string[] | undefined) ?? [];
      if (depth < MAX_DEPTH) {
        for (const [k, sub] of Object.entries(props)) {
          if (required.includes(k) || (pick % 2 === 1 && depth < 2)) out[k] = sample(root, sub, pick, depth + 1);
        }
        for (const k of required) if (!(k in out)) out[k] = 'x';
      }
      return out;
    }
    default:
      return {};
  }
}

const wrongTypes = (type: unknown): unknown[] => {
  const all: [string, unknown][] = [
    ['string', 'not-a-string'],
    ['number', 12.5],
    ['integer', 7],
    ['boolean', true],
    ['array', []],
    ['object', {}],
    ['null', null],
  ];
  return all.filter(([t]) => t !== type && !(type === 'number' && t === 'integer')).map(([, v]) => v);
};

function violations(root: JSONSchema, raw: JSONSchema, depth = 0): unknown[] {
  const schema = deref(root, raw);
  const out: unknown[] = [];
  if (depth > MAX_DEPTH) return out;
  const type = schema['type'];
  if (typeof type === 'string') out.push(...wrongTypes(type));
  if ('const' in schema) out.push({ __not: schema['const'] }, null);
  if (Array.isArray(schema['enum'])) out.push('zz_bad_enum_value', -987654, null);
  if (type === 'integer') out.push(1.5);
  if (type === 'number' || type === 'integer') {
    const min = schema['minimum'] as number | undefined;
    const max = schema['maximum'] as number | undefined;
    if (min !== undefined) out.push(min - 1, min - 1000);
    if (max !== undefined) out.push(max + 1, max + 1000);
    out.push(Number.POSITIVE_INFINITY);
  }
  if (type === 'string') {
    const min = schema['minLength'] as number | undefined;
    const max = schema['maxLength'] as number | undefined;
    if (min !== undefined && min > 0) out.push('x'.repeat(min - 1));
    if (max !== undefined) out.push('x'.repeat(max + 1));
  }
  if (type === 'array') {
    const min = schema['minItems'] as number | undefined;
    const max = schema['maxItems'] as number | undefined;
    const items = isObj(schema['items']) ? (schema['items'] as JSONSchema) : undefined;
    const item = items ? sample(root, items, 0) : 'x';
    if (min !== undefined && min > 0) out.push(Array.from({ length: min - 1 }, () => item));
    if (max !== undefined) out.push(Array.from({ length: max + 1 }, () => item));
    if (items) for (const bad of violations(root, items, depth + 1)) out.push([bad], [item, bad]);
  }
  const branches = branchesOf(schema);
  const disc = schema['discriminator'];
  if (branches.length > 0 && isObj(disc) && typeof disc['propertyName'] === 'string') {
    const tag = disc['propertyName'];
    const base = sample(root, branches[0]!, 0) as Obj;
    out.push({ ...base, [tag]: 'zz_unknown_variant' }, { ...base, [tag]: 123 });
    const { [tag]: _omit, ...noTag } = base;
    void _omit;
    out.push(noTag);
    for (const b of branches) {
      const bs = sample(root, b, 0) as Obj;
      out.push(...violationsOfObject(root, deref(root, b), bs, depth + 1));
    }
  } else if (type === 'object' && isObj(schema['properties'])) {
    out.push(...violationsOfObject(root, schema, sample(root, schema, 0) as Obj, depth + 1));
  }
  return out;
}

function violationsOfObject(root: JSONSchema, schema: JSONSchema, base: Obj, depth: number): Obj[] {
  const out: Obj[] = [];
  const props = isObj(schema['properties']) ? (schema['properties'] as Record<string, JSONSchema>) : {};
  for (const k of (schema['required'] as string[] | undefined) ?? []) {
    const { [k]: _gone, ...rest } = base;
    void _gone;
    out.push(rest);
  }
  for (const [k, sub] of Object.entries(props)) {
    for (const bad of violations(root, sub, depth + 1)) out.push({ ...base, [k]: bad });
  }
  if (schema['additionalProperties'] === false) out.push({ ...base, __unexpected: 1 });
  return out;
}

describe('Feature: openboard, Property 13: Tool schemas accept valid and reject invalid samples', () => {
  const { registry } = buildFullRegistry();
  const names = registry.list();

  it('registers tools', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  for (const name of names) {
    const desc = registry.describe(name);
    for (const kind of ['inputSchema', 'outputSchema'] as const) {
      const schema = desc[kind] as JSONSchema;
      it(`${name}.${kind}: strict Ajv + in-repo validators agree on valid and invalid samples`, () => {
        expect(isObj(schema)).toBe(true);
        const ajv = new Ajv({ strict: true, discriminator: true });
        const ajvValidate = ajv.compile(schema);
        const repo = defaultValidatorFactory.compile(schema);
        const both = (v: unknown): [boolean, boolean] => [ajvValidate(v) === true, repo(v).ok];

        const bad = violations(schema, schema);
        bad.push(null, 42, 'text', [], true);
        fc.assert(
          fc.property(fc.nat(7), (pick) => {
            const [a, r] = both(sample(schema, schema, pick));
            expect(a).toBe(true);
            expect(r).toBe(true);
          }),
          { numRuns: 100 },
        );

        // Corpus of candidates: agreement required; the schema's own violations must be rejected by both.
        const corpus = [...bad];
        const rejectedByRepo = corpus.filter((c) => !repo(c).ok);
        expect(rejectedByRepo.length).toBeGreaterThan(0);
        fc.assert(
          fc.property(fc.constantFrom(...corpus), (c) => {
            const [a, r] = both(c);
            expect(a).toBe(r);
          }),
          { numRuns: Math.max(100, Math.min(corpus.length * 2, 300)) },
        );
        fc.assert(
          fc.property(fc.constantFrom(...rejectedByRepo), (c) => {
            expect(both(c)).toEqual([false, false]);
          }),
          { numRuns: Math.max(100, Math.min(rejectedByRepo.length * 2, 300)) },
        );
        // Random JSON values: both validators agree.
        fc.assert(
          fc.property(fc.jsonValue(), (v) => {
            const [a, r] = both(v);
            expect(a).toBe(r);
          }),
          { numRuns: 100 },
        );
      });
    }
  }
});
