/**
 * Tiny JSON Schema builder shared by the Board_File schemas and the tool schemas.
 * Produces plain draft-07 JSON Schema objects (no runtime dependencies).
 * Objects allow additional properties so unknown properties survive (Req 11.11).
 */

export type JsonSchema = { [key: string]: unknown };

export interface Prop {
  schema: JsonSchema;
  optional: boolean;
}

export type Shape = Record<string, JsonSchema | Prop>;

const isProp = (v: JsonSchema | Prop): v is Prop =>
  typeof (v as Prop).optional === 'boolean' && typeof (v as Prop).schema === 'object' && (v as Prop).schema !== null;

export const s = {
  string(opts: { minLength?: number; maxLength?: number; pattern?: string } = {}): JsonSchema {
    return { type: 'string', ...opts };
  },
  number(opts: { min?: number; max?: number } = {}): JsonSchema {
    const out: JsonSchema = { type: 'number' };
    if (opts.min !== undefined) out['minimum'] = opts.min;
    if (opts.max !== undefined) out['maximum'] = opts.max;
    return out;
  },
  integer(opts: { min?: number; max?: number } = {}): JsonSchema {
    return { ...s.number(opts), type: 'integer' };
  },
  boolean(): JsonSchema {
    return { type: 'boolean' };
  },
  enum(values: readonly (string | number)[]): JsonSchema {
    return { enum: [...values] };
  },
  const(value: string | number | boolean): JsonSchema {
    return { const: value };
  },
  array(items: JsonSchema, opts: { minItems?: number; maxItems?: number } = {}): JsonSchema {
    return { type: 'array', items, ...opts };
  },
  /** Object schema; wrap a property in `s.opt` to make it optional. Extra properties are allowed. */
  object(shape: Shape, opts: { additionalProperties?: boolean } = {}): JsonSchema {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, v] of Object.entries(shape)) {
      if (isProp(v)) properties[key] = v.schema;
      else {
        properties[key] = v;
        required.push(key);
      }
    }
    const out: JsonSchema = { type: 'object', properties };
    if (required.length > 0) out['required'] = required;
    out['additionalProperties'] = opts.additionalProperties ?? true;
    return out;
  },
  opt(schema: JsonSchema): Prop {
    return { schema, optional: true };
  },
  /** Tagged union via Ajv `discriminator`; every branch must declare `properties[tag].const`. */
  union(tag: string, branches: JsonSchema[]): JsonSchema {
    return { type: 'object', discriminator: { propertyName: tag }, oneOf: branches };
  },
  ref(name: string): JsonSchema {
    return { $ref: `#/$defs/${name}` };
  },
};

/** Merge object schemas (properties and required) into one flat object schema. */
export function extend(base: JsonSchema, ...more: JsonSchema[]): JsonSchema {
  const properties: Record<string, unknown> = { ...(base['properties'] as object) };
  const required = new Set<string>((base['required'] as string[] | undefined) ?? []);
  for (const m of more) {
    Object.assign(properties, m['properties'] as object);
    for (const r of (m['required'] as string[] | undefined) ?? []) required.add(r);
  }
  const out: JsonSchema = { ...base, properties };
  if (required.size > 0) out['required'] = [...required];
  return out;
}
