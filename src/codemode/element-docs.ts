/**
 * Derives element documentation from the registry's `openboard.element.create` input schema: the
 * properties shared by every element type and the extra properties of each type.
 */
import { schemaToTs } from './schema-ts';

type Schema = { [key: string]: unknown };
const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ElementDocs {
  types: string[];
  /** Properties present on every element type (name -> JSON schema). */
  common: Record<string, unknown>;
  /** Per type: its own extra properties and which of them are required. */
  extras: Record<string, { props: Record<string, unknown>; required: string[] }>;
}

interface Describer {
  describe(name: string): { inputSchema: unknown };
}

export function elementDocs(registry: Describer): ElementDocs {
  const input = registry.describe('openboard.element.create').inputSchema;
  const props = isObj(input) && isObj(input.properties) ? input.properties : {};
  const items = isObj(props.elements) && isObj(props.elements.items) ? props.elements.items : {};
  const variants = (Array.isArray(items.oneOf) ? items.oneOf : []).filter(isObj);
  if (variants.length === 0) throw new Error('openboard.element.create has no element variants');

  const propsOf = (v: Schema): Record<string, unknown> => (isObj(v.properties) ? v.properties : {});
  const first = propsOf(variants[0] as Schema);
  const common: Record<string, unknown> = {};
  for (const [k, schema] of Object.entries(first)) {
    if (k === 'type') continue;
    const same = variants.every((v) => JSON.stringify(propsOf(v)[k]) === JSON.stringify(schema));
    if (same) common[k] = schema;
  }
  const types: string[] = [];
  const extras: ElementDocs['extras'] = {};
  for (const v of variants) {
    const t = propsOf(v).type;
    const type = isObj(t) ? String(t.const) : '?';
    types.push(type);
    const own: Record<string, unknown> = {};
    for (const [k, schema] of Object.entries(propsOf(v))) if (k !== 'type' && !(k in common)) own[k] = schema;
    const required = (Array.isArray(v.required) ? (v.required as string[]) : []).filter((k) => k !== 'type');
    extras[type] = { props: own, required };
  }
  return { types, common, extras };
}

/** `name?: type;` lines for a property map. */
export function propLines(props: Record<string, unknown>, required: string[] = [], indent = '  '): string {
  return Object.entries(props)
    .map(([k, schema]) => `${indent}${k}${required.includes(k) ? '' : '?'}: ${schemaToTs(schema)};`)
    .join('\n');
}
