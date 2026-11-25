/**
 * `openboard.element.create | update | query | delete` (Req 13.4, 13.5, 13.14, 13.17, 6.8).
 * Handlers are synchronous and mutate only through the transaction `tx` they are given.
 */
import { COMPONENT_NAME_MAX, ROOT_OVERRIDE_KEY, type Override } from '../components/types';
import { ELEMENT_TYPES, fieldsFor, maxCornerRadius, type Element, type ElementType } from '../model';
import {
  CROSS_AXIS_ALIGNS,
  LAYOUT_SPACING_RANGE,
  MAIN_AXIS_ALIGNS,
  SIZING_MODES,
  STACK_DIRECTIONS,
  type LayoutSpec,
  type Sizing,
  type Spacing,
} from '../layout/types';
import { scanTokenReferences } from '../tokens/references';
import { isTokenReference, tokenRefName, validateTokenName } from '../tokens/validate';
import { MIN_SIZE, OPACITY_RANGE } from '../model/ranges';
import type { ElementInput, ElementPatch, Tx } from '../ops';
import { validateProperty } from '../properties';
import { buildElementSchemas } from '../schema/elements';
import { s, type JsonSchema } from '../schema/builder';
import { defaultStyle, frameNestingProblem } from '../shapes';
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

/** Rejects the whole edit (the throw rolls the transaction back) when it breaks Frame nesting (Req 21.6). */
function assertFrameNesting(tx: Tx, changedIds: readonly string[]): void {
  const problem = frameNestingProblem(tx.doc.elements, changedIds);
  if (problem !== undefined) throw new ToolFailure('invalid_parent', problem);
}

// --- property normalisation ---------------------------------------------------------------------

const STYLE_KEYS: readonly string[] = [
  'fill', 'stroke', 'strokeWidth', 'strokeStyle', 'opacity', 'cornerRadius',
  ...fieldsFor('style'),
];
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
  const common = ['locked', 'groupId', 'parentId', ...fieldsFor('base', type)];
  return [...passthroughBase(type, common), ...fieldsFor('type', type)];
}

function passthroughBase(type: ElementType, common: string[]): readonly string[] {
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

/** `style.cornerRadii`: exactly four finite numbers, each between 0 and half the shorter side. */
function validateCornerRadii(
  type: ElementType,
  value: unknown,
  size: { width: number; height: number },
  where: string,
): [number, number, number, number] {
  const path = `style.cornerRadii (${type})`;
  if (!Array.isArray(value) || value.length !== 4) {
    throw new ToolFailure('invalid_property', `${where}: "${path}" must be an array of exactly four numbers`);
  }
  const max = maxCornerRadius(size.width, size.height);
  for (let i = 0; i < 4; i++) {
    const v: unknown = value[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new ToolFailure('invalid_property', `${where}: "${path}[${i}]" must be a finite number`);
    }
    if (v < 0 || v > max) {
      throw new ToolFailure('invalid_property', `${where}: "${path}[${i}]" must be between 0 and ${max}`);
    }
  }
  return [value[0], value[1], value[2], value[3]] as [number, number, number, number];
}

/** `style.imageFill`: `{ assetId, fit }`; the asset need not exist (dangling ids are valid). */
function validateImageFill(
  type: ElementType,
  value: unknown,
  where: string,
): { assetId: string; fit: 'cover' | 'contain' | 'stretch' } {
  const path = `style.imageFill (${type})`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolFailure('invalid_property', `${where}: "${path}" must be an object with assetId and fit`);
  }
  const { assetId, fit, ...rest } = value as Record<string, unknown>;
  const extra = Object.keys(rest)[0];
  if (extra !== undefined) {
    throw new ToolFailure('invalid_property', `${where}: "${path}.${extra}" is not a known property`);
  }
  if (typeof assetId !== 'string' || assetId.length === 0) {
    throw new ToolFailure('invalid_property', `${where}: "${path}.assetId" must be a non-empty string`);
  }
  if (fit !== 'cover' && fit !== 'contain' && fit !== 'stretch') {
    throw new ToolFailure('invalid_property', `${where}: "${path}.fit" must be one of: cover, contain, stretch`);
  }
  return { assetId, fit };
}

const ICON_NAME_MAX = 64;
/** Req 23.3: default Icon size and stroke width in canvas units. */
const ICON_DEFAULT_SIZE = 24;
const ICON_DEFAULT_STROKE_WIDTH = 2;

/** `component`: a string of 1 to 100 characters after trimming; the trimmed value is stored. */
function validateComponentName(value: unknown, where: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'string' || trimmed.length < 1 || trimmed.length > COMPONENT_NAME_MAX) {
    throw new ToolFailure('invalid_property', `${where}: "component" must be a name of 1 to ${COMPONENT_NAME_MAX} characters`);
  }
  return trimmed;
}

const COLOR_RE = /^(?:theme:default|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|token:[A-Za-z0-9._-]{1,64})$/;

/** Validates one Overridable_Property value; returns an error message or undefined. */
export function overrideValueError(key: string, v: unknown, root: boolean): string | undefined {
  switch (key) {
    case 'text':
      return typeof v === 'string' ? undefined : 'must be a string';
    case 'icon':
      return typeof v === 'string' && v.length >= 1 && v.length <= ICON_NAME_MAX
        ? undefined
        : `must be a string of 1 to ${ICON_NAME_MAX} characters`;
    case 'fill':
    case 'stroke':
    case 'textColor':
      return typeof v === 'string' && COLOR_RE.test(v) ? undefined : 'must be "theme:default", a hex color, or a token reference';
    case 'fontWeight':
      return typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0
        ? undefined
        : 'must be an integer from 100 to 900 in steps of 100';
    case 'opacity':
      return typeof v === 'number' && Number.isFinite(v) && v >= OPACITY_RANGE.min && v <= OPACITY_RANGE.max
        ? undefined
        : `must be a number from ${OPACITY_RANGE.min} to ${OPACITY_RANGE.max}`;
    case 'visible':
      if (root) return 'is not valid on the instance root (key "")';
      return typeof v === 'boolean' ? undefined : 'must be true or false';
    case 'width':
    case 'height':
      if (!root) return 'is only valid on the instance root (key "")';
      return typeof v === 'number' && Number.isFinite(v) && v >= MIN_SIZE ? undefined : `must be a number of at least ${MIN_SIZE}`;
    case 'imageFill': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'must be an object with assetId and fit';
      const { assetId, fit, ...rest } = v as Record<string, unknown>;
      if (Object.keys(rest).length > 0) return `has unknown property "${Object.keys(rest)[0]}"`;
      if (typeof assetId !== 'string' || assetId.length === 0) return 'assetId must be a non-empty string';
      if (fit !== 'cover' && fit !== 'contain' && fit !== 'stretch') return 'fit must be one of: cover, contain, stretch';
      return undefined;
    }
    default:
      return 'is not an overridable property';
  }
}

/** `overrides`: a map from master child id (or `''` for the instance root) to Overridable_Property values. */
function validateOverrides(value: unknown, where: string): Record<string, Override> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolFailure('invalid_property', `${where}: "overrides" must be an object keyed by master child id`);
  }
  const out: Record<string, Override> = {};
  for (const [childId, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = `overrides[${JSON.stringify(childId)}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ToolFailure('invalid_property', `${where}: "${path}" must be an object`);
    }
    for (const [key, v] of Object.entries(entry as Record<string, unknown>)) {
      const error = overrideValueError(key, v, childId === ROOT_OVERRIDE_KEY);
      if (error !== undefined) throw new ToolFailure('invalid_property', `${where}: "${path}.${key}" ${error}`);
    }
    out[childId] = { ...(entry as Override) };
  }
  return out;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rejects keys outside `allowed`, naming the full property path. */
function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string, where: string): void {
  const extra = Object.keys(obj).find((k) => !allowed.includes(k));
  if (extra !== undefined) throw new ToolFailure('invalid_property', `${where}: "${path}.${extra}" is not a known property`);
}

function validateSpacing(value: unknown, path: string, where: string): Spacing {
  // Req 11.15: a Token_Reference to a number Token is accepted; a missing Token resolves to 0.
  if (typeof value === 'string' && isTokenReference(value)) {
    if (!validateTokenName(tokenRefName(value)).ok) {
      throw new ToolFailure('invalid_property', `${where}: "${path}" has an invalid token name`);
    }
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolFailure('invalid_property', `${where}: "${path}" must be a finite number or a "token:<name>" number Token reference`);
  }
  if (value < LAYOUT_SPACING_RANGE.min || value > LAYOUT_SPACING_RANGE.max) {
    throw new ToolFailure(
      'invalid_property',
      `${where}: "${path}" must be between ${LAYOUT_SPACING_RANGE.min} and ${LAYOUT_SPACING_RANGE.max}`,
    );
  }
  return value;
}

function validateEnumValue<T extends string>(value: unknown, allowed: readonly T[], path: string, where: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ToolFailure('invalid_property', `${where}: "${path}" must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

/**
 * `layout`: a complete LayoutConfig; gap and padding sides are finite numbers from 0 to 1000, or
 * `token:<name>` references to number Tokens (Req 11.15).
 */
function validateLayout(value: unknown, where: string): LayoutSpec {
  if (!plainObject(value)) {
    throw new ToolFailure('invalid_property', `${where}: "layout" must be an object`);
  }
  rejectUnknownKeys(value, ['direction', 'gap', 'padding', 'mainAlign', 'crossAlign'], 'layout', where);
  for (const key of ['direction', 'gap', 'padding', 'mainAlign', 'crossAlign']) {
    if (value[key] === undefined) throw new ToolFailure('invalid_property', `${where}: "layout.${key}" is required`);
  }
  const direction = validateEnumValue(value['direction'], STACK_DIRECTIONS, 'layout.direction', where);
  const gap = validateSpacing(value['gap'], 'layout.gap', where);
  const pad = value['padding'];
  if (!plainObject(pad)) throw new ToolFailure('invalid_property', `${where}: "layout.padding" must be an object`);
  rejectUnknownKeys(pad, ['top', 'right', 'bottom', 'left'], 'layout.padding', where);
  const padding = {
    top: validateSpacing(pad['top'], 'layout.padding.top', where),
    right: validateSpacing(pad['right'], 'layout.padding.right', where),
    bottom: validateSpacing(pad['bottom'], 'layout.padding.bottom', where),
    left: validateSpacing(pad['left'], 'layout.padding.left', where),
  };
  const mainAlign = validateEnumValue(value['mainAlign'], MAIN_AXIS_ALIGNS, 'layout.mainAlign', where);
  const crossAlign = validateEnumValue(value['crossAlign'], CROSS_AXIS_ALIGNS, 'layout.crossAlign', where);
  return { direction, gap, padding, mainAlign, crossAlign };
}

/** `sizing`: `{ width, height }`, each one of fixed, hug, fill. */
function validateSizing(value: unknown, where: string): Sizing {
  if (!plainObject(value)) {
    throw new ToolFailure('invalid_property', `${where}: "sizing" must be an object with width and height`);
  }
  rejectUnknownKeys(value, ['width', 'height'], 'sizing', where);
  return {
    width: validateEnumValue(value['width'], SIZING_MODES, 'sizing.width', where),
    height: validateEnumValue(value['height'], SIZING_MODES, 'sizing.height', where),
  };
}

interface Normalised {
  top: Record<string, unknown>;
  style: Record<string, unknown>;
}

/**
 * Validates `props` (flat names; style properties may be flat) for an element of `type`.
 * `size` supplies width/height for the corner-radius bound when they are not part of `props`.
 */
export function normalise(
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
    } else if (key === 'cornerRadii') {
      if (!fieldsFor('style', type).includes(key)) {
        throw new ToolFailure('unknown_property', `${where}: unknown property "style.cornerRadii" for ${type}`);
      }
      // `null` removes the per-corner override so `cornerRadius` applies again (undefined deletes the key on update).
      style[key] = value === null ? undefined : validateCornerRadii(type, value, ctx, where);
    } else if (key === 'imageFill') {
      if (!fieldsFor('style', type).includes(key)) {
        throw new ToolFailure('unknown_property', `${where}: unknown property "style.imageFill" for ${type}`);
      }
      style[key] = value === null ? undefined : validateImageFill(type, value, where);
    } else if ((key === 'fontWeight' || key === 'textColor') && fieldsFor('type', type).includes(key)) {
      if (key === 'fontWeight') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 900 || value % 100 !== 0) {
          throw new ToolFailure('invalid_property', `${where}: "fontWeight" must be an integer from 100 to 900 in steps of 100`);
        }
      } else if (
        typeof value !== 'string' ||
        (value !== 'theme:default' &&
          !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) &&
          !/^token:[A-Za-z0-9._-]{1,64}$/.test(value))
      ) {
        throw new ToolFailure(
          'invalid_property',
          `${where}: "textColor" must be "theme:default", a hex color, or a token reference`,
        );
      }
      top[key] = value;
    } else if (key === 'textWrap' && fieldsFor('type', type).includes(key)) {
      if (value !== 'none' && value !== 'wrap') {
        throw new ToolFailure('invalid_property', `${where}: "textWrap" must be one of: none, wrap`);
      }
      top[key] = value;
    } else if (key === 'clipContent' && fieldsFor('type', type).includes(key)) {
      if (typeof value !== 'boolean') {
        throw new ToolFailure('invalid_property', `${where}: "clipContent" must be a boolean`);
      }
      top[key] = value;
    } else if (key === 'layout' && fieldsFor('type', type).includes(key)) {
      top[key] = value === null ? undefined : validateLayout(value, where);
    } else if (key === 'sizing' && fieldsFor('base', type).includes(key)) {
      top[key] = value === null ? undefined : validateSizing(value, where);
    } else if (key === 'ignoreLayout' && fieldsFor('base', type).includes(key)) {
      if (value !== null && typeof value !== 'boolean') {
        throw new ToolFailure('invalid_property', `${where}: "ignoreLayout" must be a boolean`);
      }
      top[key] = value === null ? undefined : value;
    } else if (key === 'component' && fieldsFor('type', type).includes(key)) {
      // `null` removes the field (undefined deletes the key on update).
      top[key] = value === null ? undefined : validateComponentName(value, where);
    } else if (key === 'name' && type === 'icon') {
      // Any name outside the Icon_Set is valid and preserved (Req 23.14); only the length is checked.
      if (typeof value !== 'string' || value.length < 1 || value.length > ICON_NAME_MAX) {
        throw new ToolFailure('invalid_property', `${where}: "name" must be a string of 1 to ${ICON_NAME_MAX} characters`);
      }
      top[key] = value;
    } else if (key === 'instanceOf' && fieldsFor('type', type).includes(key)) {
      if (value !== null && (typeof value !== 'string' || value.length === 0)) {
        throw new ToolFailure('invalid_property', `${where}: "instanceOf" must be a non-empty element id`);
      }
      top[key] = value === null ? undefined : value;
    } else if (key === 'overrides' && fieldsFor('type', type).includes(key)) {
      top[key] = value === null ? undefined : validateOverrides(value, where);
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
      if (key === 'fontFamily') {
        if (typeof value !== 'string' || value.length < 1) {
          throw new ToolFailure('invalid_property', `${where}: "fontFamily" must be a non-empty string`);
        }
        if (value.startsWith('token:') && !/^token:[A-Za-z0-9._-]{1,64}$/.test(value)) {
          throw new ToolFailure('invalid_property', `${where}: "fontFamily" has an invalid token reference`);
        }
        top[key] = value;
      } else if (key === 'text') {
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
  /** Query-only filters (Req 25.6); combined with AND with every other condition. */
  instanceOf?: string;
  component?: string;
  parentId?: string;
  tokenRef?: string;
}

function matches(el: Element, sel: Selector): boolean {
  if (sel.type !== undefined && el.type !== sel.type) return false;
  const frame = el as { instanceOf?: string; component?: string };
  if (sel.instanceOf !== undefined && frame.instanceOf !== sel.instanceOf) return false;
  if (sel.component !== undefined && frame.component !== sel.component) return false;
  if (sel.parentId !== undefined && el.parentId !== sel.parentId) return false;
  if (sel.tokenRef !== undefined) {
    const wanted = tokenRefName(sel.tokenRef) ?? sel.tokenRef;
    if (!scanTokenReferences(el).some((o) => o.name === wanted)) return false;
  }
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
  icon: ['name'],
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
  const isIcon = type === 'icon';
  const defaults = { x: 0, y: 0, width: isIcon ? ICON_DEFAULT_SIZE : 100, height: isIcon ? ICON_DEFAULT_SIZE : 100, rotation: 0 };
  const n = normalise(type, flat, { width: defaults.width, height: defaults.height }, where);
  const el: Record<string, unknown> = {
    ...defaults,
    ...typeDefaults(type),
    ...n.top,
    id,
    type,
    style: { ...defaultStyle(), ...(isIcon ? { strokeWidth: ICON_DEFAULT_STROKE_WIDTH } : {}), ...n.style },
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
    assertFrameNesting(tx, created.map((e) => e.id));
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
      const style: Record<string, unknown> = { ...n.style };
      const radii = (el.style as { cornerRadii?: readonly number[] }).cornerRadii;
      if (radii && !('cornerRadii' in style) && ('width' in n.top || 'height' in n.top)) {
        const w = typeof n.top['width'] === 'number' ? n.top['width'] : el.width;
        const h = typeof n.top['height'] === 'number' ? n.top['height'] : el.height;
        const max = maxCornerRadius(w, h);
        if (radii.some((r) => r > max)) style['cornerRadii'] = radii.map((r) => Math.min(r, max));
      }
      if (Object.keys(style).length > 0) patch['style'] = style;
      return { id: el.id, patch: patch as ElementPatch };
    });
    for (const p of patches) tx.update(p.id, p.patch);
    if ('parentId' in input.set) assertFrameNesting(tx, patches.map((p) => p.id));
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
    'Query elements by `ids`, `type`, and/or property `filter` (all optional), plus `instanceOf`, `component`, `parentId`, and `tokenRef` (token name referenced in any field) filters, all combined with AND, in z-order, with pagination (`limit` 1 to 500, default 100; `offset` or `cursor` from a previous `nextCursor`). Returns items, total match count, and the next offset/cursor when more remain.',
  inputSchema: s.object({
    ...selectorShape(),
    instanceOf: s.opt(s.string({ minLength: 1 })),
    component: s.opt(s.string({ minLength: 1 })),
    parentId: s.opt(s.string({ minLength: 1 })),
    tokenRef: s.opt(s.string({ minLength: 1 })),
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
