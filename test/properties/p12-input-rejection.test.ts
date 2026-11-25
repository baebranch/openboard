import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defaultValidatorFactory, type JSONSchema } from '../../src/core/tools/json-schema';
import { buildFullRegistry } from '../helpers/registry';

// Feature: openboard, Property 12: Invalid input is rejected before the handler runs
// **Validates: Requirements 13.9, 13.10, 19.2**

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

/** A minimal value satisfying the schema (required properties only). */
function sample(root: JSONSchema, raw: JSONSchema, depth = 0): unknown {
  const schema = deref(root, raw);
  if ('const' in schema) return schema['const'];
  if (Array.isArray(schema['enum'])) return schema['enum'][0];
  const first = branchesOf(schema)[0];
  if (first) return sample(root, first, depth + 1);
  switch (schema['type']) {
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
    case 'array': {
      const n = (schema['minItems'] as number | undefined) ?? 0;
      const items = isObj(schema['items']) && depth < MAX_DEPTH ? (schema['items'] as JSONSchema) : undefined;
      return items ? Array.from({ length: n }, () => sample(root, items, depth + 1)) : [];
    }
    case 'object': {
      const out: Obj = {};
      const props = isObj(schema['properties']) ? (schema['properties'] as Record<string, JSONSchema>) : {};
      if (depth < MAX_DEPTH) {
        for (const k of (schema['required'] as string[] | undefined) ?? []) {
          out[k] = props[k] ? sample(root, props[k], depth + 1) : 'x';
        }
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

/** Values that violate `raw`, built from its constraints (type, range, counts, enum, required, nested). */
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
    const item = items ? sample(root, items) : 'x';
    if (min !== undefined && min > 0) out.push(Array.from({ length: min - 1 }, () => item));
    if (max !== undefined) out.push(Array.from({ length: max + 1 }, () => item));
    if (items) {
      for (const bad of violations(root, items, depth + 1)) {
        out.push([bad], [item, bad]);
      }
    }
  }
  const branches = branchesOf(schema);
  const disc = schema['discriminator'];
  if (branches.length > 0 && isObj(disc) && typeof disc['propertyName'] === 'string') {
    const tag = disc['propertyName'];
    const base = sample(root, branches[0]!) as Obj;
    out.push({ ...base, [tag]: 'zz_unknown_variant' }, { ...base, [tag]: 123 });
    const { [tag]: _omit, ...noTag } = base;
    void _omit;
    out.push(noTag);
    for (const b of branches) {
      const bs = sample(root, b) as Obj;
      for (const bad of violationsOfObject(root, deref(root, b), bs, depth + 1)) out.push(bad);
    }
  } else if (type === 'object' && isObj(schema['properties'])) {
    out.push(...violationsOfObject(root, schema, sample(root, schema) as Obj, depth + 1));
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

/** Everything that violates a tool's input schema, derived from the schema itself. */
function inputViolations(schema: JSONSchema): unknown[] {
  const valid = defaultValidatorFactory.compile(schema);
  const candidates: unknown[] = [null, 42, 'text', [], true, ...violations(schema, schema)];
  // Keep only candidates that genuinely violate the schema.
  return candidates.filter((c) => !valid(c).ok);
}

describe('Feature: openboard, Property 12: Invalid input is rejected before the handler runs', () => {
  const probe = buildFullRegistry();
  const names = probe.registry.list();

  it('registers every tool module', () => {
    for (const part of ['element.create', 'arrange', 'connect', 'layout', 'import', 'export']) {
      expect(names.some((n) => n.includes(part))).toBe(true);
    }
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  for (const name of names) {
    it(`${name}: schema-violating input yields invalid_input, never runs the handler, never touches the board`, () => {
      const bad = inputViolations(probe.registry.describe(name).inputSchema);
      expect(bad.length).toBeGreaterThan(0);
      const { registry, model, history, handlerCalls, resolverCalls } = buildFullRegistry();
      const docBefore = JSON.stringify(model.getDocument());
      const refBefore = model.getDocument();

      return fc.assert(
        fc.asyncProperty(fc.constantFrom(...bad), async (input) => {
          const result = (await registry.invoke(name, input)) as { error?: { code?: string; issues?: unknown } };
          expect(Object.keys(result)).toEqual(['error']);
          expect(result.error?.code).toBe('invalid_input');
          const issues = result.error?.issues as { path: unknown; reason: unknown }[];
          expect(Array.isArray(issues)).toBe(true);
          expect(issues.length).toBeGreaterThan(0);
          for (const i of issues) {
            expect(typeof i.path).toBe('string');
            expect(typeof i.reason).toBe('string');
            expect((i.reason as string).length).toBeGreaterThan(0);
          }
          expect(handlerCalls.get(name) ?? 0).toBe(0);
          expect(resolverCalls()).toBe(0);
          expect(history.undoCount()).toBe(0);
          expect(history.redoCount()).toBe(0);
          expect(model.getDocument()).toBe(refBefore);
          expect(JSON.stringify(model.getDocument())).toBe(docBefore);
        }),
        { numRuns: Math.max(100, Math.min(bad.length * 2, 300)) },
      );
    });
  }

  it('across all tools: random violating inputs never run any handler or alter board/history', async () => {
    const perTool = names.map((n) => [n, inputViolations(probe.registry.describe(n).inputSchema)] as const);
    const arb = fc.constantFrom(...perTool).chain(([n, bad]) => fc.tuple(fc.constant(n), fc.constantFrom(...bad)));
    const { registry, model, history, totalHandlerCalls } = buildFullRegistry();
    const docBefore = JSON.stringify(model.getDocument());
    await fc.assert(
      fc.asyncProperty(arb, async ([n, input]) => {
        const r = (await registry.invoke(n, input)) as { error?: { code?: string } };
        expect(r.error?.code).toBe('invalid_input');
        expect(totalHandlerCalls()).toBe(0);
        expect(history.undoCount()).toBe(0);
        expect(JSON.stringify(model.getDocument())).toBe(docBefore);
      }),
      { numRuns: 200 },
    );
  });
});
