/**
 * Field Registry: the single place every Mockup_Field's name and location is declared.
 * Consumed by the parser's known-key lists and the element tools' key lists so they stay in lockstep.
 */
import type { ElementType } from './types';

export type FieldLocation = 'base' | 'style' | 'type';

export interface MockupFieldSpec {
  readonly name: string;
  readonly location: FieldLocation;
  /** Element types this field applies to; undefined = every type that has `location`'s bag. */
  readonly appliesTo?: readonly ElementType[];
  /** True once this field makes a document require Schema_Version 2. */
  readonly schemaV2: boolean;
  /** Non-empty human-readable description of the field. */
  readonly description: string;
  /** Non-empty value type summary (e.g. 'number', 'string'). */
  readonly valueType: string;
}

export const MOCKUP_FIELD_SPECS: readonly MockupFieldSpec[] = [
  {
    name: 'cornerRadii',
    location: 'style',
    appliesTo: ['rectangle', 'frame', 'sticky', 'flowNode', 'image'],
    schemaV2: false,
    description:
      'Per-corner radii in top-left, top-right, bottom-right, bottom-left order. Overrides cornerRadius; each value is 0 to half the shorter side.',
    valueType: '[number, number, number, number]',
  },
  {
    name: 'imageFill',
    location: 'style',
    appliesTo: ['rectangle', 'ellipse', 'diamond', 'frame', 'sticky', 'flowNode'],
    schemaV2: false,
    description:
      'Image fill: { assetId, fit } where fit is "cover", "contain" or "stretch". The image is drawn over the fill color; a missing asset renders the fill only.',
    valueType: "{ assetId: string, fit: 'cover' | 'contain' | 'stretch' }",
  },
  {
    name: 'fontWeight',
    location: 'type',
    appliesTo: ['text', 'sticky', 'flowNode'],
    schemaV2: false,
    description: 'Font weight: an integer from 100 to 900 in steps of 100.',
    valueType: 'integer (100 to 900, step 100)',
  },
  {
    name: 'textColor',
    location: 'type',
    appliesTo: ['text', 'sticky', 'flowNode'],
    schemaV2: false,
    description: 'Text color: "theme:default" or a hex color, the same forms as style.fill.',
    valueType: 'color string',
  },
  {
    name: 'textWrap',
    location: 'type',
    appliesTo: ['text', 'sticky', 'flowNode'],
    schemaV2: false,
    description: 'Text wrapping: "wrap" breaks lines at the element width; "none" (default) breaks only at newlines.',
    valueType: "'none' | 'wrap'",
  },
  {
    name: 'clipContent',
    location: 'type',
    appliesTo: ['frame'],
    schemaV2: false,
    description: 'When true, the frame clips its descendants to its own outline; default false.',
    valueType: 'boolean',
  },
  {
    name: 'layout',
    location: 'type',
    appliesTo: ['frame'],
    schemaV2: true,
    description:
      'Makes the frame a Layout_Frame that stacks its direct children: { direction, gap, padding, mainAlign, crossAlign }. direction is "horizontal" or "vertical"; gap and each padding side (top, right, bottom, left) are 0 to 1000, or "token:<name>" to use a number Token (a missing Token counts as 0); mainAlign is "start", "center", "end" or "spaceBetween"; crossAlign is "start", "center" or "end". Set null to remove.',
    valueType:
      "{ direction: 'horizontal' | 'vertical', gap: number | `token:${string}`, padding: { top, right, bottom, left: number | `token:${string}` }, mainAlign: 'start' | 'center' | 'end' | 'spaceBetween', crossAlign: 'start' | 'center' | 'end' }",
  },
  {
    name: 'sizing',
    location: 'base',
    schemaV2: true,
    description:
      'Per-axis sizing mode: { width, height }, each "fixed" (default), "hug" (fit content) or "fill" (share remaining space in a layout parent). Set null to remove.',
    valueType: "{ width: 'fixed' | 'hug' | 'fill', height: 'fixed' | 'hug' | 'fill' }",
  },
  {
    name: 'ignoreLayout',
    location: 'base',
    schemaV2: true,
    description: 'When true, a layout parent does not arrange this element; it keeps its own position. Set null to remove.',
    valueType: 'boolean',
  },
  {
    name: 'component',
    location: 'type',
    appliesTo: ['frame'],
    schemaV2: true,
    description: 'Marks the frame as a Component_Master with this name (1 to 100 characters, unique). Mutually exclusive with instanceOf.',
    valueType: 'string',
  },
  {
    name: 'instanceOf',
    location: 'type',
    appliesTo: ['frame'],
    schemaV2: true,
    description: 'Id of a Component_Master frame; marks this frame a Component_Instance whose children are derived from the master.',
    valueType: 'string (element id)',
  },
  {
    name: 'overrides',
    location: 'type',
    appliesTo: ['frame'],
    schemaV2: true,
    description:
      'Component_Instance overrides keyed by master child id (key "" is the instance root size). Each value may set text, fill, stroke, textColor, fontWeight, imageFill, icon, opacity, visible (false hides a child and its descendants), and for the root width, height, fill, stroke, opacity and imageFill.',
    valueType: 'Record<string, { text?, fill?, stroke?, textColor?, fontWeight?, imageFill?, icon?, opacity?, visible?, width?, height? }>',
  },
  {
    name: 'name',
    location: 'type',
    appliesTo: ['icon'],
    schemaV2: true,
    description: 'Icon name, 1 to 64 characters. A name outside the built-in Icon_Set renders a placeholder glyph and is preserved.',
    valueType: 'string (1 to 64 characters)',
  },
];

/** A Mockup_Field stored at the top level of the board document rather than on an element. */
export interface DocumentFieldSpec {
  readonly name: string;
  readonly schemaV2: boolean;
  readonly description: string;
  readonly valueType: string;
}

export const DOCUMENT_FIELD_SPECS: readonly DocumentFieldSpec[] = [
  {
    name: 'tokens',
    schemaV2: true,
    description:
      'Design tokens: { colors, fonts, numbers }, each a map of token name to literal value (at most 500 per category). Color fields and fontFamily reference a token as "token:<name>"; layout gap and padding sides may reference a number token the same way.',
    valueType: '{ colors?: Record<string, string>, fonts?: Record<string, string>, numbers?: Record<string, number> }',
  },
];

/** Names of registered top-level document fields. */
export function documentFields(): readonly string[] {
  return DOCUMENT_FIELD_SPECS.map((spec) => spec.name);
}

/** Names of registered fields at `location` (for `type` when given; otherwise for any type), de-duplicated. */
export function fieldsFor(location: FieldLocation, type?: ElementType): readonly string[] {
  const names: string[] = [];
  for (const spec of MOCKUP_FIELD_SPECS) {
    if (spec.location !== location) continue;
    if (type !== undefined && spec.appliesTo !== undefined && !spec.appliesTo.includes(type)) continue;
    if (!names.includes(spec.name)) names.push(spec.name);
  }
  return names;
}

export function isSchemaV2Field(name: string): boolean {
  return (
    MOCKUP_FIELD_SPECS.some((spec) => spec.name === name && spec.schemaV2) ||
    DOCUMENT_FIELD_SPECS.some((spec) => spec.name === name && spec.schemaV2)
  );
}
