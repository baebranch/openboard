/**
 * Small JSON-Schema-subset validator (no eval, no codegen). Supports: type, required, enum, const,
 * minimum/maximum, minLength/maxLength, minItems/maxItems, items, properties, additionalProperties,
 * oneOf (with optional `discriminator`), and `$ref` to `#/$defs/...` or `#/definitions/...`.
 */

export type JSONSchema = { [key: string]: unknown };

export interface ValidationIssue {
  path: string;
  reason: string;
}

export type ValidationResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

export type Validator = (data: unknown) => ValidationResult;

export interface ValidatorFactory {
  compile(schema: JSONSchema): Validator;
}

const MAX_DEPTH = 64;

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  switch (t) {
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    default:
      return typeOf(v) === t;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function resolveRef(root: JSONSchema, ref: string): JSONSchema | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isObj(cur)) return undefined;
    cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return isObj(cur) ? cur : undefined;
}

function check(root: JSONSchema, schema: JSONSchema, data: unknown, path: string, out: ValidationIssue[], depth: number): void {
  if (depth > MAX_DEPTH) {
    out.push({ path, reason: 'schema nesting too deep' });
    return;
  }
  const add = (reason: string) => out.push({ path, reason });

  if (typeof schema['$ref'] === 'string') {
    const target = resolveRef(root, schema['$ref']);
    if (!target) add(`unresolvable $ref ${schema['$ref']}`);
    else check(root, target, data, path, out, depth + 1);
    return;
  }

  const type = schema['type'];
  if (type !== undefined) {
    const types = Array.isArray(type) ? (type as string[]) : [type as string];
    if (!types.some((t) => matchesType(data, t))) {
      add(`must be ${types.join(' or ')}, got ${typeOf(data)}`);
      return;
    }
  }
  if (Array.isArray(schema['enum']) && !schema['enum'].some((e) => deepEqual(e, data))) {
    add(`must be one of ${JSON.stringify(schema['enum'])}`);
  }
  if ('const' in schema && !deepEqual(schema['const'], data)) add(`must equal ${JSON.stringify(schema['const'])}`);

  if (typeof data === 'number') {
    if (typeof schema['minimum'] === 'number' && data < schema['minimum']) add(`must be >= ${schema['minimum']}`);
    if (typeof schema['maximum'] === 'number' && data > schema['maximum']) add(`must be <= ${schema['maximum']}`);
  }
  if (typeof data === 'string') {
    if (typeof schema['minLength'] === 'number' && data.length < schema['minLength']) add(`length must be >= ${schema['minLength']}`);
    if (typeof schema['maxLength'] === 'number' && data.length > schema['maxLength']) add(`length must be <= ${schema['maxLength']}`);
  }
  if (Array.isArray(data)) {
    if (typeof schema['minItems'] === 'number' && data.length < schema['minItems']) add(`must have >= ${schema['minItems']} items`);
    if (typeof schema['maxItems'] === 'number' && data.length > schema['maxItems']) add(`must have <= ${schema['maxItems']} items`);
    if (isObj(schema['items'])) {
      data.forEach((item, i) => check(root, schema['items'] as JSONSchema, item, `${path}/${i}`, out, depth + 1));
    }
  }
  if (isObj(data)) {
    const props = isObj(schema['properties']) ? (schema['properties'] as Record<string, JSONSchema>) : {};
    if (Array.isArray(schema['required'])) {
      for (const k of schema['required'] as string[]) {
        if (!(k in data) || data[k] === undefined) out.push({ path: `${path}/${k}`, reason: 'is required' });
      }
    }
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      const sub = props[k];
      if (sub) check(root, sub, v, `${path}/${k}`, out, depth + 1);
      else if (schema['additionalProperties'] === false) out.push({ path: `${path}/${k}`, reason: 'is not allowed' });
      else if (isObj(schema['additionalProperties'])) {
        check(root, schema['additionalProperties'], v, `${path}/${k}`, out, depth + 1);
      }
    }
  }

  if (Array.isArray(schema['oneOf'])) {
    const branches = schema['oneOf'] as JSONSchema[];
    const disc = schema['discriminator'];
    const propName = isObj(disc) && typeof disc['propertyName'] === 'string' ? disc['propertyName'] : undefined;
    if (propName !== undefined) {
      if (!isObj(data)) {
        add('must be an object');
        return;
      }
      const value = data[propName];
      const hit = branches.filter((b) => {
        const resolved = typeof b['$ref'] === 'string' ? (resolveRef(root, b['$ref']) ?? b) : b;
        const p = isObj(resolved['properties']) ? (resolved['properties'] as Record<string, JSONSchema>)[propName] : undefined;
        if (!p) return false;
        if ('const' in p) return deepEqual(p['const'], value);
        return Array.isArray(p['enum']) && p['enum'].some((e) => deepEqual(e, value));
      });
      if (hit.length !== 1) {
        out.push({ path: `${path}/${propName}`, reason: `must be one of the known ${propName} values` });
      } else {
        check(root, hit[0]!, data, path, out, depth + 1);
      }
    } else {
      const matching = branches.filter((b) => {
        const tmp: ValidationIssue[] = [];
        check(root, b, data, path, tmp, depth + 1);
        return tmp.length === 0;
      });
      if (matching.length !== 1) add(matching.length === 0 ? 'does not match any allowed shape' : 'matches more than one allowed shape');
    }
  }
}

export const defaultValidatorFactory: ValidatorFactory = {
  compile(schema: JSONSchema): Validator {
    return (data) => {
      const issues: ValidationIssue[] = [];
      check(schema, schema, data, '', issues, 0);
      return issues.length === 0 ? { ok: true } : { ok: false, issues };
    };
  },
};
