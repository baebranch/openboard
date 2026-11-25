import {
  COORD_RANGE,
  FONT_SIZE_RANGE,
  FREEHAND_BASE_WIDTH_RANGE,
  MIN_SIZE,
  OPACITY_RANGE,
  ROTATION_RANGE,
  STROKE_WIDTH_RANGE,
  type ElementType,
  type Range,
} from '../model';

export type PropertyKind = 'number' | 'enum' | 'color';

export interface PropertyDescriptor {
  readonly name: string;
  readonly kind: PropertyKind;
  /** Inclusive numeric range (number kind). Corner radius max is contextual. */
  readonly range?: Range;
  /** Decimal places retained (number kind). Undefined means no rounding. */
  readonly precision?: number;
  /** Allowed values (enum kind). */
  readonly values?: readonly string[];
  /** Upper bound is half of the shorter side of the element. */
  readonly maxFromShorterSide?: boolean;
  /** Element types the property applies to. Undefined means all. */
  readonly appliesTo?: readonly ElementType[];
}

const TEXT_TYPES: readonly ElementType[] = ['text', 'sticky', 'flowNode'];

export const PROPERTY_DESCRIPTORS: Readonly<Record<string, PropertyDescriptor>> = {
  x: { name: 'x', kind: 'number', range: COORD_RANGE, precision: 2 },
  y: { name: 'y', kind: 'number', range: COORD_RANGE, precision: 2 },
  width: { name: 'width', kind: 'number', range: { min: MIN_SIZE, max: Infinity }, precision: 2 },
  height: { name: 'height', kind: 'number', range: { min: MIN_SIZE, max: Infinity }, precision: 2 },
  rotation: { name: 'rotation', kind: 'number', range: ROTATION_RANGE },
  strokeWidth: { name: 'strokeWidth', kind: 'number', range: STROKE_WIDTH_RANGE },
  opacity: { name: 'opacity', kind: 'number', range: OPACITY_RANGE },
  cornerRadius: {
    name: 'cornerRadius',
    kind: 'number',
    range: { min: 0, max: Infinity },
    maxFromShorterSide: true,
    appliesTo: ['rectangle', 'frame', 'sticky', 'flowNode', 'image'],
  },
  fontSize: { name: 'fontSize', kind: 'number', range: FONT_SIZE_RANGE, appliesTo: TEXT_TYPES },
  baseWidth: {
    name: 'baseWidth',
    kind: 'number',
    range: FREEHAND_BASE_WIDTH_RANGE,
    appliesTo: ['freehand'],
  },
  strokeStyle: { name: 'strokeStyle', kind: 'enum', values: ['solid', 'dashed', 'dotted'] },
  align: { name: 'align', kind: 'enum', values: ['left', 'center', 'right'], appliesTo: TEXT_TYPES },
  fill: { name: 'fill', kind: 'color' },
  stroke: { name: 'stroke', kind: 'color' },
};
