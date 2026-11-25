import { ELEMENT_TYPES, type ElementType } from '../model/types';
import { fieldsFor } from '../model/mockup-fields';
import {
  ALT_TEXT_MAX,
  COORD_RANGE,
  EDGE_LABEL_MAX,
  FONT_SIZE_RANGE,
  FREEHAND_BASE_WIDTH_RANGE,
  LIBRARY_NAME_LENGTH,
  MIN_SIZE,
  OPACITY_RANGE,
  ROTATION_RANGE,
  STROKE_WIDTH_RANGE,
  ZOOM_RANGE,
} from '../model/ranges';
import {
  CROSS_AXIS_ALIGNS,
  LAYOUT_SPACING_RANGE,
  MAIN_AXIS_ALIGNS,
  SIZING_MODES,
  STACK_DIRECTIONS,
} from '../layout/types';
import { COMPONENT_NAME_MAX } from '../components/types';
import { MAX_FONT_VALUE_LENGTH, MAX_TOKENS_PER_CATEGORY } from '../tokens/types';
import { extend, s, type JsonSchema } from './builder';

const LITERAL_COLOR = '(theme:default|#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))';
const TOKEN_REF = 'token:[A-Za-z0-9._-]{1,64}';
const HEX_COLOR = `^(${LITERAL_COLOR}|${TOKEN_REF})$`;

/** Color field: a literal color or a Token_Reference. */
export const color = (): JsonSchema => s.string({ pattern: HEX_COLOR });
/** Literal color only (used for Token values, which can never be references). */
export const literalColor = (): JsonSchema => s.string({ pattern: `^${LITERAL_COLOR}$` });
const coord = (): JsonSchema => s.number({ min: COORD_RANGE.min, max: COORD_RANGE.max });
const id = (): JsonSchema => s.string({ minLength: 1 });

export const point = (): JsonSchema => s.object({ x: coord(), y: coord() });

export const viewportSchema = (): JsonSchema =>
  s.object({ x: coord(), y: coord(), zoom: s.number({ min: ZOOM_RANGE.min, max: ZOOM_RANGE.max }) });

const styleSchema = (type: string): JsonSchema =>
  s.object({
    ...(fieldsFor('style', type as ElementType).includes('cornerRadii')
      ? { cornerRadii: s.opt(s.array(s.number({ min: 0 }), { minItems: 4, maxItems: 4 })) }
      : {}),
    ...(fieldsFor('style', type as ElementType).includes('imageFill')
      ? { imageFill: s.opt(s.object({ assetId: id(), fit: s.enum(['cover', 'contain', 'stretch']) })) }
      : {}),
    fill: color(),
    stroke: color(),
    strokeWidth: s.number({ min: STROKE_WIDTH_RANGE.min, max: STROKE_WIDTH_RANGE.max }),
    strokeStyle: s.enum(['solid', 'dashed', 'dotted']),
    opacity: s.number({ min: OPACITY_RANGE.min, max: OPACITY_RANGE.max }),
    cornerRadius: s.number({ min: 0 }),
  });

/** Layout gap / padding side: a number in range, or a Token_Reference to a number Token (Req 11.15). */
const spacing = (): JsonSchema => ({
  anyOf: [s.number({ min: LAYOUT_SPACING_RANGE.min, max: LAYOUT_SPACING_RANGE.max }), s.string({ pattern: `^${TOKEN_REF}$` })],
});
const sizingMode = (): JsonSchema => s.enum([...SIZING_MODES]);

const sizingSchema = (): JsonSchema => s.object({ width: sizingMode(), height: sizingMode() });

const layoutSchema = (): JsonSchema =>
  s.object({
    direction: s.enum([...STACK_DIRECTIONS]),
    gap: spacing(),
    padding: s.object({ top: spacing(), right: spacing(), bottom: spacing(), left: spacing() }),
    mainAlign: s.enum([...MAIN_AXIS_ALIGNS]),
    crossAlign: s.enum([...CROSS_AXIS_ALIGNS]),
  });

const baseProps = (type: string): JsonSchema =>
  s.object({
    id: id(),
    type: s.const(type),
    x: coord(),
    y: coord(),
    width: s.number({ min: MIN_SIZE }),
    height: s.number({ min: MIN_SIZE }),
    rotation: s.number({ min: ROTATION_RANGE.min, max: ROTATION_RANGE.max }),
    parentId: s.opt(id()),
    locked: s.opt(s.boolean()),
    groupId: s.opt(s.string()),
    sizing: s.opt(sizingSchema()),
    ignoreLayout: s.opt(s.boolean()),
    style: styleSchema(type),
  });

const textProps = (): JsonSchema =>
  s.object({
    runs: s.array(
      s.object({
        text: s.string(),
        bold: s.opt(s.boolean()),
        italic: s.opt(s.boolean()),
        underline: s.opt(s.boolean()),
      }),
    ),
    fontFamily: s.string(),
    fontSize: s.number({ min: FONT_SIZE_RANGE.min, max: FONT_SIZE_RANGE.max }),
    align: s.enum(['left', 'center', 'right']),
    fontWeight: s.opt(s.integer({ min: 100, max: 900, multipleOf: 100 })),
    textColor: s.opt(color()),
    textWrap: s.opt(s.enum(['none', 'wrap'])),
  });

/** One Override: every Overridable_Property is optional; unknown properties are allowed. */
const overrideSchema = (): JsonSchema =>
  s.object({
    text: s.opt(s.string()),
    fill: s.opt(color()),
    stroke: s.opt(color()),
    textColor: s.opt(color()),
    fontWeight: s.opt(s.integer({ min: 100, max: 900, multipleOf: 100 })),
    imageFill: s.opt(s.object({ assetId: id(), fit: s.enum(['cover', 'contain', 'stretch']) })),
    icon: s.opt(s.string()),
    opacity: s.opt(s.number({ min: OPACITY_RANGE.min, max: OPACITY_RANGE.max })),
    visible: s.opt(s.boolean()),
    width: s.opt(s.number({ min: MIN_SIZE })),
    height: s.opt(s.number({ min: MIN_SIZE })),
  });

const arrowHead = (): JsonSchema => s.enum(['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar']);

const extraProps: Record<string, () => JsonSchema> = {
  rectangle: () => s.object({}),
  ellipse: () => s.object({}),
  diamond: () => s.object({}),
  line: () => s.object({}),
  arrow: () => s.object({}),
  freehand: () =>
    s.object({
      points: s.array(
        s.object({ x: coord(), y: coord(), p: s.opt(s.number({ min: 0, max: 1 })) }),
      ),
      baseWidth: s.number({ min: FREEHAND_BASE_WIDTH_RANGE.min, max: FREEHAND_BASE_WIDTH_RANGE.max }),
    }),
  text: textProps,
  sticky: textProps,
  image: () =>
    s.object({
      assetId: id(),
      crop: s.opt(s.object({ x: s.number(), y: s.number(), w: s.number(), h: s.number() })),
      alt: s.opt(s.string({ maxLength: ALT_TEXT_MAX })),
    }),
  frame: () =>
    s.object({
      name: s.string(),
      preset: s.opt(s.string()),
      clipContent: s.opt(s.boolean()),
      layout: s.opt(layoutSchema()),
      component: s.opt(s.string({ minLength: 1, maxLength: COMPONENT_NAME_MAX })),
      instanceOf: s.opt(id()),
      overrides: s.opt({ type: 'object', additionalProperties: overrideSchema() }),
    }),
  flowNode: () =>
    extend(
      textProps(),
      s.object({
        preset: s.enum([
          'startEnd',
          'process',
          'decision',
          'inputOutput',
          'database',
          'document',
          'annotation',
        ]),
      }),
    ),
  icon: () => s.object({ name: s.string({ minLength: 1, maxLength: 64 }) }),
  edge: () =>
    s.object({
      sourceId: id(),
      targetId: id(),
      routing: s.enum(['straight', 'curved', 'orthogonal']),
      sourceArrow: arrowHead(),
      targetArrow: arrowHead(),
      label: s.opt(s.string({ maxLength: EDGE_LABEL_MAX })),
    }),
};

/** Per-element schemas keyed by element type; returned by `openboard.schema` (Req 13.8). */
export function buildElementSchemas(): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const type of ELEMENT_TYPES) {
    const extra = extraProps[type];
    if (!extra) throw new Error(`No schema for element type ${type}`);
    out[type] = { ...extend(baseProps(type), extra()), title: type };
  }
  return out;
}

const tokenMap = (value: JsonSchema): JsonSchema => ({
  type: 'object',
  propertyNames: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,64}$' },
  additionalProperties: value,
  maxProperties: MAX_TOKENS_PER_CATEGORY,
});

/** Top-level `tokens` collection: at most 500 per category, no Token_Reference as a value. */
export const tokensSchema = (): JsonSchema =>
  s.object({
    // One literal, or exactly one literal per mode (Req 12.1).
    colors: s.opt(tokenMap({ anyOf: [literalColor(), s.object({ light: literalColor(), dark: literalColor() }, { additionalProperties: false })] })),
    fonts: s.opt(
      tokenMap({ type: 'string', minLength: 1, maxLength: MAX_FONT_VALUE_LENGTH, not: { type: 'string', pattern: '^token:' } }),
    ),
    numbers: s.opt(tokenMap({ type: 'number' })),
  });

export const assetSchema = (): JsonSchema =>
  s.object({
    id: id(),
    mime: s.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']),
    hash: s.string({ pattern: '^[0-9a-fA-F]{64}$' }),
    width: s.number({ min: 0 }),
    height: s.number({ min: 0 }),
    data: s.string(),
  });

export const libraryComponentSchema = (): JsonSchema =>
  s.object({
    id: id(),
    name: s.string({ minLength: LIBRARY_NAME_LENGTH.min, maxLength: LIBRARY_NAME_LENGTH.max }),
    elements: s.array(s.ref('Element')),
    builtin: s.opt(s.boolean()),
    tokens: s.opt(tokensSchema()),
  });
