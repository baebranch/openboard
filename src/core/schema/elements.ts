import { ELEMENT_TYPES } from '../model/types';
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
import { extend, s, type JsonSchema } from './builder';

const HEX_COLOR = '^(theme:default|#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))$';

export const color = (): JsonSchema => s.string({ pattern: HEX_COLOR });
const coord = (): JsonSchema => s.number({ min: COORD_RANGE.min, max: COORD_RANGE.max });
const id = (): JsonSchema => s.string({ minLength: 1 });

export const point = (): JsonSchema => s.object({ x: coord(), y: coord() });

export const viewportSchema = (): JsonSchema =>
  s.object({ x: coord(), y: coord(), zoom: s.number({ min: ZOOM_RANGE.min, max: ZOOM_RANGE.max }) });

const styleSchema = (): JsonSchema =>
  s.object({
    fill: color(),
    stroke: color(),
    strokeWidth: s.number({ min: STROKE_WIDTH_RANGE.min, max: STROKE_WIDTH_RANGE.max }),
    strokeStyle: s.enum(['solid', 'dashed', 'dotted']),
    opacity: s.number({ min: OPACITY_RANGE.min, max: OPACITY_RANGE.max }),
    cornerRadius: s.number({ min: 0 }),
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
    style: styleSchema(),
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
  frame: () => s.object({ name: s.string(), preset: s.opt(s.string()) }),
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
  });
