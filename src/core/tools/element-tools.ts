/**
 * `openboard.element.create | update | query | delete` (Req 13.4, 13.5, 13.14, 13.17, 6.8).
 * Handlers are synchronous and mutate only through the transaction `tx` they are given.
 */
import { ELEMENT_TYPES, type Element, type ElementType } from '../model';
import type { ElementInput, ElementPatch, Tx } from '../ops';
import { validateProperty } from '../properties';
import { buildElementSchemas } from '../schema/elements';
import { s, type JsonSchema } from '../schema/builder';
import { defaultStyle } from '../shapes';
import type { DefaultToolRegistry, ToolContext, ToolDefinition } from './registry';

export const MAX_SELECTED = 1000;
export const MAX_PAGE = 500;
export const DEFAULT_PAGE = 100;

class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// --- property normalisation ---------------------------------------------------------------------

const STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'strokeStyle', 'opacity', 'cornerRadius'] as const;
const BASE_NUMBER_KEYS = ['x', 'y', 'width', 'height', 'rotation'] as const;
const TEXT_TYPES: readonly ElementType[] = ['text', 'sticky', 'flowNode'];
const ARROW_HEADS = ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar'];
const PASS_ENUMS: Record<string, readonly string[]> = {
  routing: ['straight', 'curved', 'orthogonal'],
  sourceArrow: ARROW_HEADS,
  targetArrow: ARROW_HEADS,
  preset: ['startEnd', 'process', 'decision', 'inputOutput', 'database', 'document', 'annotation'],
};

/** Non-descriptor properties settable per element type (besides the common ones). */
function passthroughKeys(type: ElementType): readonly string[] {
  const common = ['locked', 'groupId', 'parentId'];
  switch (type) {
    case 'text':
    case 'sticky':
      return [...common, 'runs', 'text', 'fontFamily'];
    case 'flowNode':
      return [...common, 'runs', 'text', 'fontFamily', 'preset'];
    case 'frame':
      return [...common, 'name', 'preset'];
    case 'edge':
      return [...common, 'sourceId', 'targetId', 'routing', 'sourceArrow', 'targetArrow', 'label'];
    case 'image':
      return [...common, 'assetId', 'alt', 'crop'];
    case 'freehand':
      return [...common, 'points'];
    default:
      return common;
  }
}

const DESCRIPTOR_KEYS: readonly string[] = [
  ...BASE_NUMBER_KEYS,
  ...STYLE_KEYS,
  'fontSize',
  'align',
  'baseWidth',
];

interface Normalised {
  top: Record<string, unknown>;
  style: Record<string, unknown>;
}

/**
 * Validates `props` (flat names; style properties may be flat) for an element of `type`.
 * `size` supplies width/height for the corner-radius bound when they are not part of `props`.
 */
function normalise(
  type: ElementType,
  props: Record<string, unknown>,
  size: { width: number; height: number },
  where: string,
): Normalised {
  const top: Record<string, unknown> = {};
  const style: Record<string, unknown> = {};
  const allowed = passthroughKeys(type);

  // Resolve width/height first so cornerRadius is judged against the final size.
  const resolved: Record<string, number | string> = {};
  for (const key of ['width', 'height'] as const) {
    if (key in props) {
      const r = validateProperty(type, key, props[key]);
      if (!r.ok) throw new ToolFailure('invalid_property', `${where}: ${r.error}`);
      resolved[key] = r.value;
    }
  }
  const ctx = {
    width: typeof resolved['width'] === 'number' ? resolved['width'] : size.width,
    height: typeof resolved['height'] === 'number' ? resolved['height'] : size.height,
  };

  for (const [key, value] of Object.entries(props)) {
    if (key === 'id' || key === 'type') {
      throw new ToolFailure('invalid_property', `${where}: "${key}" cannot be set here`);
    }
    if (key === 'width' || key === 'height') {
      top[key] = resolved[key];
    } else if (DESCRIPTOR_KEYS.includes(key)) {
      const r = validateProperty(type, key, value, ctx);
      if (!r.ok) throw new ToolFailure('invalid_property', `${where}: ${r.error}`);
      if ((STYLE_KEYS as readonly string[]).includes(key)) style[key] = r.value;
      else top[key] = r.value;
    } else if (allowed.includes(key)) {
      const values = PASS_ENUMS[key];
      if (values && !(typeof value === 'string' && values.includes(value))) {
        throw new ToolFailure('invalid_property', `${where}: "${key}" must be one of: ${values.join(', ')}`);
      }
      if (key === 'text') {
        if (typeof value !== 'string') throw new ToolFailure('invalid_property', `${where}: "text" must be a string`);
        top['runs'] = [{ text: value }];
      } else if (key === 'parentId' && value === null) {
        top['parentId'] = undefined;
      } else {
        top[key] = value;
      }
    } else {
      throw new ToolFailure('unknown_property', `${where}: unknown property "${key}" for ${type}`);
    }
  }
  return { top, style };
}

// --- selection ----------------------------------------------------------------------------------

interface Selector {
  ids?: string[];
  type?: ElementType;
  filter?: Record<string, unknown>;
}

function matches(el: Element, sel: Selector): boolean {
  if (sel.type !== undefined && el.type !== sel.type) return false;
  if (sel.filter) {
    const rec = el as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(sel.filter)) {
      const actual = k in rec ? rec[k] : (el.style as unknown as Record<string, unknown>)[k];
      if (actual !== v) return false;
    }
  }
  return true;
}

/** Elements chosen by `sel`, in document order. Unknown ids fail with `not_found` naming them. */
function select(elements: readonly Element[], sel: Selector): Element[] {
  let idSet: Set<string> | undefined;
  if (sel.ids) {
    idSet = new Set(sel.ids);
    const known = new Set(elements.map((e) => e.id));
    const missing = [...idSet].filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new ToolFailure('not_found', `Element not found: ${missing.join(', ')}`);
    }
  }
  return elements.filter((e) => (idSet === undefined || idSet.has(e.id)) && matches(e, sel));
}

function requireSelector(sel: Selector): void {
  if (sel.ids === undefined && sel.type === undefined && sel.filter === undefined) {
    throw new ToolFailure('invalid_selector', 'Provide at least one of ids, type, or filter');
  }
}

function selectBounded(elements: readonly Element[], sel: Selector): Element[] {
  requireSelector(sel);
  const picked = select(elements, sel);
  if (picked.length === 0) throw new ToolFailure('no_match', 'No elements match the selection');
  if (picked.length > MAX_SELECTED) {
    throw new ToolFailure('too_many_elements', `Selection matches ${picked.length} elements; the limit is ${MAX_SELECTED}`);
  }
  return picked;
}

// --- schemas ------------------------------------------------------------------------------------

const boardProp = () => s.opt(s.string({ minLength: 1 }));
const idList = () => s.array(s.string({ minLength: 1 }), { minItems: 1, maxItems: MAX_SELECTED });
const typeEnum = () => s.enum(ELEMENT_TYPES);

const selectorShape = () => ({
  board: boardProp(),
  ids: s.opt(idList()),
  type: s.opt(typeEnum()),
  filter: s.opt(s.object({})),
});

const REQUIRED_ON_CREATE: Partial<Record<ElementType, string[]>> = {
  edge: ['sourceId', 'targetId'],
  image: ['assetId'],
  freehand: ['points'],
};

/** Per-type creation schema: only `type` (plus the type's essential references) is required. */
function createItemSchemas(): JsonSchema[] {
  const full = buildElementSchemas();
  return ELEMENT_TYPES.map((type) => {
    const schema = full[type] as JsonSchema;
    const properties = { ...(schema['properties'] as Record<string, JsonSchema>) };
    properties['style'] = s.object({});
    if (TEXT_TYPES.includes(type)) properties['text'] = s.string();
    return { ...schema, properties, required: ['type', ...(REQUIRED_ON_CREATE[type] ?? [])] };
  });
}

const itemsOutput = () => s.array(s.object({}));

// --- create -------------------------------------------------------------------------------------

function typeDefaults(type: ElementType): Record<string, unknown> {
  switch (type) {
    case 'text':
    case 'sticky':
      return { runs: [{ text: '' }], fontFamily: 'sans-serif', fontSize: 16, align: 'left' };
    case 'flowNode':
      return { runs: [{ text: '' }], fontFamily: 'sans-serif', fontSize: 16, align: 'center', preset: 'process' };
    case 'frame':
      return { name: 'Frame' };
    case 'edge':
      return { routing: 'straight', sourceArrow: 'none', targetArrow: 'arrow' };
    case 'freehand':
      return { baseWidth: 4 };
    default:
      return {};
  }
}

function buildElement(raw: Record<string, unknown>, index: number): ElementInput {
  const type = raw['type'] as ElementType;
  const where = `elements[${index}]`;
  const { type: _t, id, style: styleIn, ...rest } = raw;
  void _t;
  const flat = { ...(styleIn as Record<string, unknown> | undefined), ...rest };
  const defaults = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  const n = normalise(type, flat, { width: defaults.width, height: defaults.height }, where);
  const el: Record<string, unknown> = {
    ...defaults,
    ...typeDefaults(type),
    ...n.top,
    id,
    type,
    style: { ...defaultStyle(), ...n.style },
  };
  if (id === undefined) delete el['id'];
  for (const k of Object.keys(el)) if (el[k] === undefined) delete el[k];
  return el as unknown as ElementInput;
}

const createTool: ToolDefinition<{ elements: Record<string, unknown>[] }, { created: Element[]; ids: string[] }> = {
  name: 'openboard.element.create',
  description:
    'Create one or more elements on a board. Each item has a `type` discriminator plus type-specific properties; omitted properties take defaults. Returns the created elements.',
  inputSchema: s.object({
    board: boardProp(),
    elements: s.array(s.union('type', createItemSchemas()), { minItems: 1, maxItems: MAX_SELECTED }),
  }),
  outputSchema: s.object({ created: itemsOutput(), ids: s.array(s.string()) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = needTx(ctx);
    const created = input.elements.map((raw, i) => tx.create(buildElement(raw, i)));
    return { created, ids: created.map((e) => e.id) };
  },
};

// --- update -------------------------------------------------------------------------------------

interface UpdateInput extends Selector {
  set: Record<string, unknown>;
}

const updateTool: ToolDefinition<UpdateInput, { updated: number; ids: string[] }> = {
  name: 'openboard.element.update',
  description:
    'Update 1 to 1000 elements chosen by `ids`, `type`, or a property `filter` (conditions are combined). `set` holds the properties to apply to every selected element; each value is validated against its range.',
  inputSchema: s.object({ ...selectorShape(), set: s.object({}) }),
  outputSchema: s.object({ updated: s.integer({ min: 0 }), ids: s.array(s.string()) }),
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = needTx(ctx);
    if (Object.keys(input.set).length === 0) throw new ToolFailure('invalid_input', '`set` must contain at least one property');
    const picked = selectBounded(tx.doc.elements, input);
    // Validate every element before touching the document; any failure aborts the whole call.
    const patches = picked.map((el) => {
      const n = normalise(el.type, input.set, el, `element ${el.id}`);
      const patch: Record<string, unknown> = { ...n.top };
      if (Object.keys(n.style).length > 0) patch['style'] = n.style;
      return { id: el.id, patch: patch as ElementPatch };
    });
    for (const p of patches) tx.update(p.id, p.patch);
    return { updated: patches.length, ids: patches.map((p) => p.id) };
  },
};

// --- query --------------------------------------------------------------------------------------

interface QueryInput extends Selector {
  limit?: number;
  offset?: number;
  cursor?: string;
}

interface QueryOutput {
  items: Element[];
  total: number;
  offset: number;
  nextOffset?: number;
  nextCursor?: string;
}

const queryTool: ToolDefinition<QueryInput, QueryOutput> = {
  name: 'openboard.element.query',
  description:
    'Query elements by `ids`, `type`, and/or property `filter` (all optional), in z-order, with pagination (`limit` 1 to 500, default 100; `offset` or `cursor` from a previous `nextCursor`). Returns items, total match count, and the next offset/cursor when more remain.',
  inputSchema: s.object({
    ...selectorShape(),
    limit: s.opt(s.integer({ min: 1, max: MAX_PAGE })),
    offset: s.opt(s.integer({ min: 0 })),
    cursor: s.opt(s.string({ minLength: 1 })),
  }),
  outputSchema: s.object({
    items: itemsOutput(),
    total: s.integer({ min: 0 }),
    offset: s.integer({ min: 0 }),
    nextOffset: s.opt(s.integer({ min: 0 })),
    nextCursor: s.opt(s.string()),
  }),
  readOnly: true,
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = needTx(ctx);
    let offset = input.offset ?? 0;
    if (input.cursor !== undefined) {
      if (!/^\d+$/.test(input.cursor)) throw new ToolFailure('invalid_cursor', `Invalid cursor: ${input.cursor}`);
      offset = Number(input.cursor);
    }
    const limit = input.limit ?? DEFAULT_PAGE;
    const all = select(tx.doc.elements, input);
    const items = all.slice(offset, offset + limit);
    const out: QueryOutput = { items, total: all.length, offset };
    const next = offset + items.length;
    if (items.length > 0 && next < all.length) {
      out.nextOffset = next;
      out.nextCursor = String(next);
    }
    return out;
  },
};

// --- delete -------------------------------------------------------------------------------------

const deleteTool: ToolDefinition<Selector, { deleted: string[]; cascaded: string[] }> = {
  name: 'openboard.element.delete',
  description:
    'Delete 1 to 1000 elements chosen by `ids`, `type`, or a property `filter`. Edges attached to a deleted element are deleted too and reported in `cascaded`. Destructive.',
  inputSchema: s.object(selectorShape()),
  outputSchema: s.object({ deleted: s.array(s.string()), cascaded: s.array(s.string()) }),
  destructive: true,
  boardResolution: 'required-or-active',
  handler(ctx, input) {
    const tx = needTx(ctx);
    const picked = selectBounded(tx.doc.elements, input);
    const requested = picked.map((e) => e.id);
    const before = tx.doc.elements.map((e) => e.id);
    for (const id of requested) {
      // A requested edge may already have been removed by the cascade of an earlier delete.
      if (tx.doc.elements.some((e) => e.id === id)) tx.remove(id);
    }
    const after = new Set(tx.doc.elements.map((e) => e.id));
    const asked = new Set(requested);
    const cascaded = before.filter((id) => !after.has(id) && !asked.has(id));
    return { deleted: requested, cascaded };
  },
};

function needTx(ctx: ToolContext): Tx {
  if (!ctx.tx) throw new ToolFailure('no_board', 'No board is available for this tool');
  return ctx.tx;
}

export const elementTools: ToolDefinition[] = [createTool, updateTool, queryTool, deleteTool];

export function registerElementTools(registry: Pick<DefaultToolRegistry, 'register'>): void {
  for (const t of elementTools) registry.register(t);
}
