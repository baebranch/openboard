/**
 * Renders a JSON Schema (the subset used by the tool registry) as a compact TypeScript type. Used
 * to generate the skill docs and the `ob` declarations, so they cannot drift from the schemas.
 */

type Schema = { [key: string]: unknown };

export interface RenderOptions {
  /** Maps `{ "$ref": name }` or a schema `title` to a type name to print instead of expanding. */
  named?: Record<string, string>;
  /** Max inline width before an object type is broken over several lines. */
  width?: number;
}

const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);
const KEY_RE = /^[A-Za-z_$][\w$]*$/;
const lit = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v) : String(v));

function hint(s: Schema): string {
  const hasMin = typeof s.minimum === 'number';
  const hasMax = typeof s.maximum === 'number';
  if (hasMin || hasMax) return ` /* ${hasMin ? s.minimum : ''}..${hasMax ? s.maximum : ''} */`;
  if (typeof s.maxLength === 'number') return ` /* max ${s.maxLength} chars */`;
  if (typeof s.minItems === 'number' || typeof s.maxItems === 'number') {
    return ` /* ${typeof s.minItems === 'number' ? s.minItems : 0}..${typeof s.maxItems === 'number' ? s.maxItems : ''} items */`;
  }
  return '';
}

export function schemaToTs(schema: unknown, options: RenderOptions = {}, depth = 0): string {
  if (!isObj(schema)) return 'unknown';
  const named = options.named ?? {};
  if (typeof schema.$ref === 'string') return named[schema.$ref] ?? schema.$ref;
  if (typeof schema.title === 'string' && named[`title:${schema.title}`]) return named[`title:${schema.title}`] as string;
  if ('const' in schema) return lit(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(lit).join(' | ');
  const union = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(union)) return union.map((u) => schemaToTs(u, options, depth)).join(' | ');
  switch (schema.type) {
    case 'string':
      return `string${hint(schema)}`;
    case 'number':
    case 'integer':
      return `number${hint(schema)}`;
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const item = schemaToTs(schema.items, options, depth);
      const inner = /[|{ ]/.test(item) ? `Array<${item}>` : `${item}[]`;
      return inner + hint(schema);
    }
    case 'object':
      return renderObject(schema, options, depth);
    default:
      return 'unknown';
  }
}

function renderObject(schema: Schema, options: RenderOptions, depth: number): string {
  const props = isObj(schema.properties) ? schema.properties : {};
  const keys = Object.keys(props);
  if (keys.length === 0) return 'Record<string, unknown>';
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const members = keys.map((k) => {
    const key = KEY_RE.test(k) ? k : JSON.stringify(k);
    return `${key}${required.has(k) ? '' : '?'}: ${schemaToTs(props[k], options, depth + 1)}`;
  });
  const inline = `{ ${members.join('; ')} }`;
  if (inline.length <= (options.width ?? 110) && !inline.includes('\n')) return inline;
  const pad = '  '.repeat(depth + 1);
  return `{\n${members.map((m) => `${pad}${m};`).join('\n')}\n${'  '.repeat(depth)}}`;
}
