/**
 * Built-in library components (Req 6.14-6.16). Always available; never stored in the board file.
 *
 * The button, input field, card, and navigation bar are Component_Masters (Req 16.5): the first
 * element is a Frame carrying `component`, and every color and font references a seeded Token
 * (Req 16.7). Each entry records the values of the Tokens it references, so inserting one adds the
 * missing Tokens to the board and keeps any value the board already defines (Req 11.13). Changing
 * a Token value therefore restyles every instance (Req 16.8). The device outline stays a plain
 * copy template (Req 24.10).
 *
 * Every kit master is a Layout_Frame whose text children hug their content, so the Layout_Pass
 * positions the children and resizes a hugging master (and its instances) when text changes
 * (Req 16.9, 16.10). The x/y/size values written below are drafts: `masterEntry` stores the
 * settled Layout_Pass result, and insertion runs the pass again.
 */
import type { BoardDocument, Color, Element, ElementStyle, LibraryComponent, TextElement } from '../model/types';
import { runLayoutPass } from '../layout/run-layout-pass';
import type { LayoutConfig, Sizing } from '../layout/types';
import { scanTokenReferences } from '../tokens/references';
import type { TokenCollection } from '../tokens/types';

/** Seeded Token set used by the built-in UI kit. */
export const BUILTIN_TOKENS: Required<Pick<TokenCollection, 'colors' | 'fonts'>> = {
  colors: {
    surface: { light: '#ffffff', dark: '#1f1f1f' },
    border: { light: '#c8c8c8', dark: '#5a5a5a' },
    'text-primary': { light: '#1f1f1f', dark: '#f2f2f2' },
    'text-muted': { light: '#6b6b6b', dark: '#a6a6a6' },
    accent: '#2563eb',
    'on-accent': '#ffffff',
  },
  fonts: {
    'font-body': 'sans-serif',
  },
};

const style = (over: Partial<ElementStyle> = {}): ElementStyle => ({
  fill: 'theme:default',
  stroke: 'theme:default',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 1,
  cornerRadius: 0,
  ...over,
});

const box = (id: string, x: number, y: number, width: number, height: number, cornerRadius = 0): Element => ({
  id,
  type: 'rectangle',
  x,
  y,
  width,
  height,
  rotation: 0,
  style: style({ cornerRadius }),
});

const label = (id: string, x: number, y: number, width: number, height: number, text: string, align: 'left' | 'center' = 'center'): Element => ({
  id,
  type: 'text',
  x,
  y,
  width,
  height,
  rotation: 0,
  style: style({ strokeWidth: 0 }),
  runs: [{ text }],
  fontFamily: 'sans-serif',
  fontSize: 16,
  align,
});

/** Auto Layout settings of a master. */
const stack = (
  direction: LayoutConfig['direction'],
  gap: number,
  padding: [top: number, right: number, bottom: number, left: number],
  mainAlign: LayoutConfig['mainAlign'] = 'start',
  crossAlign: LayoutConfig['crossAlign'] = 'center',
): LayoutConfig => ({
  direction,
  gap,
  padding: { top: padding[0], right: padding[1], bottom: padding[2], left: padding[3] },
  mainAlign,
  crossAlign,
});

/** The master Frame: its fill, stroke, and corner radius come from Tokens; it arranges its children. */
const master = (
  id: string,
  name: string,
  width: number,
  height: number,
  look: { fill: Color; stroke: Color; cornerRadius: number },
  layout: LayoutConfig,
  sizing: Sizing,
): Element => ({
  id,
  type: 'frame',
  x: 0,
  y: 0,
  width,
  height,
  rotation: 0,
  style: style({ fill: look.fill, stroke: look.stroke, strokeWidth: 1, cornerRadius: look.cornerRadius }),
  sizing,
  name,
  component: name,
  layout,
});

/** Text child of a master (color and font are Token references); sizing defaults to hug on both axes. */
const part = (
  parentId: string,
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  color: Color,
  align: 'left' | 'center' = 'center',
  sizing: Sizing = { width: 'hug', height: 'hug' },
): Element => ({
  ...(label(id, x, y, width, height, text, align) as TextElement),
  parentId,
  textColor: color,
  fontFamily: 'token:font-body',
  sizing,
});

/** Builds a master entry and records the value of every Token its elements reference. */
function masterEntry(id: string, name: string, draft: Element[]): LibraryComponent {
  // Store the settled Layout_Pass result so the entry already matches what insertion produces.
  const elements = runLayoutPass({ elements: draft } as unknown as BoardDocument).doc.elements.slice();
  const tokens: TokenCollection = {};
  for (const ref of scanTokenReferences(elements)) {
    const source = BUILTIN_TOKENS[ref.category as 'colors' | 'fonts'] as Record<string, unknown> | undefined;
    if (!source || !Object.prototype.hasOwnProperty.call(source, ref.name)) continue;
    const bucket = ((tokens as Record<string, Record<string, unknown>>)[ref.category] ??= {});
    bucket[ref.name] = structuredClone(source[ref.name]);
  }
  return { id, name, builtin: true, elements, tokens };
}

const HUG: Sizing = { width: 'hug', height: 'hug' };
const FILL_HUG: Sizing = { width: 'fill', height: 'hug' };

const button = masterEntry('builtin:button', 'button', [
  master('button-root', 'button', 77, 40, { fill: 'token:accent', stroke: 'token:accent', cornerRadius: 8 }, stack('horizontal', 0, [8, 16, 8, 16], 'center'), HUG),
  part('button-root', 'button-label', 16, 8, 45, 24, 'Button', 'token:on-accent'),
]);

const inputField = masterEntry('builtin:input-field', 'input field', [
  master(
    'input-root',
    'input field',
    240,
    40,
    { fill: 'token:surface', stroke: 'token:border', cornerRadius: 4 },
    stack('horizontal', 0, [8, 8, 8, 8], 'start'),
    { width: 'fixed', height: 'hug' },
  ),
  part('input-root', 'input-placeholder', 8, 8, 224, 24, 'Placeholder', 'token:text-muted', 'left', FILL_HUG),
]);

const card = masterEntry('builtin:card', 'card', [
  master(
    'card-root',
    'card',
    280,
    104,
    { fill: 'token:surface', stroke: 'token:border', cornerRadius: 12 },
    stack('vertical', 16, [16, 16, 16, 16], 'start', 'start'),
    { width: 'fixed', height: 'hug' },
  ),
  part('card-root', 'card-title', 16, 16, 248, 24, 'Card title', 'token:text-primary', 'left', FILL_HUG),
  part('card-root', 'card-content', 16, 56, 248, 24, 'Card content', 'token:text-muted', 'left', FILL_HUG),
]);

const navigationBar = masterEntry('builtin:navigation-bar', 'navigation bar', [
  master(
    'nav-root',
    'navigation bar',
    640,
    56,
    { fill: 'token:surface', stroke: 'token:border', cornerRadius: 0 },
    stack('horizontal', 24, [16, 16, 16, 16], 'start'),
    { width: 'fixed', height: 'hug' },
  ),
  part('nav-root', 'nav-logo', 16, 16, 100, 24, 'Logo', 'token:text-primary', 'left', FILL_HUG),
  part('nav-root', 'nav-home', 400, 16, 60, 24, 'Home', 'token:text-primary'),
  part('nav-root', 'nav-about', 480, 16, 60, 24, 'About', 'token:text-primary'),
  part('nav-root', 'nav-contact', 560, 16, 60, 24, 'Contact', 'token:text-primary'),
]);

/** A shape child of a master whose fill and stroke are Token references. */
const shapePart = (
  parentId: string,
  id: string,
  type: 'rectangle' | 'ellipse',
  x: number,
  y: number,
  width: number,
  height: number,
  look: { fill: Color; stroke: Color; cornerRadius?: number },
  ignoreLayout = false,
): Element => ({
  id,
  type,
  x,
  y,
  width,
  height,
  rotation: 0,
  style: style({ fill: look.fill, stroke: look.stroke, strokeWidth: 1, cornerRadius: look.cornerRadius ?? 0 }),
  parentId,
  ...(ignoreLayout ? { ignoreLayout: true } : {}),
});

const checkbox = masterEntry('builtin:checkbox', 'checkbox', [
  master(
    'checkbox-root',
    'checkbox',
    100,
    24,
    { fill: 'token:surface', stroke: 'token:surface', cornerRadius: 0 },
    stack('horizontal', 8, [0, 0, 0, 0], 'start'),
    HUG,
  ),
  shapePart('checkbox-root', 'checkbox-box', 'rectangle', 0, 2, 20, 20, { fill: 'token:accent', stroke: 'token:accent', cornerRadius: 4 }),
  // The check mark sits over the box, outside the stack.
  {
    ...part('checkbox-root', 'checkbox-check', 0, 2, 20, 20, '✓', 'token:on-accent', 'center', { width: 'fixed', height: 'fixed' }),
    ignoreLayout: true,
  },
  part('checkbox-root', 'checkbox-label', 28, 2, 72, 20, 'Checkbox', 'token:text-primary', 'left'),
]);

const toggle = masterEntry('builtin:toggle', 'toggle', [
  master(
    'toggle-root',
    'toggle',
    48,
    28,
    { fill: 'token:accent', stroke: 'token:accent', cornerRadius: 14 },
    stack('horizontal', 0, [3, 3, 3, 3], 'end'),
    { width: 'fixed', height: 'fixed' },
  ),
  shapePart('toggle-root', 'toggle-knob', 'ellipse', 23, 3, 22, 22, { fill: 'token:on-accent', stroke: 'token:border' }),
]);

const avatar = masterEntry('builtin:avatar', 'avatar', [
  master(
    'avatar-root',
    'avatar',
    48,
    48,
    { fill: 'token:border', stroke: 'token:border', cornerRadius: 24 },
    stack('horizontal', 0, [0, 0, 0, 0], 'center'),
    { width: 'fixed', height: 'fixed' },
  ),
  part('avatar-root', 'avatar-initials', 12, 14, 24, 20, 'AB', 'token:text-primary'),
]);

const badge = masterEntry('builtin:badge', 'badge', [
  master('badge-root', 'badge', 53, 28, { fill: 'token:accent', stroke: 'token:accent', cornerRadius: 12 }, stack('horizontal', 0, [4, 12, 4, 12], 'center'), HUG),
  part('badge-root', 'badge-label', 12, 4, 29, 20, 'Badge', 'token:on-accent'),
]);

/** Icon child of a device master: status and toolbar glyphs are icons and nothing else (Req 24.5). */
const glyph = (parentId: string, id: string, name: string, x: number, y: number, size = 20): Element => ({
  id,
  type: 'icon',
  x,
  y,
  width: size,
  height: size,
  rotation: 0,
  style: style({ stroke: 'token:text-primary', strokeWidth: 2 }),
  parentId,
  name,
});

/**
 * A Device_Frame_Preset (Req 24.1-24.5): a Component_Master whose root clips its content and has
 * rounded corners, sized at fixed preset dimensions. `radii` is top-left, top-right, bottom-right,
 * bottom-left.
 */
const devicePreset = (
  slug: string,
  name: string,
  width: number,
  height: number,
  radii: readonly [number, number, number, number],
  glyphs: Element[],
): LibraryComponent =>
  masterEntry(`builtin:${slug}`, name, [
    {
      id: `${slug}-root`,
      type: 'frame',
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      style: style({ fill: 'token:surface', stroke: 'token:border', strokeWidth: 1, cornerRadius: Math.max(...radii), cornerRadii: radii }),
      name,
      component: name,
      clipContent: true,
    } as Element,
    ...glyphs,
  ]);

const phone = devicePreset('phone', 'phone', 390, 844, [48, 48, 48, 48], [
  glyph('phone-root', 'phone-wifi', 'wifi', 288, 16),
  glyph('phone-root', 'phone-battery', 'battery', 316, 16),
  glyph('phone-root', 'phone-bluetooth', 'bluetooth', 344, 16),
]);

const tablet = devicePreset('tablet', 'tablet', 820, 1180, [32, 32, 32, 32], [
  glyph('tablet-root', 'tablet-wifi', 'wifi', 700, 16),
  glyph('tablet-root', 'tablet-battery', 'battery', 732, 16),
  glyph('tablet-root', 'tablet-bluetooth', 'bluetooth', 764, 16),
]);

const browser = devicePreset('browser', 'browser', 1440, 900, [12, 12, 0, 0], [
  glyph('browser-root', 'browser-back', 'arrow-left', 16, 16),
  glyph('browser-root', 'browser-forward', 'arrow-right', 48, 16),
  glyph('browser-root', 'browser-reload', 'refresh-cw', 80, 16),
  glyph('browser-root', 'browser-lock', 'lock', 124, 16),
  glyph('browser-root', 'browser-menu', 'ellipsis-vertical', 1404, 16),
]);

export const BUILTIN_COMPONENTS: readonly LibraryComponent[] = [
  button,
  inputField,
  card,
  navigationBar,
  checkbox,
  toggle,
  avatar,
  badge,
  phone,
  tablet,
  browser,
  {
    id: 'builtin:device-outline',
    name: 'device outline',
    builtin: true,
    elements: [box('d1', 0, 0, 390, 780, 40), box('d2', 16, 56, 358, 668, 0), box('d3', 155, 20, 80, 16, 8)],
  },
];

export interface ComponentLookup {
  component?: LibraryComponent;
  /** `not_found` or `ambiguous` when no single component matched. */
  error?: { code: 'not_found' | 'ambiguous'; message: string };
}

/** Resolves a component by id, else by name, across the built-ins and the document library. */
export function findComponent(library: readonly LibraryComponent[], key: string): ComponentLookup {
  const all = [...BUILTIN_COMPONENTS, ...library];
  const byId = all.filter((c) => c.id === key);
  const found = byId.length > 0 ? byId : all.filter((c) => c.name === key);
  if (found.length === 0) return { error: { code: 'not_found', message: `Library component not found: ${key}` } };
  if (found.length > 1) {
    return { error: { code: 'ambiguous', message: `Several library components are named "${key}"; use the id.` } };
  }
  return { component: found[0]! };
}
